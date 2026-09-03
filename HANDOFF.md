# 🤝 HANDOFF — Aragon Write

> ملاحظات تسليم بين الجلسات. آخر تحديث: 2026-09-03.

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

## 📂 خريطة المجلدات (الحالية)

| المسار | المحتوى |
|---|---|
| `D:\past pro\repos\aragon-write\` | 🟢 **المصدر** — git-linked بـ GitHub. اشتغل هنا فقط. |
| `C:\Users\arago\Documents\Aragon Write\` | 🟢 **بيانات المستخدم** — مشاريعه ومستنداته. لا تلمسها. |
| `C:\Users\arago\AppData\Local\Programs\Aragon Write\` | 📦 **النسخة المثبتة** اللي يفتحها اختصار سطح المكتب. نفس مخرجات electron-packager (بدون asar). |
| `D:\past pro\repos\aragon-write\app-release\` | 📦 آخر بناء Windows (`npm run dist:win`) — ~356 MB |
| `D:\past pro\repos\backups\` | 🗄️ نسخ احتياطية (zip قبل إعادة التصميم + resources النسخة المثبتة القديمة) |

**تحديث النسخة المثبتة يدوياً** (لو ما تبي تعيد التثبيت): أغلق التطبيق، ثم انسخ محتويات `app-release\Aragon Write-win32-x64\` فوق مجلد النسخة المثبتة.

---

## 🎨 التصميم الحالي — «غرفة كتابة ليلية» (سبتمبر 2026)

إعادة تصميم كاملة، الفرع `experiment/visual-changes` مدموج في `main`.

- **ملف واحد للأنماط:** `frontend/src/app.css` (حُذف `styles.css` و `redesign.css`). لا أنماط inline في المكوّنات — أي عنصر جديد يستخدم الـ tokens: `--gold`, `--surface`, `--line`, `--text-2`, `--r-*`, `--ease`.
- **ثلاث سمات:** `dark` (ليل — الافتراضي)، `light` (نهار)، `sepia` (ورق). تُطبّق عبر `data-theme` على `<html>`.
- **الخطوط مضمّنة بدون إنترنت:** IBM Plex Sans Arabic (واجهة) + Amiri (محرر/عناوين) في `frontend/src/assets/fonts/` عبر `@font-face` نسبي — يشتغل تحت `file://` في Electron.
- **الأشرطة عائمة زجاجية** (topbar / toolbar / statusbar) والورقة بإطار مزدوج وتملأ العرض. ترتيب الطبقات صريح: topbar (30) > toolbar (20) > editor-layout (1) لأن `backdrop-filter` ينشئ stacking context.
- **الاستجابة:** ≤1100 (آيباد أفقي)، ≤860 (آيباد عمودي: يختفي جدول المحتويات والمساعد يصير لوحة عائمة)، ≤600 (هاتف: نوافذ من الأسفل، شريط علوي مضغوط، بدون زجاج). مع `env(safe-area-inset-*)`.
- **حركات الدخول** بـ `animation-fill-mode: backwards` (القاعدة الأخيرة في الملف) حتى لا يبقى `filter/transform` بعد الحركة.

---

## 🖥️ Stack المشروع

- **Electron 41** + **React 18** + **JavaScript (.jsx)**
- **npm workspaces**: `frontend` + `backend`
- **TipTap 2** للمحرر · **Vite 5** · **Express 4**
- **Ollama** (local LLM) — الموديل الافتراضي `gemma4:e4b` · أو API خارجي متوافق مع OpenAI
- Vite يقسّم الحزم: `react` / `editor` (tiptap+prosemirror) / `icons` / `index`

---

## ⚙️ أوامر سريعة

```bash
npm run electron:dev   # تطوير (Electron + hot-reload). main.cjs لا يشغّل backend ثانٍ في dev.
npm run dist:win       # بناء Windows → app-release/Aragon Write-win32-x64/
npm run dist:mac       # بناء macOS (يُنفّذ على ماك) → app-release/Aragon Write-darwin-{arm64,x64}/
cd frontend && node --test tests/   # اختبارات الحفظ التلقائي
```

### ملاحظات البناء (مهم)
- **Node 24 + electron-packager:** فك ضغط Electron كان يتوقف بصمت (extract-zip + yauzl 2). الحل موجود في `package.json` → `"overrides": { "yauzl": "^3.2.0" }`. لا تحذفه.
- **الماك:** لازم يُبنى على جهاز ماك (البناء من ويندوز يكسر الروابط الرمزية داخل `.app`). أيقونة الماك `electron/icon.icns` مولّدة من `logo.png`. `main.cjs` يبني قائمة تطبيق (roles) على darwin حتى تشتغل Cmd+C/V/Z. `backend` يشغّل Ollama على الماك عبر `open -a Ollama` ثم مسارات Homebrew/usr-local.
- النسخ غير موقّعة (Windows SmartScreen / macOS Gatekeeper يحذّران أول مرة).

---

## 🔧 GitHub

- **Repo**: https://github.com/aragonaragon/aragon-write
- **Branch**: `main` (يحتوي إعادة التصميم كاملة) · فرع العمل السابق `experiment/visual-changes`
- **المالك**: `aragonaragon` ([nathoool92@gmail.com](mailto:nathoool92@gmail.com))

---

## 🧭 سلوكيات مهمة في الكود

| الموضوع | الملف |
|---|---|
| مشروع بدون فصول → ينشئ فصلاً تلقائياً (وإلا يضيع النص) | `frontend/src/App.jsx` (effect بعد `createDocument`) |
| الحفظ: مسودة فورية في localStorage + كتابة على القرص بعد 0.7 ث | `frontend/src/lib/autosave.js`, `App.jsx` |
| السمة الافتراضية للمستخدم الجديد | `App.jsx` → `DEFAULT_SETTINGS.theme = "dark"` |
| برومبتات الإجراءات / المحادثة | `backend/src/server.js` (`ACTION_PROMPTS`) |
| تشغيل/إيقاف Ollama حسب النظام | `backend/src/server.js` (`/ollama/start`, `/ollama/kill`) |
| Electron main + backend (utilityProcess) | `electron/main.cjs` |
| مسار تخزين المستخدم | `backend/src/server.js:20-25` (`STORAGE_ROOT`) |

---

## 🐛 معروف / متبقٍ

1. **اختبارات الواجهة** غير موجودة (فقط اختبار autosave). التحقق البصري يُعمل يدوياً.
2. **الجوال/الآيباد** التصميم جاهز لكن التطبيق Electron؛ للاستخدام من متصفح الجوال يلزم فتح الباك إند على الشبكة المحلية وجعل `VITE_API_URL` قابلاً للضبط.
3. عمليات Node قديمة أحياناً تحتل المنافذ 3001 / 5173:
   ```powershell
   Get-Process -Name electron, node | Where-Object { $_.Id -ne $PID } | Stop-Process -Force
   ```

---

## 🎨 تفضيلات المستخدم الملاحَظة

- يبي حلولاً **كاملة** لا ترقيعات، ويختار "استعمل مهاراتك" بدل الخيارات
- يفضّل **العربية** (الخليجية) في الردود، وردوداً موجزة
- يقلق من فوضى الملفات ونسخ AI القديمة
- جهازه متوسط-قوي (موديلات حتى 26B)
- يستعمل التطبيق على **ويندوز وماك**

*— نهاية HANDOFF —*
