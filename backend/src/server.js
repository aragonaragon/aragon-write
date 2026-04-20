import cors from "cors";
import express from "express";

const app = express();
const PORT = Number(process.env.PORT || 3001);
const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.MODEL || "qwen2.5:7b";
const wordCache = new Map();

// ─── AI Action Prompts ────────────────────────────────────────────────────────

const ACTION_PROMPTS = {
  rewrite: (text) =>
    `أعد صياغة النص التالي بأسلوب أفضل مع الحفاظ على المعنى الأصلي. اكتب فقط النص المُعاد صياغته بدون أي مقدمة أو شرح:\n\n${text}`,
  improve: (text) =>
    `حسّن النص التالي من حيث الأسلوب والوضوح والتدفق الأدبي. اكتب فقط النص المحسّن بدون أي مقدمة أو شرح:\n\n${text}`,
  shorter: (text) =>
    `اختصر النص التالي مع الحفاظ على الأفكار الرئيسية. اكتب فقط النص المختصر بدون أي مقدمة أو شرح:\n\n${text}`,
  longer: (text) =>
    `وسّع النص التالي بإضافة تفاصيل وصفية وأدبية أكثر ثراءً. اكتب فقط النص الموسّع بدون أي مقدمة أو شرح:\n\n${text}`,
  continue: (text) =>
    `استكمل الكتابة الأدبية التالية بنفس الأسلوب والنبرة. اكتب فقط الجزء التالي بدون أي مقدمة:\n\n${text}`,
  translate_en: (text) =>
    `ترجم النص التالي إلى الإنجليزية ترجمة أدبية جميلة. اكتب فقط الترجمة بدون أي مقدمة:\n\n${text}`,
  translate_ar: (text) =>
    `ترجم النص التالي إلى العربية الفصحى الجميلة. اكتب فقط الترجمة بدون أي مقدمة:\n\n${text}`,
  fix_grammar: (text) =>
    `صحّح الأخطاء الإملائية والنحوية في النص التالي. اكتب فقط النص المصحح بدون أي مقدمة أو شرح:\n\n${text}`,
  ideas: (text) =>
    `بناءً على النص التالي، اقترح 5 أفكار إبداعية لتطوير الحبكة أو الشخصيات. قدّم كل فكرة في سطر واحد واضح:\n\n${text}`,
  outline: (text) =>
    `اقترح مخططاً تفصيلياً لقصة أو مقال بناءً على الموضوع التالي. قدّم المخطط بشكل منظم:\n\n${text}`,
  titles: (text) =>
    `اقترح 5 عناوين جذابة وإبداعية لنص يتناول الموضوع التالي. قدّم كل عنوان في سطر واحد:\n\n${text}`,
  chat: (docContent, message) =>
    `أنت مساعد كتابي إبداعي. السياق هو المستند التالي:\n\n---\n${docContent}\n---\n\nالسؤال أو الطلب: ${message}\n\nأجب بشكل مفيد ومحدد:`,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeWord(word) {
  return word.trim().replace(/\u0640/g, "");
}

function isArabicWord(word) {
  return /[\p{Script=Arabic}]/u.test(word);
}

function isNumberOnly(word) {
  return /^[\p{Number}]+$/u.test(word);
}

function sanitizeSuggestion(text) {
  return text
    .trim()
    .replace(/^["'«»""]+|["'«»""]+$/g, "")
    .replace(/[.،,:؛!?]+$/g, "")
    .trim();
}

function parseWordCheck(rawOutput, originalWord) {
  const cleaned = typeof rawOutput === "string"
    ? rawOutput.replace(/```/g, "").trim()
    : "";
  if (!cleaned) return { correct: true };

  const firstLine = cleaned.split(/\r?\n/)[0]?.trim() || "";

  if (firstLine === "صحيحة" || /^صحيحة[.،!]*$/u.test(firstLine)) {
    return { correct: true };
  }

  const suggestionMatch =
    cleaned.match(/خطأ\s*:\s*(.+)/u) ||
    firstLine.match(/خطأ\s*:\s*(.+)/u);

  if (!suggestionMatch) return { correct: true };

  const suggestion = sanitizeSuggestion(suggestionMatch[1] || "");
  if (!suggestion || suggestion === originalWord) return { correct: true };

  return { correct: false, suggestion };
}

async function ollamaGenerate(prompt, model, stream = false) {
  const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream,
      options: { temperature: 0.7, num_predict: 2048 },
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(details || "Ollama connection failed");
  }
  return response;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true, ollama: OLLAMA_BASE, model: DEFAULT_MODEL });
});

// List available Ollama models
app.get("/models", async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!response.ok) {
      return res.status(502).json({ error: "Cannot reach Ollama", models: [] });
    }
    const data = await response.json();
    const models = (data.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
    }));
    return res.json({ models });
  } catch {
    return res.status(502).json({ error: "Ollama not running", models: [] });
  }
});

// Non-streaming AI action (for quick operations)
app.post("/ai/action", async (req, res) => {
  const { text = "", action = "improve", instruction = "", model = DEFAULT_MODEL } = req.body;

  if (!text.trim()) {
    return res.status(400).json({ error: "النص مطلوب" });
  }

  const promptFn = ACTION_PROMPTS[action];
  if (!promptFn) {
    return res.status(400).json({ error: `إجراء غير معروف: ${action}` });
  }

  const prompt = instruction
    ? `${promptFn(text)}\n\nتعليمات إضافية: ${instruction}`
    : promptFn(text);

  try {
    const response = await ollamaGenerate(prompt, model, false);
    const data = await response.json();
    return res.json({ result: data.response || "" });
  } catch (error) {
    console.error("AI action failed:", error);
    return res.status(502).json({ error: error.message || "فشل الاتصال بـ Ollama" });
  }
});

// Streaming AI endpoint (SSE)
app.post("/ai/stream", async (req, res) => {
  const { text = "", action = "improve", instruction = "", model = DEFAULT_MODEL, docContent = "" } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const promptFn = ACTION_PROMPTS[action];
  let prompt;

  if (action === "chat") {
    prompt = ACTION_PROMPTS.chat(docContent || text, instruction || text);
  } else if (!promptFn) {
    res.write(`data: ${JSON.stringify({ error: "إجراء غير معروف" })}\n\n`);
    return res.end();
  } else {
    const base = promptFn(text);
    prompt = instruction ? `${base}\n\nتعليمات إضافية: ${instruction}` : base;
  }

  try {
    const ollamaRes = await ollamaGenerate(prompt, model, true);
    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.response) {
            res.write(`data: ${JSON.stringify({ text: parsed.response })}\n\n`);
          }
          if (parsed.done) {
            res.write("data: [DONE]\n\n");
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } catch (error) {
    console.error("Stream failed:", error);
    res.write(`data: ${JSON.stringify({ error: error.message || "فشل الاتصال" })}\n\n`);
  }

  res.end();
});

// Spellcheck (existing functionality)
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

  if (!word || !isArabicWord(word) || isNumberOnly(word)) {
    return res.json({ correct: true });
  }
  if (wordCache.has(word)) {
    return res.json(wordCache.get(word));
  }

  try {
    const model = req.body?.model || DEFAULT_MODEL;
    const response = await ollamaGenerate(
      `${WORD_CHECK_PROMPT}\nالكلمة: ${word}`,
      model,
      false
    );
    const data = await response.json();
    const result = parseWordCheck(data.response || "", word);
    wordCache.set(word, result);
    return res.json(result);
  } catch (error) {
    console.error("Spellcheck failed:", error);
    return res.json({ correct: true });
  }
});

app.listen(PORT, () => {
  console.log(`✓ Aragon Write backend running on http://localhost:${PORT}`);
  console.log(`  Ollama: ${OLLAMA_BASE} | Model: ${DEFAULT_MODEL}`);
});
