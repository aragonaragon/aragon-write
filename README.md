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
| 🤖 **AI محلي** | مدعوم بـ Ollama — يعمل بدون إنترنت وبدون اشتراك |
| 📚 **مكتبة مشاريع** | مجلد مستقل لكل رواية محفوظ على قرصك |
| ✍️ **محرر WYSIWYG** | تنسيق كامل مع دعم RTL العربي |
| 🎯 **Focus Mode** | F11 — يخفي كل شيء إلا النص |
| ⌨️ **Typewriter Mode** | يثبّت المؤشر في المنتصف |
| 🌙 **3 ثيمات** | فاتح / داكن / عاجي |
| 🎯 **هدف يومي** | شريط تقدم للكلمات |
| 🔒 **خصوصية تامة** | لا سحابة، لا تسجيل، لا إنترنت |

---

## 🤖 الذكاء الاصطناعي

التطبيق يتكامل مع **Ollama** لتشغيل موديلات AI محلية:

```bash
# 1. ثبّت Ollama من ollama.com
# 2. حمّل موديل عربي
ollama pull qwen2.5:7b
```

**الإجراءات المتاحة:** إعادة صياغة · تحسين · تقصير · إطالة · استكمال · ترجمة · تصحيح إملائي · اقتراح أفكار · مخطط · عناوين · محادثة مع المستند

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
│   ├── App.jsx              # State + Layout
│   ├── components/
│   │   ├── AIPanel.jsx      # AI streaming panel
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

<div align="center">

**مبني بـ React · TipTap · Electron · Ollama**

⭐ إذا أعجبك المشروع اعطه نجمة

</div>
