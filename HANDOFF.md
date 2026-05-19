# 🤝 HANDOFF — Aragon Write

> ملاحظات تسليم بين الجلسات. آخر تحديث: 2026-05-13.

---

## 🛡️ قواعد أمنية مهمة (اقرأها أول)

**تهديد npm نشط** — Mini Shai-Hulud / CVE-2026-45321 (تاريخ 2026-05-11).

**حزم محظورة — لا تنصّبها أبداً:**
- `@tanstack/*` (كل ما في الـ namespace)
- `@uipath/*`
- `@mistralai/mistralai`
- `guardrails-ai`
- `intercom-client`
- `opensearch-project/opensearch`

**قواعد الجلسة:**
1. **ما تضيف أي dependency جديد بدون إذن صريح من المستخدم** — قول الاسم وانتظر الموافقة
2. ما تلمس `.claude/` ولا `.vscode/`
3. بعد أي تعديل في dependencies → شغّل `npm audit` واعرض النتيجة
4. استخدم **npm** (مو pnpm) — المشروع يستخدم npm workspaces

---

## 🎯 ما تم في الجلسة السابقة

### دعم API خارجي (Groq / OpenRouter / DeepSeek) — للأجهزة الضعيفة

التطبيق صار يدعم OpenAI-compatible APIs كبديل عن Ollama المحلي.

**كيف يشتغل:**
- في **Settings → مصدر الذكاء الاصطناعي** المستخدم يختار بين "محلي (Ollama)" و"API خارجي"
- 3 إعدادات مسبقة بضغطة زر: Groq / OpenRouter / DeepSeek (تعبّي Base URL و model تلقائياً)
- API Key يحفظ في localStorage (غير مشفّر — مقبول لتطبيق محلي، تنبيه ظاهر للمستخدم)
- زر "اختبار الاتصال" يضرب `/models` ويرجع نتيجة فورية
- زر "جلب قائمة الموديلات" يعبّي dropdown بالموديلات المتاحة من الـ API

**ملفات مفتاحية:**
- `backend/src/server.js`:
  - `openaiCompatGenerate()` — POST `/chat/completions` بصيغة OpenAI
  - `aiGenerate()` — dispatcher يختار بين Ollama و OpenAI
  - `/health/provider` (POST) — اختبار اتصال
  - `/models/external` (POST) — جلب الموديلات
  - الـ streaming parser يحوّل صيغة OpenAI SSE (`data: {choices:[{delta:{content}}]}`) إلى الصيغة الموحّدة `data: {text}` للفرونت
- `frontend/src/lib/provider.js` — helpers (`getProviderName`, `isExternal`, `getActiveModel`)
- `frontend/src/components/Settings.jsx` — قسم Provider الكامل + `PROVIDER_PRESETS`
- `frontend/src/components/AIPanel.jsx` — `resolveProvider()` يمرّر providerConfig مع كل طلب
- StatusBar + Home — يبيّنون اسم المزود الحالي ("Groq متصل" بدل "Ollama متصل")

**السلوك المحمي:**
- التدقيق الإملائي يتعطّل تلقائياً في وضع API (تكلفة عالية لو كل كلمة تروح للسحابة)
- `/check-word*` ترجع 503 لو `providerConfig.type === "openai_compat"` (safety net)
- اللي يجي بـ Ollama (الافتراضي) ما يتأثر — كل التعديلات opt-in

---

### Commit `a60a61b` (مدفوع لـ GitHub)

**1. تبديل الموديل الافتراضي:** `qwen2.5:7b` → `gemma4:e4b`
- السبب: Qwen صيني، أحياناً يطلّع نص صيني بدل عربي
- gemma4:e4b أخف (~4B effective) ومناسب لأجهزة متوسطة-قوية
- ملفات: `backend/src/server.js:14`, `frontend/src/App.jsx:37`, `Settings.jsx`, `Welcome.jsx`, `README.md`

**2. تعميم تبويب المحادثة:**
- قبل: مساعد كتابي إجباري + المستند سياق إلزامي
- بعد: مساعد عام، يجاوب عن أي سؤال، المستند سياق اختياري إذا السؤال متعلق فيه
- ملف: `backend/src/server.js:99` (دالة `chat` في `ACTION_PROMPTS`)
- ملف: `frontend/src/components/AIPanel.jsx` (نص الترحيب + لا يتطلب editor)

**3. أزرار "أضف للمستند" + "نسخ" في كل رد محادثة:**
- تظهر تحت كل رد من المساعد (بعد ما يخلص)
- "أضف للمستند" يلصق في نهاية المستند الحالي
- ملفات: `AIPanel.jsx`، CSS في `styles.css` (`.chat-message__actions`)

---

## 📂 خريطة المجلدات (مهم — في فوضى ممكن تخربط)

| المسار | المحتوى |
|---|---|
| `C:\Users\aragon\Documents\AragonWrite\` | 🟢 **المصدر** — git-linked بـ GitHub. شغل هنا فقط. |
| `C:\Users\aragon\Documents\Aragon Write\` | 🟢 **بيانات المستخدم** — مستنداته المحفوظة. لا تلمسها. |
| `C:\Users\aragon\Documents\aragon aragon write\` | ⚠️ **مجلد فارغ غلطة** — يُنصح حذفه. لا تشتغل فيه. |
| `C:\Users\aragon\Documents\AragonWrite\app-release\` | 📦 آخر build (13 مايو، معه التعديلات الجديدة) ~345 MB |
| `C:\Users\aragon\Desktop\AragonWrite-2026-05-11.rar` | 🗄️ نسخة احتياطية مضغوطة (0.6 MB، بدون node_modules) |
| `C:\Users\aragon\Desktop\Aragon Write.lnk` | 🔗 Shortcut يفتح النسخة المبنية |

---

## 🖥️ Stack المشروع

- **Electron 41** + **React 18** + **JavaScript (.jsx)** (مو TypeScript)
- **npm workspaces**: `frontend` + `backend` (مو pnpm)
- **TipTap 2** للمحرر
- **Vite 5** للـ frontend dev server
- **Express 4** للـ backend
- **Ollama** (local LLM) — الموديل الافتراضي `gemma4:e4b`

---

## ⚙️ أوامر سريعة

```bash
# تطوير (Electron + hot-reload)
npm run electron:dev

# بناء portable .exe (~3-5 دقائق)
npm run dist

# تشغيل النسخة المبنية
# دبل كليك على Desktop\Aragon Write.lnk
```

---

## 🔧 GitHub

- **Repo**: https://github.com/aragonaragon/aragon-write
- **Branch**: `main`
- **Last commit**: `a60a61b` (مدفوع)
- **Git identity (local فقط، مو global)**: `aragonaragon` / `nathoool92@gmail.com`

---

## 🐛 مشاكل معروفة (Pre-existing، ما تم إصلاحها)

### 1. Dev script يصرف backend مرتين
**الموقع**: `electron/main.cjs:48` (دالة `startBackend`) + `package.json:17` (script `electron:dev`)

**المشكلة**: `npm run electron:dev` يطلق backend بـ concurrently، و Electron's main.cjs بعد يطلق backend خاص في `startBackend()`. النتيجة:
- خطأ `EADDRINUSE: address already in use :::3001` على الـ [0] (concurrently's backend)
- التطبيق يشتغل عادي (Electron's backend هو اللي يخدم) لكن بدون hot-reload للـ backend

**الحل المقترح**: في `electron/main.cjs`، تخطّى `startBackend()` لو `isDev === true` (لأن concurrently يطلقه أصلاً).

```js
// في main.cjs، حول السطر اللي يستدعي startBackend()
if (!isDev) {
  startBackend();
}
```

### 2. مجلدات orphan على المنافذ
أحياناً تتراكم عمليات Node قديمة على ports 3001 / 5173 من جلسات سابقة. الحل:
```powershell
Get-Process -Name electron, node | Where-Object { $_.Id -ne $PID } | Stop-Process -Force
```

---

## 🤖 موديلات Ollama المتوفرة محلياً

| الموديل | الحجم | للعربي | ملاحظة |
|---|---|---|---|
| **gemma4:e4b** ⭐ | ~4B | ممتاز | الافتراضي الحالي، خفيف |
| gemma4:26b | 26B | ممتاز | لأجهزة قوية |
| gemma2:9b | 9B | جيد | متوازن |
| jais-family-13b | 13B | متخصص عربي | بطيء نسبياً |
| qwen2.5 (7b/14b/32b) | متعددة | ضعيف عربي | يطلّع صيني أحياناً — تجنّبه |
| llama3.1/3.2 | متعددة | متوسط | |
| mistral-small3.1 | 24B | جيد | |

---

## 📝 ملفات مفتاحية للتعديل

| الموضوع | الملف:السطر |
|---|---|
| الموديل الافتراضي (backend) | `backend/src/server.js:14` |
| الموديل الافتراضي (frontend) | `frontend/src/App.jsx:37` |
| برومبتات الإجراءات (rewrite/improve/etc) | `backend/src/server.js:84-100` |
| برومبت المحادثة | `backend/src/server.js:99-107` |
| إجراءات المحادثة السريعة (UI) | `frontend/src/components/AIPanel.jsx:9-21` |
| تنسيقات المحادثة | `frontend/src/styles.css:775-820` |
| Electron main + backend spawn | `electron/main.cjs:48-87` |
| Storage path للمستخدم | `backend/src/server.js:21-23` |

---

## 🎨 تفضيلات المستخدم الملاحَظة

- يحب الحلول **البسيطة** ("ابي شي سهل")
- يفضّل **العربية** (الخليجية) في الردود
- يقلق من فوضى الملفات ونسخ AI القديمة
- جهازه **متوسط-قوي** (يقدر يشغّل موديلات حتى 26B)
- بعض الأحيان يكتب بسرعة وفيه أخطاء طباعة — تأكد قبل الإجراءات المدمّرة

---

## 🚀 خطوات سريعة لإكمال الشغل في الجلسة الجاية

1. **اقرأ هذا الملف كاملاً** قبل أي عمل
2. **لا تضف dependencies** بدون إذن صريح
3. تحقق من حالة git: `git status` و `git log -3 --oneline`
4. إذا التطبيق ما يشتغل، شيّك المنافذ: `netstat -ano | findstr ":3001 :5173"`
5. أي تعديل = مرّ المراجعة → commit → ادفع إذا المستخدم وافق

---

*— نهاية HANDOFF —*
