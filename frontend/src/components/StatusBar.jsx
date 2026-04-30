import { FileText, Cpu, AlertCircle, Target, Play, Power } from "lucide-react";

export default function StatusBar({ stats, issueCount, ollamaStatus, model, docCount, sessionWords, writingGoal, onStartOllama, onKillOllama, ollamaAction }) {
  const goalPct = writingGoal > 0 ? Math.min(100, (stats.words / writingGoal) * 100) : 0;
  const goalReached = writingGoal > 0 && stats.words >= writingGoal;

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
        <div className={`statusbar__dot${ollamaStatus === "online" ? " online" : ollamaStatus === "error" ? " error" : ""}`} />
        <span>
          {ollamaStatus === "online" ? "Ollama متصل" :
           ollamaStatus === "error" ? "Ollama متوقف" :
           "جاري الفحص..."}
        </span>
        {ollamaStatus !== "online" && (
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
        {ollamaStatus === "online" && (
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

      <div className="statusbar__item">
        <Cpu size={12} />
        <span>{model}</span>
      </div>

      <div className="statusbar__item">
        <span>{docCount} مستند</span>
      </div>

      <div className="statusbar__item" style={{ color: "var(--text-muted)", fontSize: 11 }}>
        حفظ تلقائي
      </div>
    </footer>
  );
}
