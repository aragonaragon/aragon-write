import { useEffect, useState } from "react";
import { X, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";

export default function Settings({ settings, onUpdate, onClose, apiUrl }) {
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(null);
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl);
  const [testStatus, setTestStatus] = useState(null);

  const fetchModels = async (url = ollamaUrl) => {
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

  useEffect(() => {
    fetchModels();
  }, []); // eslint-disable-line

  const saveOllamaUrl = () => {
    onUpdate({ ollamaUrl });
    fetchModels(ollamaUrl);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <h2 className="modal__title">الإعدادات</h2>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal__body">
          {/* Ollama Settings */}
          <div className="settings-section">
            <div className="settings-section__title">إعدادات Ollama (الذكاء الاصطناعي)</div>

            <div className="settings-field">
              <label>عنوان Ollama URL</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="settings-input"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
                <button className="btn btn-secondary" onClick={saveOllamaUrl} style={{ flexShrink: 0 }}>
                  حفظ
                </button>
              </div>
              <span className="settings-field__hint">
                العنوان الافتراضي: http://localhost:11434
              </span>
            </div>

            <div className="settings-field">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label>الموديل النشط</label>
                <button
                  className="btn-icon"
                  onClick={() => fetchModels()}
                  title="تحديث قائمة الموديلات"
                  disabled={loadingModels}
                >
                  <RefreshCw size={14} style={{ animation: loadingModels ? "spin 1s linear infinite" : "none" }} />
                </button>
              </div>

              {testStatus === "success" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#34a853", fontSize: 13, marginBottom: 8 }}>
                  <CheckCircle size={14} />
                  Ollama يعمل — {models.length} موديل متاح
                </div>
              )}
              {testStatus === "error" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#ea4335", fontSize: 13, marginBottom: 8 }}>
                  <AlertCircle size={14} />
                  {modelError}
                </div>
              )}

              {models.length > 0 ? (
                <select
                  className="settings-select"
                  value={settings.model}
                  onChange={(e) => onUpdate({ model: e.target.value })}
                >
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="settings-input"
                  value={settings.model}
                  onChange={(e) => onUpdate({ model: e.target.value })}
                  placeholder="مثال: qwen2.5:7b أو llama3.1:8b"
                />
              )}
              <span className="settings-field__hint">
                الموديلات الموصى بها للعربية: qwen2.5:7b، Llama 3.1، Gemma2
              </span>
            </div>
          </div>

          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section__title">المظهر</div>

            <div className="settings-field">
              <label>وضع العرض</label>
              <div className="theme-options">
                <button
                  className={`theme-option${settings.theme === "light" ? " active" : ""}`}
                  onClick={() => onUpdate({ theme: "light" })}
                >
                  <div className="theme-swatch light" />
                  فاتح
                </button>
                <button
                  className={`theme-option${settings.theme === "dark" ? " active" : ""}`}
                  onClick={() => onUpdate({ theme: "dark" })}
                >
                  <div className="theme-swatch dark" />
                  داكن
                </button>
                <button
                  className={`theme-option${settings.theme === "sepia" ? " active" : ""}`}
                  onClick={() => onUpdate({ theme: "sepia" })}
                >
                  <div className="theme-swatch sepia" />
                  عاجي
                </button>
              </div>
            </div>
          </div>

          {/* Writing */}
          <div className="settings-section">
            <div className="settings-section__title">الكتابة</div>

            <div className="settings-field">
              <label>هدف الكتابة اليومي (كلمة)</label>
              <input
                type="number"
                className="settings-input"
                value={settings.writingGoal || ""}
                onChange={(e) => onUpdate({ writingGoal: parseInt(e.target.value) || 0 })}
                placeholder="0 = بدون هدف"
                min="0"
                max="50000"
                style={{ textAlign: "right", direction: "rtl" }}
              />
              <span className="settings-field__hint">
                يظهر شريط التقدم في أسفل الشاشة عند تحديد هدف.
              </span>
            </div>

            <div className="settings-field">
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.typewriterMode || false}
                  onChange={(e) => onUpdate({ typewriterMode: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                وضع الآلة الكاتبة
              </label>
              <span className="settings-field__hint">
                يُثبّت المؤشر في منتصف الشاشة أثناء الكتابة — أريح للجلسات الطويلة.
              </span>
            </div>
          </div>

          {/* Spellcheck */}
          <div className="settings-section">
            <div className="settings-section__title">التدقيق الإملائي</div>
            <div className="settings-field">
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={settings.spellcheckEnabled}
                  onChange={(e) => onUpdate({ spellcheckEnabled: e.target.checked })}
                  style={{ width: 16, height: 16 }}
                />
                تفعيل التدقيق الإملائي التلقائي
              </label>
              <span className="settings-field__hint">
                يستخدم Ollama لفحص الكلمات العربية. قد يستغرق وقتاً عند الكتابة.
              </span>
            </div>
          </div>

          {/* About */}
          <div className="settings-section">
            <div className="settings-section__title">عن التطبيق</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 2 }}>
              <div>🔒 محلي 100% — بدون إنترنت، بدون سحابة، بدون تسجيل</div>
              <div>💾 الملفات محفوظة في متصفحك (localStorage)</div>
              <div>🤖 يتكامل مع Ollama لتشغيل موديلات AI محلية</div>
              <div>📝 محرر نصوص WYSIWYG مع دعم كامل للعربية RTL</div>
            </div>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn-primary" onClick={onClose}>تم</button>
        </div>
      </div>
    </div>
  );
}
