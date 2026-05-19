<div align="center">

# ✍️ أرغون رايت

### محرر الكتابة العربي الذكي

**اكتب روايتك أو محتواك — محلي 100%، بدون إنترنت، بدون اشتراك**

[![Download](https://img.shields.io/github/v/release/aragonaragon/aragon-write?label=تحميل&style=for-the-badge&color=c8956c)](https://github.com/aragonaragon/aragon-write/releases/latest)
[![Platform](https://img.shields.io/badge/Windows-x64-blue?style=for-the-badge&logo=windows)](https://github.com/aragonaragon/aragon-write/releases/latest)
[![License](https://img.shields.io/badge/مجاني-100%25-green?style=for-the-badge)](https://github.com/aragonaragon/aragon-write/releases/latest)

</div>

---

## 🚀 تحميل وتشغيل

<div align="center">

### [⬇️ تحميل أرغون رايت — Windows](https://github.com/aragonaragon/aragon-write/releases/latest)

</div>

1. حمّل `Aragon-Write-portable.zip`
2. فك الضغط في أي مكان
3. دبل كليك على `Aragon Write.exe`

> لا يحتاج تثبيت · لا يحتاج Node.js · لا يحتاج إنترنت

---

## ✨ المميزات

| الميزة | التفاصيل |
|--------|---------|
| 🏠 **شاشة بداية ذكية** | تختار مشروعك أو تكمل آخر فصل عدّلت عليه قبل ما تبدأ الكتابة |
| 🤖 **AI محلي أو سحابي** | Ollama محلي (افتراضي) **أو** Groq/OpenRouter/DeepSeek (للأجهزة الضعيفة) |
| 📚 **مكتبة مشاريع** | مجلد مستقل لكل مشروع محفوظ على قرصك |
| 🔀 **تبديل سريع بين الفصول** | قائمة منسدلة من شريط العنوان — تنقل/تسمية/إنشاء بضغطة |
| 💬 **محادثة مع المستند** | اسأل المساعد عن أي شي — معلومة، فكرة، أو شرح، مع سياق ذكي من نصك |
| 🎬 **سكربت يوتيوب** | حوّل قائمة أفكار إلى سكربت كامل جاهز للقراءة |
| ✍️ **محرر WYSIWYG** | تنسيق كامل مع دعم RTL العربي |
| 🎯 **Focus Mode** | F11 — يخفي كل شيء إلا النص |
| ⌨️ **Typewriter Mode** | يثبّت المؤشر في المنتصف |
| 🌙 **3 ثيمات** | فاتح / داكن / عاجي |
| 🎯 **هدف يومي** | شريط تقدم للكلمات |
| 🔒 **خصوصية تامة** | المستندات محلية دائماً، حتى مع الـ API الخارجي |

---

## 🤖 الذكاء الاصطناعي

عندك خياران — **اختر اللي يناسب جهازك**:

### الخيار 1: محلي 100% (Ollama)
للأجهزة المتوسطة-القوية، خصوصية كاملة، بدون إنترنت ولا تكلفة:

```bash
# 1. ثبّت Ollama من ollama.com
# 2. حمّل موديل عربي
ollama pull gemma4:e4b
```

### الخيار 2: API سحابي (للأجهزة الضعيفة)
جودة عالية بدون متطلبات هاردوير. **مستنداتك تبقى محلية** — فقط طلبات المساعد ترسل للسحابة.

| المزود | السعر | السرعة | الإنشاء |
|---|---|---|---|
| **Groq** ⭐ | مجاني (حد سخي) | ~300 tok/sec | [console.groq.com](https://console.groq.com) |
| **DeepSeek** | رخيص جداً | سريع | [platform.deepseek.com](https://platform.deepseek.com) |
| **OpenRouter** | بسعر موحّد | متوسط | [openrouter.ai](https://openrouter.ai) |

من **الإعدادات → مصدر الذكاء الاصطناعي**، اضغط على المزود → ألصق API key → جاهز.

**الإجراءات المتاحة:** إعادة صياغة · تحسين الأسلوب · اختصار · إطالة · استكمال · ترجمة · تصحيح إملائي · اقتراح أفكار · مخطط · عناوين · سكربت يوتيوب · محادثة مع المستند

---

## 📸 لقطات الشاشة

*قريباً*

---

## 🛠️ للمطورين

<details>
<summary>تشغيل للتطوير</summary>

**المتطلبات:** Node.js 20+

```bash
npm install
npm run dev          # browser على localhost:5173
npm run electron:dev # Electron window
npm run dist         # بناء portable .exe
```

**Stack:**
```
Frontend:  React 18 · TipTap 2 · Vite 5
Backend:   Node.js · Express 4 · esbuild
Desktop:   Electron 41
AI:        Ollama (local LLM)
Storage:   JSON files — ~/Documents/AragonWrite/
```

</details>

<details>
<summary>بنية المشروع</summary>

```
aragon write/
├── frontend/src/
│   ├── App.jsx              # State + Layout + Home/Editor switch
│   ├── components/
│   │   ├── Home.jsx         # شاشة البداية (اختيار المشروع)
│   │   ├── DocSwitcher.jsx  # قائمة تبديل الفصول
│   │   ├── AIPanel.jsx      # AI streaming + chat panel
│   │   ├── DocumentManager.jsx
│   │   ├── ProjectManager.jsx
│   │   ├── Settings.jsx
│   │   └── StatusBar.jsx
│   └── extensions/spellcheck.js
├── backend/src/server.js    # Express API + Ollama proxy
├── electron/main.cjs        # Electron main process
└── electron/splash.html     # Loading screen
```

</details>

<details>
<summary>API Reference</summary>

`GET /health` · `GET /models` · `POST /ai/action` · `POST /ai/stream` · `POST /check-word`

`POST /ollama/start` · `POST /ollama/kill`

`GET|POST|PUT|DELETE /fs/projects`

`GET|POST|PUT|DELETE /fs/projects/:id/docs/:docId`

</details>

---

## 📬 التواصل

لأي اقتراح، بلاغ خطأ، أو طلب ميزة:

- **GitHub Issues:** [aragonaragon/aragon-write/issues](https://github.com/aragonaragon/aragon-write/issues)
- **بريد إلكتروني:** [nathoool92@gmail.com](mailto:nathoool92@gmail.com)

---

<div align="center">

**مبني بـ React · TipTap · Electron · Ollama**

⭐ إذا أعجبك المشروع اعطه نجمة

</div>
