import { useEffect } from "react";
import { X, AlertCircle, CheckCircle, Info } from "lucide-react";

export default function Toast({ toasts, onDismiss }) {
  return (
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration || 4000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const icon =
    toast.type === "error" ? <AlertCircle size={16} /> :
    toast.type === "success" ? <CheckCircle size={16} /> :
    <Info size={16} />;

  return (
    <div className={`toast toast--${toast.type || "info"}`}>
      <span className="toast__icon">{icon}</span>
      <span className="toast__message">{toast.message}</span>
      <button className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="إغلاق">
        <X size={14} />
      </button>
    </div>
  );
}
