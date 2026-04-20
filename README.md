# Aragon Write ✍️

محرر كتابة عربي محلي 100% مع ذكاء اصطناعي — يشبه Google Docs، يعمل بالكامل على جهازك بدون إنترنت وبدون سحابة.

## المميزات

- **محرر WYSIWYG** — Bold، Italic، Underline، Headings 1-6، Lists، Alignment، Color، Font، Highlight، Link
- **دعم عربي كامل** — RTL، خطوط عربية جميلة
- **مساعد AI محلي** — 11 إجراء (إعادة صياغة، تحسين، اختصار، إطالة، ترجمة، تصحيح...) + محادثة مع المستند
- **Streaming حقيقي** — النص يظهر حرفاً بحرف من Ollama
- **جدول المحتويات** — يستخرج العناوين تلقائياً من المستند
- **إدارة المستندات** — إنشاء، حفظ تلقائي، تصدير (TXT، HTML، Markdown)
- **Dark / Light mode** قابل للتبديل بزر واحد
- **تحكم بالحجم** — Zoom من 50% حتى 250% للشاشات الكبيرة
- **تدقيق إملائي** — يعمل عند الطلب فقط
- **خصوصية تامة** — كل شيء على جهازك، لا سحابة، لا تسجيل

## المتطلبات

- **Node.js** 18+
- **Ollama** — [تنزيل من ollama.com](https://ollama.com/download)

## التثبيت والتشغيل

```bash
# 1. تشغيل Ollama
ollama serve

# 2. تنزيل موديل (اختر أي واحد)
ollama pull qwen2.5:7b      # موصى به للعربية
# ollama pull llama3.1:8b
# ollama pull gemma2:9b

# 3. تثبيت الحزم
npm install

# 4. تشغيل التطبيق
npm run dev
```

افتح المتصفح على: **http://localhost:5173**

## الخدمات

| الخدمة | العنوان |
|--------|---------|
| الواجهة | http://localhost:5173 |
| الخادم  | http://localhost:3001 |
| Ollama  | http://localhost:11434 |

## هيكل المشروع

```
aragon-write/
├── frontend/                    # React 18 + Vite + TipTap
│   └── src/
│       ├── App.jsx              # الحالة الرئيسية والـ layout
│       ├── styles.css           # نظام التصميم (CSS variables + dark mode)
│       ├── components/
│       │   ├── Toolbar.jsx          # شريط تنسيق النص الكامل
│       │   ├── AIPanel.jsx          # لوحة AI مع streaming SSE
│       │   ├── OutlineSidebar.jsx   # جدول المحتويات التلقائي
│       │   ├── DocumentManager.jsx  # إنشاء / فتح / تصدير المستندات
│       │   ├── Settings.jsx         # إعدادات Ollama والمظهر
│       │   └── StatusBar.jsx        # شريط الحالة السفلي
│       └── extensions/
│           └── spellcheck.js    # TipTap extension للتدقيق الإملائي
├── backend/                     # Express.js
│   └── src/server.js            # AI endpoints + Ollama proxy
└── package.json                 # Monorepo workspace
```

## API

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/health` | فحص الاتصال |
| GET | `/models` | قائمة موديلات Ollama المتاحة |
| POST | `/ai/stream` | إجراءات AI بـ SSE streaming |
| POST | `/ai/action` | إجراء AI بدون streaming |
| POST | `/check-word` | تدقيق كلمة عربية واحدة |

## الأوامر

```bash
npm run dev           # تشغيل frontend + backend معاً
npm run dev:frontend  # frontend فقط
npm run dev:backend   # backend فقط
npm run build         # بناء للإنتاج
```

## ملاحظة عن التخزين

المستندات محفوظة في `localStorage` في المتصفح. صدّر نسخاً دورية عبر زر **المستندات** ← **HTML / TXT / MD** لحماية كتابتك.

## استكشاف المشكلات

```bash
# Ollama لا يعمل
ollama serve

# الموديل غير موجود
ollama pull qwen2.5:7b

# تغيير الموديل أو URL: اضغط ⚙ في التطبيق
```

---

مبني بـ React · TipTap · Express · Ollama
