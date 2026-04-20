import { FileText, Cpu, AlertCircle } from "lucide-react";

export default function StatusBar({ stats, issueCount, ollamaStatus, model, docCount }) {
  return (
    <footer className="statusbar">
      <div className="statusbar__item">
        <FileText size={12} />
        <span>{stats.words} كلمة</span>
      </div>

      <div className="statusbar__item">
        <span>{stats.chars} حرف</span>
      </div>

      {issueCount > 0 && (
        <div className="statusbar__item" style={{ color: "#ea4335" }}>
          <AlertCircle size={12} />
          <span>{issueCount} خطأ إملائي</span>
        </div>
      )}

      <div className="statusbar__spacer" />

      <div className="statusbar__item">
        <div className={`statusbar__dot${ollamaStatus === "online" ? " online" : ollamaStatus === "error" ? " error" : ""}`} />
        <span>
          {ollamaStatus === "online" ? "Ollama متصل" :
           ollamaStatus === "error" ? "Ollama غير متاح" :
           "جاري الفحص..."}
        </span>
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
