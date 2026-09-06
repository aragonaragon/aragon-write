import { useEffect, useState } from "react";
import { Sparkles, Download, Terminal, Check, ArrowLeft } from "lucide-react";
import { isNativeIOS } from "../lib/native";

/**
 * One-time welcome / onboarding modal.
 * Triggered when:
 *   - localStorage flag "aragon-write-onboarded" is absent, OR
 *   - Ollama health check fails on first load
 *
 * Dismissed via the "ابدأ" button → sets the flag.
 */
export default function Welcome({ ollamaStatus, apiUrl, onClose, settings }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Decide whether to show.
  // Skip the "install Ollama" prompt if the user has chosen the external API
  // path — they don't need Ollama at all in that case.
  const usingExternalApi =
    settings?.provider === "openai_compat" && !!settings?.apiBaseUrl;

  useEffect(() => {
    const seen = localStorage.getItem("aragon-write-onboarded") === "1";
    if (!seen) {
      setOpen(true);
      return;
    }
    if (!isNativeIOS && ollamaStatus === "error" && !usingExternalApi) setOpen(true);
  }, [ollamaStatus, usingExternalApi]);

  if (!open) return null;

  const dismiss = () => {
    localStorage.setItem("aragon-write-onboarded", "1");
    setOpen(false);
    onClose?.();
  };

  const ollamaOk = ollamaStatus === "online";
  const isApple = window.electronAPI?.platform === "darwin" || /Mac|iPhone|iPad/.test(navigator.platform);

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
            <div className="welcome-subtitle">محرر الكتابة العربي — محلي أولاً</div>
          </div>
        </div>

        <div className="welcome-body">
          {step === 0 && (
            <>
              <p className="welcome-text">
                {isNativeIOS
                  ? "تُحفظ كتاباتك فوراً على الآيباد وتقدر تكتب بدون إنترنت. مساعد الكتابة اختياري ويعمل عبر مفتاح API خارجي تحفظه من الإعدادات."
                  : "تُحفظ كتاباتك على جهازك أولاً وتقدر تكتب بدون إنترنت. المساعد الذكي اختياري ويمكن تشغيله محلياً على الماك."}
              </p>
              {!isNativeIOS && (
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
                      افتح {isApple ? "Terminal" : "PowerShell"} ونفّذ:
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
                      حدّد أي نص واضغط {isApple ? "⌘K" : "Ctrl+K"} — سيظهر مساعد الكتابة بإجراءاته
                      الذكية.
                    </div>
                  </div>
                </div>
              </div>
              )}

              <div className="welcome-status">
                <span
                  className={`welcome-dot ${
                    isNativeIOS ? "is-on" : ollamaOk ? "is-on" : ollamaStatus === "checking" ? "is-check" : "is-off"
                  }`}
                />
                {isNativeIOS
                  ? "الآيباد جاهز للكتابة والإملاء العربي ومساعد API"
                  : ollamaOk
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
