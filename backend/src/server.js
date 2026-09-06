import { promises as fsp } from "fs";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import cors from "cors";
import express from "express";
// Heavy converters loaded lazily inside their handlers so cold start of the
// backend (and the spellcheck-only path) doesn't pay the docx/pdf parse cost.

const exec = promisify(execCb);

const app = express();
const PORT = Number(process.env.PORT || 3001);
const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.MODEL || "gemma4:e4b";
const wordCache = new Map();

// ─── File-system storage root ─────────────────────────────────────────────────
// User can override via STORAGE_ROOT env var. Default: ~/Documents/Aragon Write
// (with space) to avoid colliding with a developer source checkout that may
// also be named "AragonWrite" inside Documents.
const STORAGE_ROOT =
  process.env.STORAGE_ROOT ||
  path.join(os.homedir(), "Documents", "Aragon Write");

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── Security helpers ─────────────────────────────────────────────────────────
const ID_RE = /^[a-zA-Z0-9_-]+$/;
function sanitizeId(id) {
  if (typeof id !== "string") return null;
  return ID_RE.test(id) ? id : null;
}

function sanitizeDoc(body) {
  if (typeof body !== "object" || body === null) return null;
  const allowed = ["id", "title", "content", "createdAt", "updatedAt"];
  const doc = {};
  for (const key of allowed) {
    if (body[key] !== undefined) doc[key] = body[key];
  }
  return doc;
}

// Atomic write: write to temp then rename
async function writeAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await fsp.writeFile(tmpPath, data, "utf-8");
    await fsp.rename(tmpPath, filePath);
  } finally {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
  }
}

// Find the on-disk folder for a project by its id
async function findProjectFolder(id) {
  await ensureDir(STORAGE_ROOT);
  let entries;
  try { entries = await fsp.readdir(STORAGE_ROOT, { withFileTypes: true }); }
  catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const meta = JSON.parse(
        await fsp.readFile(path.join(STORAGE_ROOT, e.name, "_project.json"), "utf-8")
      );
      if (meta.id === id) return path.join(STORAGE_ROOT, e.name);
    } catch {}
  }
  return null;
}

const HISTORY_INTERVAL_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 144;

async function snapshotDocument(folder, docId) {
  const sourcePath = path.join(folder, `${docId}.json`);
  const historyDir = path.join(folder, ".history", docId);
  try {
    const source = await fsp.readFile(sourcePath, "utf8");
    await ensureDir(historyDir);
    const entries = (await fsp.readdir(historyDir)).filter((name) => name.endsWith(".json")).sort();
    if (entries.length > 0) {
      const newest = await fsp.stat(path.join(historyDir, entries.at(-1)));
      if (Date.now() - newest.mtimeMs < HISTORY_INTERVAL_MS) return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeAtomic(path.join(historyDir, `${stamp}.json`), source);

    const afterWrite = [...entries, `${stamp}.json`];
    const excess = afterWrite.slice(0, Math.max(0, afterWrite.length - HISTORY_LIMIT));
    await Promise.all(excess.map((name) => fsp.rm(path.join(historyDir, name), { force: true })));
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Document snapshot failed:", error.message);
  }
}

// ─── AI Action Prompts ────────────────────────────────────────────────────────
const ACTION_PROMPTS = {
  rewrite: (t) =>
    `أعد صياغة النص التالي بأسلوب أفضل مع الحفاظ على المعنى الأصلي. اكتب فقط النص المُعاد صياغته بدون أي مقدمة أو شرح:\n\n${t}`,
  improve: (t) =>
    `حسّن النص التالي من حيث الأسلوب والوضوح والتدفق الأدبي. اكتب فقط النص المحسّن بدون أي مقدمة أو شرح:\n\n${t}`,
  shorter: (t) =>
    `اختصر النص التالي مع الحفاظ على الأفكار الرئيسية. اكتب فقط النص المختصر بدون أي مقدمة أو شرح:\n\n${t}`,
  longer: (t) =>
    `وسّع النص التالي بإضافة تفاصيل وصفية وأدبية أكثر ثراءً. اكتب فقط النص الموسّع بدون أي مقدمة أو شرح:\n\n${t}`,
  continue: (t) =>
    `استكمل الكتابة الأدبية التالية بنفس الأسلوب والنبرة. اكتب فقط الجزء التالي بدون أي مقدمة:\n\n${t}`,
  translate_en: (t) =>
    `ترجم النص التالي إلى الإنجليزية ترجمة أدبية جميلة. اكتب فقط الترجمة بدون أي مقدمة:\n\n${t}`,
  translate_ar: (t) =>
    `ترجم النص التالي إلى العربية الفصحى الجميلة. اكتب فقط الترجمة بدون أي مقدمة:\n\n${t}`,
  fix_grammar: (t) =>
    `صحّح الأخطاء الإملائية والنحوية وعلامات الترقيم في النص التالي فقط. مهم جداً: لا تغيّر الأسلوب ولا الكلمات ولا تعيد الصياغة — احتفظ بكل شي مثل ما هو إلا الأخطاء. اكتب فقط النص المصحّح بدون أي مقدمة أو شرح:\n\n${t}`,
  ideas: (t) =>
    `بناءً على النص التالي، اقترح 5 أفكار إبداعية للتطوير والإضافة عليه — حسب نوع النص (رواية، مقال، تقرير، شعر، أو غيره). كل فكرة في سطر واحد واضح، بدون أرقام مزخرفة ولا تنسيق Markdown ولا نجمات. ابدأ كل سطر بشرطة - فقط:\n\n${t}`,
  outline: (t) =>
    `اقترح مخططاً تفصيلياً لقصة أو مقال بناءً على الموضوع التالي. قدّم المخطط بشكل منظم:\n\n${t}`,
  titles: (t) =>
    `اقترح 5 عناوين جذابة وإبداعية لنص يتناول الموضوع التالي. قدّم كل عنوان في سطر واحد:\n\n${t}`,
  youtube_script: (t) =>
    `حوّل قائمة الأفكار التالية إلى سكربت فيديو يوتيوب كامل باللغة العربية، جاهز للقراءة أمام الكاميرا.

التعليمات:
- ابدأ بـ [المقدمة] — جذابة وقصيرة (15-30 ثانية)، تذكر للمشاهد وش راح يستفيد وتحفّزه يكمل
- لكل فكرة في القائمة، اكتب قسماً مستقلاً بهذا الشكل:
  [الفقرة N: عنوان مختصر]
  ثم اشرح الفكرة بتفصيل (1-2 دقيقة قراءة لكل قسم)، مع أمثلة ملموسة أو قصص قصيرة عند الإمكان، وانتقال طبيعي للقسم اللي بعده
- اختم بـ [الخاتمة] — تلخّص أهم النقاط، وتدعو للايك والاشتراك والتعليق
- استخدم نبرة محادثة طبيعية، كأنك تكلم صديق وجهاً لوجه
- لا تستخدم تنسيق Markdown (لا **نجمات** ولا ### عناوين ولا --- فواصل) — العناوين بين قوسين مربعين فقط [مثل هذا]
- لا تكتب توجيهات إخراج أو حركات كاميرا، النص المنطوق فقط

قائمة الأفكار:
${t}

السكربت:`,
  chat: (docContent, message) => {
    const hasDoc = docContent && docContent.trim().length > 0;
    const docBlock = hasDoc
      ? `\n\nمستند المستخدم الحالي (استعمله كسياق فقط إذا كان السؤال متعلقاً به):\n---\n${docContent}\n---\n`
      : "";
    return `أنت مساعد ذكي ومفيد تجيب باللغة العربية بشكل واضح ومباشر. أجب عن أي سؤال أو طلب من المستخدم، سواء كان متعلقاً بالكتابة أو بأي موضوع آخر.

قواعد التنسيق المهمة:
- اكتب نصاً عادياً بدون أي تنسيق Markdown
- لا تستخدم نجمات (**) للتغميق ولا (###) للعناوين ولا (---) للفواصل
- لا تستخدم النقاط (*) أو القوائم إلا إذا الجواب فعلاً قائمة عناصر، وعندها استخدم رقم.أو شرطة - بسيطة
- اكتب جملاً وفقرات طبيعية مرتبة، بدون زخرفة بصرية
- اختصر — لا تطوّل الجواب بدون داعي${docBlock}

سؤال المستخدم: ${message}

الإجابة:`;
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeWord(word) {
  return word.trim().replace(/\u0640/g, "");
}
function isArabicWord(w) { return /[\p{Script=Arabic}]/u.test(w); }
function isNumberOnly(w) { return /^[\p{Number}]+$/u.test(w); }
function sanitizeSuggestion(text) {
  return text.trim().replace(/^["'«»""]+|["'«»""]+$/g, "").replace(/[.،,:؛!?]+$/g, "").trim();
}
function parseWordCheck(rawOutput, originalWord) {
  const cleaned = typeof rawOutput === "string" ? rawOutput.replace(/```/g, "").trim() : "";
  if (!cleaned) return { correct: true };
  const firstLine = cleaned.split(/\r?\n/)[0]?.trim() || "";
  if (firstLine === "صحيحة" || /^صحيحة[.،!]*$/u.test(firstLine)) return { correct: true };
  const m = cleaned.match(/خطأ\s*:\s*(.+)/u) || firstLine.match(/خطأ\s*:\s*(.+)/u);
  if (!m) return { correct: true };
  const suggestion = sanitizeSuggestion(m[1] || "");
  if (!suggestion || suggestion === originalWord) return { correct: true };
  return { correct: false, suggestion };
}
async function ollamaGenerate(prompt, model, stream = false, options = {}) {
  // num_ctx: Ollama's default is 2048 — too small for long prompts + long outputs.
  // 8192 lets us handle full scripts comfortably on most models.
  const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream,
      options: { temperature: 0.7, num_predict: 4096, num_ctx: 8192, ...options },
    }),
  });
  if (!response.ok) throw new Error(await response.text() || "Ollama connection failed");
  return response;
}

// ─── External (OpenAI-compatible) provider ───────────────────────────────────
// Works with Groq, OpenRouter, DeepSeek, Together, Mistral API, LM Studio, etc.
// All send chat-completion style requests; streaming uses OpenAI SSE format.
function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

async function openaiCompatGenerate({ prompt, model, stream, baseUrl, apiKey }) {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey || ""}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: !!stream,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    const code = response.status;
    // Friendly Arabic error messages for the common cases.
    let msg = body || "فشل الاتصال بالخدمة الخارجية";
    if (code === 401 || code === 403) msg = "مفتاح API غير صالح أو منتهي.";
    else if (code === 404) msg = "Base URL غير صحيح أو الموديل غير موجود.";
    else if (code === 429) msg = "تجاوزت الحد المسموح — جرّب بعد قليل.";
    else if (code >= 500) msg = "الخدمة الخارجية معطّلة حالياً.";
    throw new Error(msg);
  }
  return response;
}

// Unified dispatcher — switches between Ollama (local) and OpenAI-compat (cloud).
async function aiGenerate({ prompt, model, stream = false, providerConfig = null }) {
  if (providerConfig && providerConfig.type === "openai_compat") {
    return openaiCompatGenerate({
      prompt,
      model,
      stream,
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
    });
  }
  return ollamaGenerate(prompt, model, stream);
}

// Returns true if the given config targets the external provider.
function isExternalProvider(providerConfig) {
  return !!(providerConfig && providerConfig.type === "openai_compat");
}

// ─── Middleware ───────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  "null", // packaged Electron renderer loaded from file://
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
}));
app.use((error, _req, res, next) => {
  if (error?.message === "Origin not allowed") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  return next(error);
});
// 50mb limit so backup imports and Save As bodies (HTML fragments) fit comfortably.
app.use(express.json({ limit: "50mb" }));

// ─── AI / Ollama Routes ───────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  let ollamaOk = false;
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(1500) });
    ollamaOk = r.ok;
  } catch {}
  res.json({ ok: true, ollamaOk, ollama: OLLAMA_BASE, model: DEFAULT_MODEL });
});

app.get("/models", async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!response.ok) return res.status(502).json({ error: "Cannot reach Ollama", models: [] });
    const data = await response.json();
    return res.json({ models: (data.models || []).map((m) => ({ name: m.name, size: m.size, modified: m.modified_at })) });
  } catch { return res.status(502).json({ error: "Ollama not running", models: [] }); }
});

// POST /health/provider — test connection to an external OpenAI-compat API.
// Body: { baseUrl, apiKey }. Returns {ok:true, models?} or {ok:false, error}.
// Uses the /models endpoint as the cheapest probe (no token usage).
app.post("/health/provider", async (req, res) => {
  const baseUrl = normalizeBaseUrl(req.body?.baseUrl);
  const apiKey = req.body?.apiKey || "";
  if (!baseUrl) return res.status(400).json({ ok: false, error: "Base URL مطلوب" });
  try {
    const r = await fetch(`${baseUrl}/models`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      if (r.status === 401 || r.status === 403) msg = "مفتاح API غير صالح أو منتهي.";
      else if (r.status === 404) msg = "المسار غير صحيح — تأكد من Base URL.";
      else if (r.status === 429) msg = "تجاوزت الحد المسموح حالياً.";
      else if (r.status >= 500) msg = "الخدمة الخارجية معطّلة حالياً.";
      return res.json({ ok: false, error: msg });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.json({ ok: false, error: err.message || "تعذّر الوصول إلى الخدمة. تأكد من الاتصال بالإنترنت." });
  }
});

// POST /models/external — list models from an OpenAI-compat provider.
// Body: { baseUrl, apiKey }. Returns {models: [{name, ...}]}.
app.post("/models/external", async (req, res) => {
  const baseUrl = normalizeBaseUrl(req.body?.baseUrl);
  const apiKey = req.body?.apiKey || "";
  if (!baseUrl) return res.status(400).json({ error: "Base URL مطلوب", models: [] });
  try {
    const r = await fetch(`${baseUrl}/models`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      if (r.status === 401 || r.status === 403) msg = "مفتاح API غير صالح أو منتهي.";
      else if (r.status === 404) msg = "المسار غير صحيح — تأكد من Base URL.";
      return res.status(502).json({ error: msg, models: [] });
    }
    const data = await r.json();
    // OpenAI-style: { object: "list", data: [{ id, ... }] }
    // Some providers (Ollama compat): may use different shape — fall back to data.data or data.models.
    const list = Array.isArray(data?.data) ? data.data
               : Array.isArray(data?.models) ? data.models
               : [];
    const models = list.map((m) => ({
      name: m.id || m.name || "",
      owned_by: m.owned_by || m.provider || "",
    })).filter((m) => m.name);
    return res.json({ models });
  } catch (err) {
    return res.status(502).json({ error: err.message || "تعذّر جلب الموديلات.", models: [] });
  }
});

app.post("/ai/action", async (req, res) => {
  const { text = "", action = "improve", instruction = "", model = DEFAULT_MODEL, providerConfig = null } = req.body;
  if (!text.trim()) return res.status(400).json({ error: "النص مطلوب" });
  const promptFn = ACTION_PROMPTS[action];
  if (!promptFn) return res.status(400).json({ error: `إجراء غير معروف: ${action}` });
  const prompt = instruction ? `${promptFn(text)}\n\nتعليمات إضافية: ${instruction}` : promptFn(text);
  try {
    const response = await aiGenerate({ prompt, model, stream: false, providerConfig });
    const data = await response.json();
    // Normalize response: Ollama returns {response}; OpenAI returns {choices:[{message:{content}}]}
    const result =
      data.response ??
      data.choices?.[0]?.message?.content ??
      "";
    return res.json({ result });
  } catch (error) {
    const msg = error.message || (isExternalProvider(providerConfig) ? "فشل الاتصال بالخدمة الخارجية" : "فشل الاتصال بـ Ollama");
    return res.status(502).json({ error: msg });
  }
});

app.post("/ai/stream", async (req, res) => {
  const { text = "", action = "improve", instruction = "", model = DEFAULT_MODEL, docContent = "", providerConfig = null } = req.body;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  let prompt;
  if (action === "chat") {
    prompt = ACTION_PROMPTS.chat(docContent || text, instruction || text);
  } else {
    const promptFn = ACTION_PROMPTS[action];
    if (!promptFn) {
      res.write(`data: ${JSON.stringify({ error: "إجراء غير معروف" })}\n\n`);
      return res.end();
    }
    prompt = instruction ? `${promptFn(text)}\n\nتعليمات إضافية: ${instruction}` : promptFn(text);
  }
  const external = isExternalProvider(providerConfig);
  try {
    const upstream = await aiGenerate({ prompt, model, stream: true, providerConfig });
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep last partial line for next chunk
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (external) {
          // OpenAI SSE: lines start with "data: " and end with "data: [DONE]"
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
          try {
            const parsed = JSON.parse(payload);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
          } catch {}
        } else {
          // Ollama: one JSON object per line — {"response":"...", "done":bool}
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) res.write(`data: ${JSON.stringify({ text: parsed.response })}\n\n`);
            if (parsed.done) res.write("data: [DONE]\n\n");
          } catch {}
        }
      }
    }
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message || "فشل الاتصال" })}\n\n`);
  }
  res.end();
});

const WORD_CHECK_PROMPT = `هل هذه الكلمة مكتوبة بشكل صحيح إملائياً في اللغة العربية؟
أجب فقط:
صحيحة
أو
خطأ: <التصحيح>

أمثلة:
كتاباتي → صحيحة
الخرده → خطأ: الخردة
`;

app.post("/check-word", async (req, res) => {
  // Spellcheck is intentionally Ollama-only (sending a request per word to a
  // paid API would be expensive). Frontend should already disable it in
  // external-provider mode; this is a safety net.
  if (isExternalProvider(req.body?.providerConfig)) {
    return res.status(503).json({ error: "التدقيق الإملائي يعمل محلياً فقط (Ollama).", correct: true });
  }
  const rawWord = typeof req.body?.word === "string" ? req.body.word : "";
  const word = normalizeWord(rawWord);
  if (!word || !isArabicWord(word) || isNumberOnly(word)) return res.json({ correct: true });
  if (wordCache.has(word)) return res.json(wordCache.get(word));
  try {
    const model = req.body?.model || DEFAULT_MODEL;
    const response = await ollamaGenerate(`${WORD_CHECK_PROMPT}\nالكلمة: ${word}`, model, false);
    const data = await response.json();
    const result = parseWordCheck(data.response || "", word);
    wordCache.set(word, result);
    return res.json(result);
  } catch { return res.json({ correct: true }); }
});

// POST /check-words — batch spellcheck (replaces N+1 /check-word calls)
app.post("/check-words", async (req, res) => {
  if (isExternalProvider(req.body?.providerConfig)) {
    return res.status(503).json({ error: "التدقيق الإملائي يعمل محلياً فقط (Ollama)." });
  }
  const words = Array.isArray(req.body?.words) ? req.body.words : [];
  const model = req.body?.model || DEFAULT_MODEL;
  if (words.length === 0) return res.json([]);

  const results = [];
  const toAsk = [];
  for (const raw of words) {
    const word = normalizeWord(raw);
    if (!word || !isArabicWord(word) || isNumberOnly(word)) {
      results.push({ word, result: { correct: true } });
      continue;
    }
    if (wordCache.has(word)) {
      results.push({ word, result: wordCache.get(word) });
      continue;
    }
    toAsk.push(word);
  }

  if (toAsk.length > 0) {
    // Build a single prompt with all words
    const prompt = `${WORD_CHECK_PROMPT}\n` +
      toAsk.map((w, i) => `${i + 1}. ${w}`).join("\n") +
      "\n\nأجب بقائمة مرقمة بنفس الترتيب.";
    try {
      const response = await ollamaGenerate(prompt, model, false);
      const data = await response.json();
      const lines = (data.response || "").split(/\r?\n/);
      for (let i = 0; i < toAsk.length; i++) {
        const word = toAsk[i];
        const line = lines.find((l) => l.includes(`${i + 1}.`) || l.includes(`${word}`)) || "";
        const result = parseWordCheck(line, word);
        wordCache.set(word, result);
        results.push({ word, result });
      }
    } catch {
      for (const word of toAsk) {
        wordCache.set(word, { correct: true });
        results.push({ word, result: { correct: true } });
      }
    }
  }

  return res.json(results);
});

// ─── Ollama control ───────────────────────────────────────────────────────────

// POST /ollama/kill — stop the Ollama process
app.post("/ollama/kill", async (_req, res) => {
  try {
    const cmd =
      process.platform === "win32"
        ? "taskkill /F /IM ollama.exe"
        : "pkill -f ollama";
    await exec(cmd);
    res.json({ ok: true });
  } catch (err) {
    // Process may already be stopped — treat as success
    res.json({ ok: true, note: err.message });
  }
});

// POST /ollama/start — launch Ollama serve (Windows / mac / linux)
app.post("/ollama/start", async (_req, res) => {
  try {
    // GUI apps on macOS get a minimal PATH, so try the Ollama.app bundle first,
    // then the usual CLI install locations.
    const cmd =
      process.platform === "win32"
        ? "start /B ollama serve"
        : process.platform === "darwin"
        ? "(open -a Ollama || nohup /opt/homebrew/bin/ollama serve >/dev/null 2>&1 || nohup /usr/local/bin/ollama serve >/dev/null 2>&1) &"
        : "nohup ollama serve >/dev/null 2>&1 &";
    exec(cmd); // fire-and-forget
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── File I/O & format conversion (Save As / Import) ─────────────────────────

// A renderer-side "Save As..." flow uses Electron to pick a path, then asks us
// to write the bytes. For text formats the body is `content` (utf-8 string);
// for binary formats (future: .docx, .pdf via library), `contentBase64`.
app.post("/export/write-file", async (req, res) => {
  try {
    const { savePath, content, contentBase64, encoding = "utf8" } = req.body || {};
    if (!savePath) return res.status(400).json({ error: "savePath مطلوب" });
    if (content == null && contentBase64 == null) {
      return res.status(400).json({ error: "content أو contentBase64 مطلوب" });
    }
    const buffer = contentBase64
      ? Buffer.from(contentBase64, "base64")
      : Buffer.from(String(content), encoding);
    // Reuse the atomic-write pattern used for project data so a crash
    // mid-write doesn't truncate the user's existing file.
    const tmp = `${savePath}.tmp`;
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, savePath);
    return res.json({ ok: true, bytes: buffer.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || "فشل حفظ الملف" });
  }
});

// Counterpart for Import: read a file from disk after the renderer picked it
// via the OS dialog. Returns `content` for text, `contentBase64` for binary.
app.post("/import/read-file", async (req, res) => {
  try {
    const { sourcePath, asBase64 = false } = req.body || {};
    if (!sourcePath) return res.status(400).json({ error: "sourcePath مطلوب" });
    const buf = await fsp.readFile(sourcePath);
    if (asBase64) {
      return res.json({ contentBase64: buf.toString("base64"), bytes: buf.length });
    }
    return res.json({ content: buf.toString("utf8"), bytes: buf.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || "فشل قراءة الملف" });
  }
});

// ─── Markdown ↔ HTML ──────────────────────────────────────────────────────────

// A small Markdown → HTML parser (no deps).
// Supports: ATX headings (# .. ######), fenced code blocks (```), inline code,
// bold **/__,  italic */_, links [text](url), images ![alt](url), unordered
// (-, *) and ordered (1.) lists, blockquotes (>), horizontal rules (---),
// and paragraph breaks on blank lines. Keeps RTL-friendly: leaves Arabic
// characters untouched.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function mdInline(text) {
  let s = escapeHtml(text);
  // images BEFORE links so ![alt](url) is matched first
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // inline code (single backticks, no nesting)
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // bold (** or __)
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // italic (single * or _) — avoid matching inside words
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?:;)]|$)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?:;)]|$)/g, "$1<em>$2</em>");
  return s;
}

function mdToHtml(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let inCode = false;
  let codeBuf = [];
  let listStack = []; // array of { tag: "ul"|"ol" }

  function closeLists(toDepth = 0) {
    while (listStack.length > toDepth) {
      const top = listStack.pop();
      out.push(`</${top.tag}>`);
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    if (/^```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        inCode = false;
        codeBuf = [];
      } else {
        closeLists();
        inCode = true;
        codeBuf = [];
      }
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    // Blank line — break out of any list and skip
    if (/^\s*$/.test(line)) {
      closeLists();
      i++; continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      closeLists();
      out.push(`<h${h[1].length}>${mdInline(h[2].trim())}</h${h[1].length}>`);
      i++; continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeLists();
      out.push("<hr>");
      i++; continue;
    }

    // Blockquote (one line at a time; consecutive lines wrapped together)
    if (/^>\s?/.test(line)) {
      closeLists();
      const parts = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdInline(parts.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    const ul = /^(\s*)([-*])\s+(.+)$/.exec(line);
    if (ul) {
      if (listStack[listStack.length - 1]?.tag !== "ul") {
        closeLists();
        listStack.push({ tag: "ul" });
        out.push("<ul>");
      }
      out.push(`<li>${mdInline(ul[3])}</li>`);
      i++; continue;
    }

    // Ordered list
    const ol = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (ol) {
      if (listStack[listStack.length - 1]?.tag !== "ol") {
        closeLists();
        listStack.push({ tag: "ol" });
        out.push("<ol>");
      }
      out.push(`<li>${mdInline(ol[2])}</li>`);
      i++; continue;
    }

    // Otherwise: paragraph — consume consecutive non-blank lines
    closeLists();
    const para = [line];
    while (i + 1 < lines.length && !/^\s*$/.test(lines[i + 1])
           && !/^(#{1,6}|>|```|[-*_])\s/.test(lines[i + 1])
           && !/^\d+\.\s/.test(lines[i + 1])) {
      i++;
      para.push(lines[i]);
    }
    out.push(`<p>${mdInline(para.join(" "))}</p>`);
    i++;
  }
  closeLists();
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  return out.join("\n");
}

// Wrap converted HTML in a proper RTL Arabic document for stand-alone .html files.
function wrapHtmlForExport(bodyHtml, title = "مستند") {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'Amiri', 'Traditional Arabic', serif; max-width: 800px;
         margin: 40px auto; padding: 20px; direction: rtl; text-align: right;
         font-size: 18px; line-height: 2; color: #222; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.4; margin-top: 1.6em; }
  blockquote { border-right: 4px solid #c8956c; padding: 4px 12px;
               margin: 1em 0; color: #555; }
  code { background: #f3f3f3; padding: 2px 4px; border-radius: 3px;
         font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; }
  pre { background: #f3f3f3; padding: 12px; border-radius: 6px;
        overflow-x: auto; direction: ltr; text-align: left; }
  ul, ol { padding-right: 24px; }
  img { max-width: 100%; height: auto; }
  a { color: #c8956c; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${bodyHtml}
</body>
</html>`;
}

// POST /convert/from-md — convert markdown text to HTML.
app.post("/convert/from-md", (req, res) => {
  try {
    const { content = "", wrap = false, title = "مستند" } = req.body || {};
    const body = mdToHtml(content);
    return res.json({ html: wrap ? wrapHtmlForExport(body, title) : body });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /convert/wrap-html — wrap a body HTML fragment in a standalone RTL doc.
// Used for Save As .html so the saved file opens nicely in a browser/Word.
app.post("/convert/wrap-html", (req, res) => {
  try {
    const { body = "", title = "مستند" } = req.body || {};
    return res.json({ html: wrapHtmlForExport(body, title) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── DOCX / PDF converters (Phase 2) ──────────────────────────────────────────
// We parse TipTap-shaped HTML (block-level elements + a small set of inline
// tags) into docx Paragraph/TextRun structures. Not a general-purpose HTML
// parser — assumes the input came from our editor.

// Strip HTML entities back to plain characters for runs.
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Walk inline HTML into a flat array of {text, bold, italic, code, href}.
function parseInline(inlineHtml) {
  const runs = [];
  let i = 0;
  const stack = [{ bold: false, italic: false, code: false, href: null }];
  const top = () => stack[stack.length - 1];

  while (i < inlineHtml.length) {
    if (inlineHtml[i] !== "<") {
      // Read text up to next tag
      let j = inlineHtml.indexOf("<", i);
      if (j === -1) j = inlineHtml.length;
      const text = decodeEntities(inlineHtml.slice(i, j));
      if (text) runs.push({ text, ...top() });
      i = j;
      continue;
    }
    // It's a tag
    const close = inlineHtml.indexOf(">", i);
    if (close === -1) break;
    const tag = inlineHtml.slice(i, close + 1);
    i = close + 1;

    if (/^<br\s*\/?>$/i.test(tag)) {
      runs.push({ text: "\n", ...top(), isBreak: true });
      continue;
    }

    const isClosing = tag.startsWith("</");
    const m = /^<\/?([a-z0-9]+)/i.exec(tag);
    if (!m) continue;
    const name = m[1].toLowerCase();

    if (isClosing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    // Opening
    const next = { ...top() };
    if (name === "strong" || name === "b") next.bold = true;
    else if (name === "em" || name === "i") next.italic = true;
    else if (name === "code") next.code = true;
    else if (name === "a") {
      const hrefMatch = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag);
      next.href = hrefMatch ? hrefMatch[1] : null;
    } else if (tag.endsWith("/>")) {
      // Self-closing — don't push
      continue;
    }
    stack.push(next);
  }

  return runs;
}

// Split HTML into block-level chunks. Returns array of {type, content, level?}.
function parseBlocks(html) {
  const blocks = [];
  const blockRe = /<(h[1-6]|p|ul|ol|blockquote|pre|hr)([^>]*)>([\s\S]*?)<\/\1>|<(hr)\s*\/?\s*>/gi;
  let m;
  let lastEnd = 0;
  while ((m = blockRe.exec(html)) !== null) {
    // Anything between blocks → treat as paragraph (rare)
    const gap = html.slice(lastEnd, m.index).trim();
    if (gap) blocks.push({ type: "p", content: gap });
    const tag = (m[1] || m[4] || "").toLowerCase();
    const inner = m[3] || "";
    if (tag === "hr") {
      blocks.push({ type: "hr" });
    } else if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: "heading", level: parseInt(tag[1], 10), content: inner });
    } else if (tag === "ul" || tag === "ol") {
      const items = [];
      const itemRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let im;
      while ((im = itemRe.exec(inner)) !== null) items.push(im[1]);
      blocks.push({ type: tag, items });
    } else {
      blocks.push({ type: tag, content: inner });
    }
    lastEnd = blockRe.lastIndex;
  }
  const tail = html.slice(lastEnd).trim();
  if (tail) blocks.push({ type: "p", content: tail });
  return blocks;
}

// Build docx TextRun array from inline runs. `docx` library required as arg.
function runsToTextRuns(inlineRuns, docx) {
  return inlineRuns.map((r) => new docx.TextRun({
    text: r.text,
    bold: !!r.bold,
    italics: !!r.italic,
    font: r.code ? "Consolas" : undefined,
    break: r.isBreak ? 1 : undefined,
  }));
}

async function htmlToDocxBuffer(html, title) {
  const docx = await import("docx");
  const { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } = docx;
  const blocks = parseBlocks(html);

  const HEADING = {
    1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
  };

  const baseParagraph = (children, opts = {}) =>
    new Paragraph({
      children,
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      ...opts,
    });

  const children = [];
  // Title at top
  if (title) {
    children.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: title, bold: true, size: 36 })],
    }));
  }

  for (const block of blocks) {
    if (block.type === "heading") {
      children.push(baseParagraph(
        runsToTextRuns(parseInline(block.content), docx),
        { heading: HEADING[block.level] }
      ));
    } else if (block.type === "p") {
      children.push(baseParagraph(runsToTextRuns(parseInline(block.content), docx)));
    } else if (block.type === "blockquote") {
      children.push(baseParagraph(
        runsToTextRuns(parseInline(block.content), docx),
        { indent: { right: 720 }, style: "Quote" }
      ));
    } else if (block.type === "pre") {
      // Treat pre as a single mono paragraph
      const text = decodeEntities(block.content.replace(/<[^>]+>/g, ""));
      children.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text, font: "Consolas" })],
      }));
    } else if (block.type === "ul" || block.type === "ol") {
      for (const item of block.items) {
        children.push(baseParagraph(
          runsToTextRuns(parseInline(item), docx),
          {
            bullet: block.type === "ul" ? { level: 0 } : undefined,
            numbering: block.type === "ol" ? { reference: "ordered-list", level: 0 } : undefined,
          }
        ));
      }
    } else if (block.type === "hr") {
      children.push(new Paragraph({ children: [new TextRun({ text: "—".repeat(20) })] }));
    }
  }

  const doc = new Document({
    creator: "Aragon Write",
    title: title || "مستند",
    description: "Exported by Aragon Write",
    numbering: {
      config: [{
        reference: "ordered-list",
        levels: [{
          level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START,
          style: { paragraph: { indent: { right: 360 } } },
        }],
      }],
    },
    sections: [{
      properties: { },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

// POST /convert/to-docx — convert HTML body to a .docx file written to savePath.
app.post("/convert/to-docx", async (req, res) => {
  try {
    const { html = "", title = "مستند", savePath } = req.body || {};
    if (!savePath) return res.status(400).json({ error: "savePath مطلوب" });
    if (!html.trim()) return res.status(400).json({ error: "محتوى فارغ" });
    const buffer = await htmlToDocxBuffer(html, title);
    const tmp = `${savePath}.tmp`;
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, savePath);
    return res.json({ ok: true, bytes: buffer.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || "فشل تصدير DOCX" });
  }
});

// POST /convert/from-docx — read a .docx file and convert to TipTap-ready HTML.
app.post("/convert/from-docx", async (req, res) => {
  try {
    const { sourcePath } = req.body || {};
    if (!sourcePath) return res.status(400).json({ error: "sourcePath مطلوب" });
    const mammoth = (await import("mammoth")).default || (await import("mammoth"));
    const buffer = await fsp.readFile(sourcePath);
    const result = await mammoth.convertToHtml({ buffer });
    // mammoth uses <p> for paragraphs and TipTap accepts that directly.
    // Strip <p></p> wrappers around images and a few other quirks if needed later.
    return res.json({
      html: result.value || "",
      warnings: (result.messages || []).map((m) => m.message).slice(0, 5),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "فشل قراءة DOCX" });
  }
});

// POST /convert/from-pdf — extract plain text from a PDF, page by page.
app.post("/convert/from-pdf", async (req, res) => {
  try {
    const { sourcePath } = req.body || {};
    if (!sourcePath) return res.status(400).json({ error: "sourcePath مطلوب" });
    // pdfjs-dist is ESM; import the legacy build that works in Node.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await fsp.readFile(sourcePath));
    const pdf = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      // Items have .str + a `hasEOL` marker on newer pdfjs versions; fall back
      // to inserting spaces between runs and double newlines between blocks.
      let text = "";
      let lastY = null;
      for (const item of tc.items) {
        if (typeof item.str !== "string") continue;
        if (lastY != null && item.transform && Math.abs(item.transform[5] - lastY) > 4) {
          text += "\n";
        }
        text += item.str;
        if (item.hasEOL) text += "\n";
        lastY = item.transform ? item.transform[5] : lastY;
      }
      pages.push({ page: p, text: text.trim() });
    }
    const plainText = pages.map((p) => p.text).join("\n\n").trim();
    // Wrap in <p> blocks for TipTap consumption.
    const html = plainText
      .split(/\n\s*\n/)
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
      .join("");
    return res.json({ html, plainText, pageCount: pdf.numPages });
  } catch (err) {
    return res.status(500).json({ error: err.message || "فشل قراءة PDF" });
  }
});

// ─── Project backup (JSON) ────────────────────────────────────────────────────

// GET /backup/export-project?id=PROJECT_ID — bundle a whole project (metadata
// + all docs with full content) into one JSON blob the user can stash as a
// backup or move between machines.
app.get("/backup/export-project", async (req, res) => {
  try {
    const id = sanitizeId(req.query.id || "");
    if (!id) return res.status(400).json({ error: "id مطلوب" });
    const folder = await findProjectFolder(id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const meta = JSON.parse(await fsp.readFile(path.join(folder, "_project.json"), "utf-8"));
    const files = await fsp.readdir(folder);
    const docs = [];
    for (const f of files) {
      if (!f.endsWith(".json") || f === "_project.json") continue;
      try {
        docs.push(JSON.parse(await fsp.readFile(path.join(folder, f), "utf-8")));
      } catch {}
    }
    docs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return res.json({
      _format: "aragon-write-backup",
      _version: 1,
      exportedAt: new Date().toISOString(),
      project: meta,
      docs,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /backup/import-project — restore a project from a backup JSON.
// Body: { json: <full backup object>, target: "new" }
// (Only "new" supported for now — always creates a fresh project. Merge could
// be added later if a user wants to overlay onto an existing project.)
app.post("/backup/import-project", async (req, res) => {
  try {
    const { json, target = "new" } = req.body || {};
    if (!json || !json.project || !Array.isArray(json.docs)) {
      return res.status(400).json({ error: "ملف النسخة الاحتياطية غير صالح" });
    }
    if (target !== "new") {
      return res.status(400).json({ error: "حالياً يُدعم استيراد كمشروع جديد فقط" });
    }
    // Always assign fresh ids so we don't clash with an existing project that
    // happens to share the original id.
    const newId = genId();
    const projectDir = path.join(STORAGE_ROOT, newId);
    await ensureDir(projectDir);
    const now = new Date().toISOString();
    const meta = {
      id: newId,
      title: json.project.title || "مشروع مستورد",
      gradient: json.project.gradient || null,
      docCount: json.docs.length,
      createdAt: now,
      updatedAt: now,
    };
    await writeAtomic(path.join(projectDir, "_project.json"), JSON.stringify(meta, null, 2));
    for (const doc of json.docs) {
      const docId = genId();
      const docOut = {
        id: docId,
        title: doc.title || "بدون عنوان",
        content: doc.content || "<p></p>",
        createdAt: doc.createdAt || now,
        updatedAt: now,
      };
      await writeAtomic(path.join(projectDir, `${docId}.json`), JSON.stringify(docOut, null, 2));
    }
    return res.json({ ok: true, projectId: newId, docCount: json.docs.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── File-system Project Routes ───────────────────────────────────────────────

// GET /fs/projects — list all projects
app.get("/fs/projects", async (_req, res) => {
  try {
    await ensureDir(STORAGE_ROOT);
    const entries = await fsp.readdir(STORAGE_ROOT, { withFileTypes: true });
    const projects = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const dir = path.join(STORAGE_ROOT, e.name);
        const meta = JSON.parse(await fsp.readFile(path.join(dir, "_project.json"), "utf-8"));
        const files = await fsp.readdir(dir);
        meta.docCount = files.filter(f => f.endsWith(".json") && f !== "_project.json").length;
        projects.push(meta);
      } catch {}
    }
    res.json(projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /fs/projects — create project
app.post("/fs/projects", async (req, res) => {
  try {
    const { title = "رواية جديدة", gradient } = req.body;
    const id = genId();
    const projectDir = path.join(STORAGE_ROOT, id);
    await ensureDir(projectDir);
    const meta = {
      id, title,
      gradient: gradient || null,
      docCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeAtomic(path.join(projectDir, "_project.json"), JSON.stringify(meta, null, 2));
    res.json(meta);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /fs/projects/:id — rename / update project
app.put("/fs/projects/:id", async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid project ID" });
    const folder = await findProjectFolder(id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const metaPath = path.join(folder, "_project.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    const { title, gradient } = req.body;
    if (title !== undefined) meta.title = title;
    if (gradient !== undefined) meta.gradient = gradient;
    meta.updatedAt = new Date().toISOString();
    await writeAtomic(metaPath, JSON.stringify(meta, null, 2));
    res.json(meta);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /fs/projects/:id — delete project folder
app.delete("/fs/projects/:id", async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid project ID" });
    const folder = await findProjectFolder(id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    await fsp.rm(folder, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fs/projects/:id/docs — list documents (metadata only, no content)
app.get("/fs/projects/:id/docs", async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid project ID" });
    const folder = await findProjectFolder(id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const files = await fsp.readdir(folder);
    const docs = [];
    for (const file of files) {
      if (!file.endsWith(".json") || file === "_project.json") continue;
      try {
        const raw = await fsp.readFile(path.join(folder, file), "utf-8");
        const doc = JSON.parse(raw);
        if (!doc.id || !doc.title) continue; // skip malformed
        docs.push(doc);
      } catch {}
    }
    docs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /fs/projects/:id/docs — create document
app.post("/fs/projects/:id/docs", async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid project ID" });
    const folder = await findProjectFolder(id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const body = sanitizeDoc(req.body);
    if (!body) return res.status(400).json({ error: "Invalid document body" });
    const doc = { ...body };
    if (!doc.id) doc.id = genId();
    const docId = sanitizeId(doc.id);
    if (!docId) return res.status(400).json({ error: "Invalid document ID" });
    doc.id = docId;
    doc.createdAt = doc.createdAt || new Date().toISOString();
    doc.updatedAt = new Date().toISOString();
    await writeAtomic(path.join(folder, `${docId}.json`), JSON.stringify(doc, null, 2));
    // bump project updatedAt
    try {
      const mp = path.join(folder, "_project.json");
      const meta = JSON.parse(await fsp.readFile(mp, "utf-8"));
      meta.updatedAt = new Date().toISOString();
      await writeAtomic(mp, JSON.stringify(meta, null, 2));
    } catch {}
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /fs/projects/:id/docs/:docId — save / update document
app.put("/fs/projects/:id/docs/:docId", async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    const docId = sanitizeId(req.params.docId);
    if (!id || !docId) return res.status(400).json({ error: "Invalid project or document ID" });
    const folder = await findProjectFolder(id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const body = sanitizeDoc(req.body);
    if (!body) return res.status(400).json({ error: "Invalid document body" });
    const doc = { ...body, updatedAt: new Date().toISOString() };
    await snapshotDocument(folder, docId);
    await writeAtomic(path.join(folder, `${docId}.json`), JSON.stringify(doc, null, 2));
    // bump project updatedAt
    try {
      const mp = path.join(folder, "_project.json");
      const meta = JSON.parse(await fsp.readFile(mp, "utf-8"));
      meta.updatedAt = new Date().toISOString();
      await writeAtomic(mp, JSON.stringify(meta, null, 2));
    } catch {}
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /fs/projects/:id/docs/:docId — delete document
app.delete("/fs/projects/:id/docs/:docId", async (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    const docId = sanitizeId(req.params.docId);
    if (!id || !docId) return res.status(400).json({ error: "Invalid project or document ID" });
    const folder = await findProjectFolder(id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    await fsp.unlink(path.join(folder, `${docId}.json`));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ensure a default project exists so users never lose docs in localStorage
async function ensureDefaultProject() {
  try {
    await ensureDir(STORAGE_ROOT);
    const entries = await fsp.readdir(STORAGE_ROOT, { withFileTypes: true });
    const hasProjects = entries.some((e) => e.isDirectory());
    if (!hasProjects) {
      const id = genId();
      const projectDir = path.join(STORAGE_ROOT, id);
      await ensureDir(projectDir);
      const meta = {
        id,
        title: "مستنداتي",
        gradient: null,
        docCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await writeAtomic(
        path.join(projectDir, "_project.json"),
        JSON.stringify(meta, null, 2)
      );
      console.log(`  Created default project: ${meta.title}`);
    }
  } catch (e) {
    console.error("  Failed to create default project:", e.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "127.0.0.1", async () => {
  console.log(`✓ Aragon Write backend running on http://127.0.0.1:${PORT}`);
  console.log(`  Ollama: ${OLLAMA_BASE} | Model: ${DEFAULT_MODEL}`);
  console.log(`  Storage: ${STORAGE_ROOT}`);
  await ensureDefaultProject();
});
