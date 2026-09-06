import { FileText, AlertCircle, Target, Play, Power, Cloud, Check, LoaderCircle } from "lucide-react";
import { getProviderStatusLabel, isExternal } from "../lib/provider";
import { isNativeIOS } from "../lib/native";

export default function StatusBar({ stats, issueCount, ollamaStatus, model, docCount, sessionWords, writingGoal, onStartOllama, onKillOllama, ollamaAction, settings, saveStatus = "saved", storageStatus }) {
  const goalPct = writingGoal > 0 ? Math.min(100, (stats.words / writingGoal) * 100) : 0;
  const goalReached = writingGoal > 0 && stats.words >= writingGoal;
  const external = isExternal(settings);
  const statusLabel = getProviderStatusLabel(settings, ollamaStatus);

  return (
    <footer className="statusbar">
      {writingGoal > 0 && (
        <div
          className={`statusbar__goal-bar${goalReached ? " reached" : ""}`}
          style={{ width: `${goalPct}%` }}
        />
      )}

      <div className="statusbar__item">
        <FileText size={12} />
        <span>{stats.words} كلمة</span>
      </div>

      <div className="statusbar__item">
        <span>{stats.chars} حرف</span>
      </div>

      {sessionWords > 0 && (
        <div className="statusbar__item" style={{ color: "var(--primary)" }}>
          <span>+{sessionWords} هذه الجلسة</span>
        </div>
      )}

      {writingGoal > 0 && (
        <div className="statusbar__item" style={{ color: goalReached ? "#34a853" : "var(--text-muted)" }}>
          <Target size={12} />
          <span>
            {goalReached ? "✓ " : ""}{stats.words} / {writingGoal}
          </span>
        </div>
      )}

      {issueCount > 0 && (
        <div className="statusbar__item" style={{ color: "#ea4335" }}>
          <AlertCircle size={12} />
          <span>{issueCount} خطأ إملائي</span>
        </div>
      )}

      <div className="statusbar__spacer" />

      <div className="statusbar__item" style={{ gap: 6 }}>
        {(external || isNativeIOS) && <Cloud size={11} style={{ color: "var(--text-muted)" }} />}
        <div className={`statusbar__dot${isNativeIOS ? storageStatus?.iCloud ? " online" : "" : ollamaStatus === "online" ? " online" : ollamaStatus === "error" ? " error" : ""}`} />
        <span>{isNativeIOS ? storageStatus?.iCloud ? "متزامن مع iCloud" : "محفوظ على الآيباد" : statusLabel}</span>
        {/* Start/kill Ollama controls only make sense in local mode */}
        {!isNativeIOS && !external && ollamaStatus !== "online" && (
          <button
            className="btn-icon"
            onClick={onStartOllama}
            disabled={ollamaAction === "starting"}
            title="تشغيل Ollama"
            style={{ width: 20, height: 20, color: "#34a853" }}
          >
            <Play size={11} />
          </button>
        )}
        {!isNativeIOS && !external && ollamaStatus === "online" && (
          <button
            className="btn-icon"
            onClick={onKillOllama}
            disabled={ollamaAction === "killing"}
            title="إيقاف Ollama"
            style={{ width: 20, height: 20, color: "#ea4335" }}
          >
            <Power size={11} />
          </button>
        )}
      </div>

      <div className="statusbar__item statusbar__item--secondary" title={model}>
        <span>{docCount} مستند</span>
      </div>

      <div className={`statusbar__item save-state save-state--${saveStatus}`} aria-live="polite">
        {saveStatus === "saving" && <LoaderCircle size={11} className="save-state__spinner" />}
        {saveStatus === "saved" && <Check size={11} />}
        <span>{saveStatus === "dirty" ? "تغييرات غير محفوظة" : saveStatus === "saving" ? "جارٍ الحفظ" : saveStatus === "error" ? "تعذّر الحفظ" : "تم الحفظ"}</span>
      </div>
    </footer>
  );
}
