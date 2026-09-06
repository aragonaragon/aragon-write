import { useEffect, useState } from "react";
import { X, RefreshCw, CheckCircle, AlertCircle, Power, Play, Eye, EyeOff, Cloud, HardDrive, Plug } from "lucide-react";
import { isNativeIOS, NativeSecrets } from "../lib/native";
import { nativeListModels, nativeTestProvider } from "../lib/externalAI";

// Built-in presets for popular OpenAI-compatible providers.
// Users can edit Base URL/Model after applying, or fill them in manually.
const PROVIDER_PRESETS = {
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    hint: "سريع ومتعدد اللغات — احصل على المفتاح من console.groq.com",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    hint: "موديلات كثيرة بسعر موحّد — openrouter.ai/keys",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hint: "اقتصادي ومناسب للكتابة — platform.deepseek.com",
  },
};

function StatusLine({ ok, children }) {
  return (
    <div className={`settings-status${ok ? " is-ok" : " is-err"}`}>
      {ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
      <span>{children}</span>
    </div>
  );
}

export default function Settings({ settings, onUpdate, onClose, apiUrl, onOllamaStatusChange }) {
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(null);
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl);
  const [testStatus, setTestStatus] = useState(null);
  const [ollamaAction, setOllamaAction] = useState(null); // "killing" | "starting" | null

  // External provider state
  const [showKey, setShowKey] = useState(false);
  const [extModels, setExtModels] = useState([]);
  const [loadingExtModels, setLoadingExtModels] = useState(false);
  const [extTest, setExtTest] = useState(null); // { ok, error } | null
  const [testingExt, setTestingExt] = useState(false);

  const fetchModels = async () => {
    setLoadingModels(true);
    setModelError(null);
    try {
      const res = await fetch(`${apiUrl}/models`);
      const data = await res.json();
      if (data.models?.length > 0) {
        setModels(data.models);
        setTestStatus("success");
      } else {
        setModels([]);
        setModelError("لم يتم العثور على موديلات. تأكد من تشغيل Ollama وتحميل موديل.");
        setTestStatus("error");
      }
    } catch {
      setModelError("تعذر الاتصال بـ Ollama. تأكد من تشغيله على المنفذ الصحيح.");
      setTestStatus("error");
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => { if (!isNativeIOS) fetchModels(); }, []); // eslint-disable-line

  const saveOllamaUrl = () => {
    onUpdate({ ollamaUrl });
    fetchModels();
  };

  const killOllama = async () => {
    setOllamaAction("killing");
    try {
      await fetch(`${apiUrl}/ollama/kill`, { method: "POST" });
      setTestStatus(null);
      setModels([]);
      onOllamaStatusChange?.("error");
    } finally {
      setOllamaAction(null);
    }
  };

  const startOllama = async () => {
    setOllamaAction("starting");
    try {
      await fetch(`${apiUrl}/ollama/start`, { method: "POST" });
      setTimeout(() => {
        fetchModels();
        onOllamaStatusChange?.("online");
      }, 3000);
    } finally {
      setTimeout(() => setOllamaAction(null), 3200);
    }
  };

  // ── External provider helpers ──
  const applyPreset = (key) => {
    const preset = PROVIDER_PRESETS[key];
    if (!preset) return;
    onUpdate({
      apiBaseUrl: preset.baseUrl,
      apiModel: preset.model,
    });
    setExtTest(null);
    setExtModels([]);
  };

  const fetchExternalModels = async () => {
    if (!settings.apiBaseUrl || !settings.apiKey) {
      setExtTest({ ok: false, error: "أدخل رابط المزود ومفتاح API أولاً" });
      return;
    }
    setLoadingExtModels(true);
    setExtTest(null);
    try {
      if (isNativeIOS) {
        await NativeSecrets.set({ key: "external-api-key", value: settings.apiKey || "" });
        const models = await nativeListModels(settings.apiBaseUrl);
        setExtModels(models);
        if (models.length === 0) setExtTest({ ok: false, error: "لم يتم العثور على موديلات" });
        return;
      }
      const res = await fetch(`${apiUrl}/models/external`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey }),
      });
      const data = await res.json();
      if (res.ok && data.models?.length > 0) {
        setExtModels(data.models);
      } else {
        setExtModels([]);
        setExtTest({ ok: false, error: data.error || "لم يتم العثور على موديلات" });
      }
    } catch (err) {
      setExtTest({ ok: false, error: err.message || "فشل جلب الموديلات" });
    } finally {
      setLoadingExtModels(false);
    }
  };

  const testExternalConnection = async () => {
    if (!settings.apiBaseUrl || !settings.apiKey) {
      setExtTest({ ok: false, error: "أدخل رابط المزود ومفتاح API أولاً" });
      return;
    }
    setTestingExt(true);
    setExtTest(null);
    try {
      if (isNativeIOS) {
        await NativeSecrets.set({ key: "external-api-key", value: settings.apiKey || "" });
        setExtTest(await nativeTestProvider(settings.apiBaseUrl));
        return;
      }
      const res = await fetch(`${apiUrl}/health/provider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: settings.apiBaseUrl, apiKey: settings.apiKey }),
      });
      const data = await res.json();
      setExtTest(data);
    } catch (err) {
      setExtTest({ ok: false, error: err.message || "تعذّر الاتصال" });
    } finally {
      setTestingExt(false);
    }
  };

  const isExternal = settings.provider === "openai_compat";

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--settings" role="dialog" aria-modal="true" aria-label="الإعدادات">
        <div className="modal__header">
          <h2 className="modal__title">الإعدادات</h2>
          <button className="btn-icon" onClick={onClose} aria-label="إغلاق الإعدادات"><X size={18} /></button>
        </div>

        <div className="modal__body">

          {/* ── مصدر الذكاء الاصطناعي ── */}
          <section className="settings-section">
            <div className="settings-section__title">مصدر الذكاء الاصطناعي</div>

            <div className="provider-toggle" role="tablist">
              {!isNativeIOS && <button
                type="button"
                role="tab"
                aria-selected={!isExternal}
                className={`provider-tab${!isExternal ? " active" : ""}`}
                onClick={() => onUpdate({ provider: "ollama" })}
              >
                <HardDrive size={14} />
                محلي (Ollama)
              </button>}
              <button
                type="button"
                role="tab"
                aria-selected={isExternal}
                className={`provider-tab${isExternal ? " active" : ""}`}
                onClick={() => onUpdate({ provider: "openai_compat" })}
              >
                <Cloud size={14} />
                API خارجي
              </button>
            </div>

            {isExternal && (
              <>
                <div className="settings-field">
                  <label>إعدادات سريعة</label>
                  <div className="provider-presets">
                    {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                      <button
                        key={key}
                        type="button"
                        className={`provider-preset${settings.apiBaseUrl === p.baseUrl ? " active" : ""}`}
                        onClick={() => applyPreset(key)}
                        title={p.hint}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <span className="settings-field__hint">اضغط لتعبئة Base URL والموديل الافتراضي تلقائياً</span>
                </div>

                <div className="settings-field">
                  <label>Base URL</label>
                  <input
                    className="settings-input"
                    value={settings.apiBaseUrl || ""}
                    onChange={(e) => onUpdate({ apiBaseUrl: e.target.value })}
                    placeholder="https://api.groq.com/openai/v1"
                    dir="ltr"
                  />
                </div>

                <div className="settings-field">
                  <label>API Key</label>
                  <div className="provider-key">
                    <input
                      className="settings-input"
                      type={showKey ? "text" : "password"}
                      value={settings.apiKey || ""}
                      onChange={(e) => onUpdate({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      dir="ltr"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setShowKey((v) => !v)}
                      title={showKey ? "إخفاء" : "إظهار"}
                      aria-label={showKey ? "إخفاء المفتاح" : "إظهار المفتاح"}
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <span className="settings-field__hint">
                    يُحفظ المفتاح مشفّراً على جهازك عبر نظام التشغيل (Keychain على أجهزة Apple)، ولا يدخل ضمن ملفات الكتب أو النسخ الاحتياطية.
                  </span>
                </div>

                <div className="settings-field">
                  <div className="settings-field__head">
                    <label>الموديل</label>
                    <button
                      type="button"
                      className={`btn-icon${loadingExtModels ? " is-spinning" : ""}`}
                      onClick={fetchExternalModels}
                      disabled={loadingExtModels || !settings.apiBaseUrl || !settings.apiKey}
                      title="جلب قائمة الموديلات"
                      aria-label="جلب قائمة الموديلات"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  {extModels.length > 0 ? (
                    <select
                      className="settings-select"
                      value={settings.apiModel || ""}
                      onChange={(e) => onUpdate({ apiModel: e.target.value })}
                      dir="ltr"
                    >
                      <option value="">— اختر موديل —</option>
                      {extModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </select>
                  ) : (
                    <input
                      className="settings-input"
                      value={settings.apiModel || ""}
                      onChange={(e) => onUpdate({ apiModel: e.target.value })}
                      placeholder="llama-3.3-70b-versatile"
                      dir="ltr"
                    />
                  )}
                </div>

                <div className="settings-field">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={testExternalConnection}
                    disabled={testingExt || !settings.apiBaseUrl || !settings.apiKey}
                  >
                    <Plug size={13} />
                    {testingExt ? "جاري الاختبار..." : "اختبار الاتصال"}
                  </button>
                  {extTest && (
                    <StatusLine ok={!!extTest.ok}>
                      {extTest.ok ? "تم الاتصال بنجاح" : extTest.error}
                    </StatusLine>
                  )}
                </div>

                <div className="settings-note">
                  <p><strong>ملاحظة:</strong> بياناتك المكتوبة (المستندات والمشاريع) تبقى محلية على جهازك. فقط طلبات المساعد تُرسل إلى المزود الخارجي.</p>
                  <p><strong>التدقيق الإملائي يتعطّل تلقائياً</strong> في وضع API لتجنّب التكاليف.</p>
                </div>
              </>
            )}
          </section>

          {/* ── Ollama ── */}
          {!isNativeIOS && (<section className="settings-section">
            <div className="settings-section__title">إعدادات Ollama</div>

            <div className="settings-field">
              <label>عنوان Ollama URL</label>
              <div className="settings-row">
                <input
                  className="settings-input"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  dir="ltr"
                />
                <button className="btn btn-secondary" onClick={saveOllamaUrl}>
                  حفظ
                </button>
              </div>
              <span className="settings-field__hint">العنوان الافتراضي: http://localhost:11434</span>
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <label>الموديل النشط</label>
                <button
                  className={`btn-icon${loadingModels ? " is-spinning" : ""}`}
                  onClick={fetchModels}
                  title="تحديث"
                  aria-label="تحديث قائمة الموديلات"
                  disabled={loadingModels}
                >
                  <RefreshCw size={14} />
                </button>
              </div>

              {testStatus === "success" && (
                <StatusLine ok>Ollama يعمل — {models.length} موديل متاح</StatusLine>
              )}
              {testStatus === "error" && (
                <StatusLine ok={false}>{modelError}</StatusLine>
              )}

              {models.length > 0 ? (
                <select className="settings-select" value={settings.model} onChange={(e) => onUpdate({ model: e.target.value })} dir="ltr">
                  {models.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              ) : (
                <input
                  className="settings-input"
                  value={settings.model}
                  onChange={(e) => onUpdate({ model: e.target.value })}
                  placeholder="مثال: gemma4:e4b أو gemma2:9b"
                  dir="ltr"
                />
              )}
              <span className="settings-field__hint">
                الموصى به للعربية: gemma4:e4b (خفيف وسريع)، gemma2:9b (متوازن)، gemma4:26b (للأجهزة القوية)
              </span>
            </div>

            <div className="settings-field">
              <label>تشغيل / إيقاف Ollama</label>
              <div className="settings-row settings-row--split">
                <button
                  className="btn btn-secondary"
                  onClick={startOllama}
                  disabled={!!ollamaAction}
                >
                  <Play size={13} className="icon-success" />
                  {ollamaAction === "starting" ? "جاري التشغيل..." : "تشغيل Ollama"}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={killOllama}
                  disabled={!!ollamaAction}
                >
                  <Power size={13} />
                  {ollamaAction === "killing" ? "جاري الإيقاف..." : "إيقاف Ollama"}
                </button>
              </div>
              <span className="settings-field__hint">
                إيقاف Ollama يحرر الذاكرة (RAM) تماماً. شغّله مجدداً عند الحاجة للمساعد.
              </span>
            </div>
          </section>)}

          {/* ── المظهر ── */}
          <section className="settings-section">
            <div className="settings-section__title">المظهر</div>
            <div className="settings-field">
              <label>وضع العرض</label>
              <div className="theme-options">
                <button className={`theme-option${settings.theme === "dark" ? " active" : ""}`} onClick={() => onUpdate({ theme: "dark" })}>
                  <span className="theme-swatch dark" />
                  <span>ليل</span>
                </button>
                <button className={`theme-option${settings.theme === "light" ? " active" : ""}`} onClick={() => onUpdate({ theme: "light" })}>
                  <span className="theme-swatch light" />
                  <span>نهار</span>
                </button>
                <button className={`theme-option${settings.theme === "sepia" ? " active" : ""}`} onClick={() => onUpdate({ theme: "sepia" })}>
                  <span className="theme-swatch sepia" />
                  <span>ورق</span>
                </button>
              </div>
            </div>
          </section>

          {/* ── الكتابة ── */}
          <section className="settings-section">
            <div className="settings-section__title">الكتابة</div>

            <div className="settings-field">
              <label>هدف الكتابة اليومي (كلمة)</label>
              <input
                type="number"
                className="settings-input settings-input--number"
                value={settings.writingGoal || ""}
                onChange={(e) => onUpdate({ writingGoal: parseInt(e.target.value) || 0 })}
                placeholder="0 = بدون هدف"
                min="0"
                max="50000"
              />
              <span className="settings-field__hint">يظهر شريط التقدم في أسفل الشاشة عند تحديد هدف.</span>
            </div>

            <label className="settings-check">
              <input
                type="checkbox"
                checked={settings.typewriterMode || false}
                onChange={(e) => onUpdate({ typewriterMode: e.target.checked })}
              />
              <span className="settings-check__box" aria-hidden="true" />
              <span className="settings-check__text">
                <span className="settings-check__title">وضع الآلة الكاتبة</span>
                <span className="settings-check__desc">يُثبّت المؤشر في منتصف الشاشة أثناء الكتابة.</span>
              </span>
            </label>
          </section>

          {!isNativeIOS && <>
          {/* ── التدقيق الإملائي ── */}
          <section className="settings-section">
            <div className="settings-section__title">التدقيق الإملائي</div>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={settings.spellcheckEnabled}
                onChange={(e) => onUpdate({ spellcheckEnabled: e.target.checked })}
              />
              <span className="settings-check__box" aria-hidden="true" />
              <span className="settings-check__text">
                <span className="settings-check__title">تفعيل التدقيق الإملائي التلقائي</span>
                <span className="settings-check__desc">يستخدم Ollama لفحص الكلمات العربية. قد يستغرق وقتاً عند الكتابة.</span>
              </span>
            </label>
          </section>
          </>}

          {/* ── عن التطبيق ── */}
          <section className="settings-section">
            <div className="settings-section__title">عن التطبيق</div>
            <ul className="settings-about">
              <li>محلي أولاً — الكتابة والحفظ يعملان بدون إنترنت</li>
              <li>{isNativeIOS ? "الكتب محفوظة على الآيباد أو iCloud عند تفعيله" : "المشاريع محفوظة في مجلد على قرصك الصلب"}</li>
              {!isNativeIOS && <li>يتكامل مع Ollama لتشغيل موديلات ذكاء اصطناعي محلية</li>}
              {isNativeIOS && <li>مساعد كتابة عبر مزود API خارجي، ومفتاحه محفوظ في Keychain</li>}
              <li>إملاء عربي مدمج على macOS وiPad باستخدام خدمة Apple</li>
              <li>محرر نصوص مرئي مع دعم كامل للعربية من اليمين لليسار</li>
            </ul>
          </section>
        </div>

        <div className="modal__footer">
          <button className="btn btn-primary" onClick={onClose}>تم</button>
        </div>
      </div>
    </div>
  );
}
