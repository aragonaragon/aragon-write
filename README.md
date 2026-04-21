# ✍️ Aragon Write — محرر الكتابة العربي الذكي

تطبيق desktop محلي لكتابة الروايات والمحتوى العربي، مدعوم بذكاء اصطناعي محلي عبر Ollama.

**100% محلي · بدون إنترنت · بدون اشتراك · Windows**

---

## جدول المحتويات

- [للمستخدم: التشغيل السريع](#للمستخدم-التشغيل-السريع)
- [للمطور: التشغيل للتطوير](#للمطور-التشغيل-للتطوير)
- [بنية المشروع](#بنية-المشروع)
- [الـ API](#الـ-api)
- [البناء والتوزيع](#البناء-والتوزيع)
- [المميزات](#المميزات)
- [ملاحظات مهمة — اقرأها قبل تعديل أي شيء](#ملاحظات-مهمة)

---

## للمستخدم: التشغيل السريع

1. فك ضغط `Aragon-Write-portable.zip`
2. دبل كليك على `Aragon Write.exe`
3. خلاص — لا يحتاج Node.js أو أي تثبيت

> للذكاء الاصطناعي: ثبّت [Ollama](https://ollama.com/download) وشغّل `ollama pull qwen2.5:7b`

---

## للمطور: التشغيل للتطوير

**المتطلبات:** Node.js 20+ · npm 10+

```bash
# تثبيت الحزم
npm install

# تشغيل dev (browser على localhost:5173)
npm run dev

# أو كـ Electron window
npm run electron:dev
```

---

## بنية المشروع

```
aragon write/
│
├── frontend/                        # React 18 + Vite 5 + TipTap 2
│   ├── src/
│   │   ├── App.jsx                  # ← نقطة البداية، كل الـ state هنا
│   │   ├── styles.css               # كل الـ CSS في ملف واحد (variables + themes)
│   │   ├── components/
│   │   │   ├── AIPanel.jsx          # لوحة الذكاء الاصطناعي (streaming SSE)
│   │   │   ├── DocumentManager.jsx  # قائمة المستندات + حفظ/تصدير
│   │   │   ├── ProjectManager.jsx   # شبكة المشاريع (modal)
│   │   │   ├── OutlineSidebar.jsx   # فهرس العناوين التلقائي
│   │   │   ├── Settings.jsx         # إعدادات Ollama + مظهر + كتابة
│   │   │   ├── StatusBar.jsx        # شريط الحالة (كلمات، هدف، جلسة)
│   │   │   └── Toolbar.jsx          # شريط تنسيق النص
│   │   └── extensions/
│   │       └── spellcheck.js        # TipTap extension للتدقيق الإملائي
│   └── vite.config.js               # ⚠️ base: "./" — لا تحذفه (مهم لـ Electron)
│
├── backend/                         # Node.js 20 + Express 4
│   └── src/
│       └── server.js                # كل الـ API في ملف واحد (ES Modules)
│
├── electron/
│   ├── main.cjs                     # Electron main process (CommonJS)
│   └── splash.html                  # شاشة التحميل (HTML순수)
│
├── assets/                          # أيقونات (أضف icon.ico هنا للـ packaging)
├── build.bat                        # بناء + zip بضغطة واحدة
├── launch.bat                       # تشغيل النسخة المحزومة
└── package.json                     # npm workspaces root
```

---

## الـ API

**Base URL (dev + prod):** `http://localhost:3001`

### الصحة والموديلات
| Method | Path | الوصف |
|--------|------|-------|
| GET | `/health` | فحص حالة الـ backend |
| GET | `/models` | قائمة موديلات Ollama المتاحة |

### الذكاء الاصطناعي
| Method | Path | الوصف |
|--------|------|-------|
| POST | `/ai/action` | تنفيذ إجراء AI (استجابة كاملة) |
| POST | `/ai/stream` | تنفيذ إجراء AI مع streaming (SSE) |
| POST | `/check-word` | تدقيق إملائي لكلمة واحدة |

**الإجراءات المتاحة (`action` field):**
| الإجراء | الوصف |
|---------|-------|
| `rewrite` | إعادة صياغة |
| `improve` | تحسين الأسلوب |
| `shorter` | تقصير |
| `longer` | إطالة |
| `continue` | الاستكمال |
| `translate_en` | ترجمة للإنجليزية |
| `translate_ar` | ترجمة للعربية |
| `fix_grammar` | تصحيح إملائي/نحوي |
| `ideas` | اقتراح أفكار |
| `outline` | مخطط تفصيلي |
| `titles` | اقتراح عناوين |
| `chat` | محادثة مع المستند |

**مثال request:**
```json
POST /ai/stream
{
  "text": "النص المراد تحسينه",
  "action": "improve",
  "model": "qwen2.5:7b"
}
```

### التحكم في Ollama
| Method | Path | الوصف |
|--------|------|-------|
| POST | `/ollama/start` | يشغّل `ollama serve` |
| POST | `/ollama/kill` | يوقف `ollama.exe` (Windows) |

### المشاريع والمستندات
| Method | Path | الوصف |
|--------|------|-------|
| GET | `/fs/projects` | كل المشاريع |
| POST | `/fs/projects` | إنشاء مشروع |
| PUT | `/fs/projects/:id` | تعديل اسم/gradient |
| DELETE | `/fs/projects/:id` | حذف مشروع كامل |
| GET | `/fs/projects/:id/docs` | مستندات المشروع |
| POST | `/fs/projects/:id/docs` | إنشاء مستند |
| PUT | `/fs/projects/:id/docs/:docId` | حفظ مستند |
| DELETE | `/fs/projects/:id/docs/:docId` | حذف مستند |

**مكان الحفظ على القرص:** `~/Documents/AragonWrite/<project-id>/`

كل مشروع = مجلد يحتوي:
- `_project.json` — metadata (id, title, gradient, updatedAt)
- `<docId>.json` — محتوى كل مستند (TipTap JSON)

---

## البناء والتوزيع

### بناء portable app
```bash
# دبل كليك على build.bat
# أو:
npm run dist
```

الناتج في `app-release/Aragon Write-win32-x64/` + ZIP جاهز.

### ما يحدث خطوة بخطوة
```
npm run build        → Vite يبني frontend/dist/
npm run build:backend → esbuild يحزم server.js → backend/dist/server.cjs (1.2MB)
electron-packager    → يجمع كل شيء في Aragon Write.exe (≈212MB)
```

### كيف يعمل الـ backend في الـ exe
في وضع الإنتاج (`app.isPackaged = true`)، الـ backend يشتغل عبر:
```javascript
utilityProcess.fork(path.join(process.resourcesPath, "server.cjs"))
```
هذا يشغّل `server.cjs` كـ subprocess مستقل داخل Electron's Node.js — **بدون حاجة لـ Node.js مثبت على الجهاز**.

---

## المميزات

| الميزة | التفاصيل |
|--------|---------|
| محرر نصوص | TipTap WYSIWYG كامل، RTL |
| مشاريع | كل مشروع مجلد JSON مستقل |
| ثيمات | فاتح / داكن / عاجي (sepia) |
| Focus Mode | F11 — يخفي كل شيء إلا النص |
| Typewriter Mode | يثبّت المؤشر في 40% من الشاشة |
| هدف يومي | شريط تقدم في الأسفل |
| عداد الجلسة | كلمات كتبتها في هذه الجلسة |
| AI Panel | 12 إجراء + chat مع المستند |
| Streaming | النص يظهر حرفاً بحرف |
| تدقيق إملائي | عبر Ollama، يعمل أثناء الكتابة |
| Kill/Start Ollama | من داخل الإعدادات |

---

## ملاحظات مهمة

### ⚠️ 1. `base: "./"` في vite.config.js
**لا تحذفه أبداً.** بدونه assets تُحمّل بمسارات مطلقة (`/assets/...`) وتفشل في `file://` protocol داخل Electron — الصفحة تبقى بيضاء.

### ⚠️ 2. `utilityProcess.fork()` في electron/main.cjs
يشغّل الـ backend كـ subprocess. **لا تستبدله بـ `require()`** — يسبب hang في splash screen لأن `require()` يشغّل الكود في نفس process الـ Electron ويتعارض مع بيئته.

### ⚠️ 3. اسم مجلد التخزين
`~/Documents/AragonWrite` (camelCase، بدون مسافة). إذا غيّرت الاسم، عدّل `STORAGE_ROOT` في `backend/src/server.js` وانقل بيانات المستخدمين.

### ⚠️ 4. ES Modules في الـ backend
`server.js` يستخدم `import/export`. esbuild يحوّله لـ CJS عند البناء. لا تستخدم `require()` داخل `server.js`.

### 5. الخطوط من Google Fonts
تُحمّل من الإنترنت. في بيئة offline يظهر الـ fallback `Segoe UI/Arial`. للعمل offline الكامل: حمّل Cairo و Amiri محلياً في `frontend/public/fonts/`.

---

## Stack

```
Frontend:   React 18 · TipTap 2 · Vite 5 · Lucide Icons
Backend:    Node.js 20 · Express 4
Bundler:    esbuild (backend) · Rollup via Vite (frontend)
Desktop:    Electron 41 (Chromium 130 + Node 20)
AI:         Ollama local — qwen2.5:7b / llama3.1 / gemma2
Storage:    JSON files على القرص — لا database
Platform:   Windows x64
```

---

## Scripts المرجعية

```bash
npm run dev            # تشغيل للتطوير (browser)
npm run electron:dev   # تشغيل للتطوير (Electron window)
npm run build          # بناء frontend فقط → frontend/dist/
npm run build:backend  # بناء backend فقط → backend/dist/server.cjs
npm run electron       # build + تشغيل Electron (prod mode)
npm run dist           # build كامل + packaging → app-release/
```

---

*v2.2.0 — آخر تحديث أبريل 2026*
