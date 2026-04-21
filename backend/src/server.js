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
const DEFAULT_MODEL = process.env.MODEL || "qwen2.5:7b";
const wordCache = new Map();

// ─── File-system storage root ─────────────────────────────────────────────────
const STORAGE_ROOT = path.join(os.homedir(), "Documents", "Aragon Write");

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
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
    `صحّح الأخطاء الإملائية والنحوية في النص التالي. اكتب فقط النص المصحح بدون أي مقدمة أو شرح:\n\n${t}`,
  ideas: (t) =>
    `بناءً على النص التالي، اقترح 5 أفكار إبداعية لتطوير الحبكة أو الشخصيات. قدّم كل فكرة في سطر واحد واضح:\n\n${t}`,
  outline: (t) =>
    `اقترح مخططاً تفصيلياً لقصة أو مقال بناءً على الموضوع التالي. قدّم المخطط بشكل منظم:\n\n${t}`,
  titles: (t) =>
    `اقترح 5 عناوين جذابة وإبداعية لنص يتناول الموضوع التالي. قدّم كل عنوان في سطر واحد:\n\n${t}`,
  chat: (docContent, message) =>
    `أنت مساعد كتابي إبداعي. السياق هو المستند التالي:\n\n---\n${docContent}\n---\n\nالسؤال أو الطلب: ${message}\n\nأجب بشكل مفيد ومحدد:`,
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
async function ollamaGenerate(prompt, model, stream = false) {
  const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream, options: { temperature: 0.7, num_predict: 2048 } }),
  });
  if (!response.ok) throw new Error(await response.text() || "Ollama connection failed");
  return response;
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

app.post("/ai/action", async (req, res) => {
  const { text = "", action = "improve", instruction = "", model = DEFAULT_MODEL } = req.body;
  if (!text.trim()) return res.status(400).json({ error: "النص مطلوب" });
  const promptFn = ACTION_PROMPTS[action];
  if (!promptFn) return res.status(400).json({ error: `إجراء غير معروف: ${action}` });
  const prompt = instruction ? `${promptFn(text)}\n\nتعليمات إضافية: ${instruction}` : promptFn(text);
  try {
    const response = await ollamaGenerate(prompt, model, false);
    const data = await response.json();
    return res.json({ result: data.response || "" });
  } catch (error) {
    return res.status(502).json({ error: error.message || "فشل الاتصال بـ Ollama" });
  }
});

app.post("/ai/stream", async (req, res) => {
  const { text = "", action = "improve", instruction = "", model = DEFAULT_MODEL, docContent = "" } = req.body;
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
  try {
    const ollamaRes = await ollamaGenerate(prompt, model, true);
    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.response) res.write(`data: ${JSON.stringify({ text: parsed.response })}\n\n`);
          if (parsed.done) res.write("data: [DONE]\n\n");
        } catch {}
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
    await fsp.writeFile(path.join(projectDir, "_project.json"), JSON.stringify(meta, null, 2), "utf-8");
    res.json(meta);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /fs/projects/:id — rename / update project
app.put("/fs/projects/:id", async (req, res) => {
  try {
    const folder = await findProjectFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const metaPath = path.join(folder, "_project.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    const { title, gradient } = req.body;
    if (title !== undefined) meta.title = title;
    if (gradient !== undefined) meta.gradient = gradient;
    meta.updatedAt = new Date().toISOString();
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    res.json(meta);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /fs/projects/:id — delete project folder
app.delete("/fs/projects/:id", async (req, res) => {
  try {
    const folder = await findProjectFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    await fsp.rm(folder, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fs/projects/:id/docs — list documents (metadata only, no content)
app.get("/fs/projects/:id/docs", async (req, res) => {
  try {
    const folder = await findProjectFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const files = await fsp.readdir(folder);
    const docs = [];
    for (const file of files) {
      if (!file.endsWith(".json") || file === "_project.json") continue;
      try {
        const doc = JSON.parse(await fsp.readFile(path.join(folder, file), "utf-8"));
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
    const folder = await findProjectFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const doc = { ...req.body };
    if (!doc.id) doc.id = genId();
    doc.createdAt = doc.createdAt || new Date().toISOString();
    doc.updatedAt = new Date().toISOString();
    await fsp.writeFile(path.join(folder, `${doc.id}.json`), JSON.stringify(doc, null, 2), "utf-8");
    // bump project updatedAt
    try {
      const mp = path.join(folder, "_project.json");
      const meta = JSON.parse(await fsp.readFile(mp, "utf-8"));
      meta.updatedAt = new Date().toISOString();
      await fsp.writeFile(mp, JSON.stringify(meta, null, 2), "utf-8");
    } catch {}
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /fs/projects/:id/docs/:docId — save / update document
app.put("/fs/projects/:id/docs/:docId", async (req, res) => {
  try {
    const folder = await findProjectFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    const doc = { ...req.body, updatedAt: new Date().toISOString() };
    await fsp.writeFile(path.join(folder, `${req.params.docId}.json`), JSON.stringify(doc, null, 2), "utf-8");
    // bump project updatedAt
    try {
      const mp = path.join(folder, "_project.json");
      const meta = JSON.parse(await fsp.readFile(mp, "utf-8"));
      meta.updatedAt = new Date().toISOString();
      await fsp.writeFile(mp, JSON.stringify(meta, null, 2), "utf-8");
    } catch {}
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /fs/projects/:id/docs/:docId — delete document
app.delete("/fs/projects/:id/docs/:docId", async (req, res) => {
  try {
    const folder = await findProjectFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "Project not found" });
    await fsp.unlink(path.join(folder, `${req.params.docId}.json`));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ Aragon Write backend running on http://localhost:${PORT}`);
  console.log(`  Ollama: ${OLLAMA_BASE} | Model: ${DEFAULT_MODEL}`);
  console.log(`  Storage: ${STORAGE_ROOT}`);
});
