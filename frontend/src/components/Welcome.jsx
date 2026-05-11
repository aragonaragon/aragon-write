import { useEffect, useState } from "react";
import { Sparkles, Download, Terminal, Check, ArrowLeft } from "lucide-react";

/**
 * One-time welcome / onboarding modal.
 * Triggered when:
 *   - localStorage flag "aragon-write-onboarded" is absent, OR
 *   - Ollama health check fails on first load
 *
 * Dismissed via the "ابدأ" button → sets the flag.
 */
export default function Welcome({ ollamaStatus, apiUrl, onClose }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Decide whether to show
  useEffect(() => {
    const seen = localStorage.getItem("aragon-write-onboarded") === "1";
    if (!seen) {
      setOpen(true);
      return;
    }
    if (ollamaStatus === "error") setOpen(true);
  }, [ollamaStatus]);

  if (!open) return null;

  const dismiss = () => {
    localStorage.setItem("aragon-write-onboarded", "1");
    setOpen(false);
    onClose?.();
  };

  const ollamaOk = ollamaStatus === "online";

  return (
    <div
      className="welcome-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="welcome-modal" role="dialog" aria-modal="true">
        <div className="welcome-header">
          <div className="welcome-mark">أ</div>
          <div>
            <div className="welcome-title">مرحباً بك في أرغون رايت</div>
            <div className="welcome-subtitle">محرر الكتابة العربي — محلي 100%</div>
          </div>
        </div>

        <div className="welcome-body">
          {step === 0 && (
            <>
              <p className="welcome-text">
                جميع كتاباتك تُحفظ على جهازك فقط — بدون سحابة، بدون اشتراك، بدون
                إنترنت. لتفعيل المساعد الذكي تحتاج خطوة واحدة فقط:
              </p>
              <div className="welcome-steps">
                <div className="welcome-step">
                  <div className="welcome-step__num">1</div>
                  <div className="welcome-step__body">
                    <div className="welcome-step__title">
                      <Download size={14} /> ثبّت Ollama
                    </div>
                    <div className="welcome-step__desc">
                      من{" "}
                      <a
                        href="https://ollama.com/download"
                        target="_blank"
                        rel="noreferrer"
                      >
                        ollama.com/download
                      </a>{" "}
                      — مجاني، مفتوح المصدر، ويعمل في الخلفية.
                    </div>
                  </div>
                </div>

                <div className="welcome-step">
                  <div className="welcome-step__num">2</div>
                  <div className="welcome-step__body">
                    <div className="welcome-step__title">
                      <Terminal size={14} /> حمّل موديل عربي
                    </div>
                    <div className="welcome-step__desc">
                      افتح PowerShell ونفّذ:
                      <code className="welcome-code">ollama pull gemma4:e4b</code>
                    </div>
                  </div>
                </div>

                <div className="welcome-step">
                  <div className="welcome-step__num">3</div>
                  <div className="welcome-step__body">
                    <div className="welcome-step__title">
                      <Sparkles size={14} /> ابدأ الكتابة
                    </div>
                    <div className="welcome-step__desc">
                      حدّد أي نص واضغط Ctrl+K — سيظهر مساعد الكتابة بإجراءاته
                      الذكية.
                    </div>
                  </div>
                </div>
              </div>

              <div className="welcome-status">
                <span
                  className={`welcome-dot ${
                    ollamaOk ? "is-on" : ollamaStatus === "checking" ? "is-check" : "is-off"
                  }`}
                />
                {ollamaOk
                  ? "Ollama متصل — كل شيء جاهز"
                  : ollamaStatus === "checking"
                  ? "جارٍ فحص Ollama..."
                  : "Ollama غير متصل — يمكنك البدء بالكتابة بدونه"}
              </div>
            </>
          )}
        </div>

        <div className="welcome-footer">
          <button className="welcome-btn-secondary" onClick={dismiss}>
            تجاوز
          </button>
          <button className="welcome-btn-primary" onClick={dismiss}>
            <ArrowLeft size={14} />
            ابدأ
          </button>
        </div>
      </div>
    </div>
  );
}
