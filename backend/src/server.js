import { promises as fsp } from "fs";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import cors from "cors";
import express from "express";

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
  const tmpPath = filePath + ".tmp";
  await fsp.writeFile(tmpPath, data, "utf-8");
  await fsp.rename(tmpPath, filePath);
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
app.use(cors());
app.use(express.json({ limit: "4mb" }));

// ─── AI / Ollama Routes ───────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, ollama: OLLAMA_BASE, model: DEFAULT_MODEL }));

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
    const cmd =
      process.platform === "win32"
        ? "start /B ollama serve"
        : "ollama serve &";
    exec(cmd); // fire-and-forget
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
app.listen(PORT, async () => {
  console.log(`✓ Aragon Write backend running on http://localhost:${PORT}`);
  console.log(`  Ollama: ${OLLAMA_BASE} | Model: ${DEFAULT_MODEL}`);
  console.log(`  Storage: ${STORAGE_ROOT}`);
  await ensureDefaultProject();
});
