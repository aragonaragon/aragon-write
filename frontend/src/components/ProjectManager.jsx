import { useState } from "react";
import { X, BookPlus, Trash2, BookOpen, FolderOpen } from "lucide-react";

const GRADIENTS = [
  "linear-gradient(135deg,#667eea,#764ba2)",
  "linear-gradient(135deg,#f093fb,#f5576c)",
  "linear-gradient(135deg,#4facfe,#00f2fe)",
  "linear-gradient(135deg,#43e97b,#38f9d7)",
  "linear-gradient(135deg,#fa709a,#fee140)",
  "linear-gradient(135deg,#a18cd1,#fbc2eb)",
  "linear-gradient(135deg,#fccb90,#d57eeb)",
  "linear-gradient(135deg,#84fab0,#8fd3f4)",
];

function pickGradient(id) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

export default function ProjectManager({ projects, currentProjectId, onOpen, onCreate, onDelete, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    onCreate(newTitle.trim());
    setNewTitle("");
    setCreatingNew(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--library">
        <div className="modal__header">
          <h2 className="modal__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BookOpen size={20} />
            مكتبتي
          </h2>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal__body">
          {creatingNew ? (
            <div className="project-new-form">
              <input
                className="settings-input"
                placeholder="اسم الرواية أو المشروع..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") { setCreatingNew(false); setNewTitle(""); }
                }}
                autoFocus
                style={{ direction: "rtl", textAlign: "right", fontSize: 16, marginBottom: 12 }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-secondary" onClick={() => { setCreatingNew(false); setNewTitle(""); }}>
                  إلغاء
                </button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={!newTitle.trim()}>
                  <BookPlus size={15} />
                  إنشاء
                </button>
              </div>
            </div>
          ) : (
            <div className="project-grid">
              {/* New project card */}
              <button className="project-new-card" onClick={() => setCreatingNew(true)}>
                <BookPlus size={32} />
                <span>رواية جديدة</span>
              </button>

              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`project-card${project.id === currentProjectId ? " active" : ""}`}
                  onClick={() => onOpen(project.id)}
                >
                  <div
                    className="project-card__cover"
                    style={{ background: project.gradient || pickGradient(project.id) }}
                  >
                    <span className="project-card__letter">
                      {project.title?.charAt(0) || "؟"}
                    </span>
                  </div>
                  <div className="project-card__info">
                    <div className="project-card__title">{project.title || "بدون عنوان"}</div>
                    <div className="project-card__meta">
                      {project.docCount ?? 0} فصل · {formatDate(project.updatedAt)}
                    </div>
                  </div>

                  <button
                    className="project-card__delete"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(project.id); }}
                    title="حذف المشروع"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              {projects.length === 0 && !creatingNew && (
                <div style={{
                  gridColumn: "1 / -1",
                  padding: "32px 16px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  lineHeight: 2,
                  fontSize: 14,
                }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
                  <div>ليس لديك أي رواية حتى الآن.</div>
                  <div>اضغط «رواية جديدة» لإنشاء أول مشروع.</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            <FolderOpen size={12} style={{ display: "inline", marginLeft: 4 }} />
            المستندات محفوظة في مجلد الروايات على جهازك
          </span>
          <button className="btn btn-secondary" onClick={onClose}>إغلاق</button>
        </div>
      </div>

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="modal-overlay" style={{ zIndex: 400 }}
          onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal modal--sm">
            <div className="modal__header">
              <h2 className="modal__title">حذف المشروع</h2>
            </div>
            <div className="modal__body">
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.9 }}>
                سيُحذف المشروع وجميع فصوله من القرص الصلب نهائياً.<br />
                لا يمكن التراجع عن هذا الإجراء.
              </p>
            </div>
            <div className="modal__footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>إلغاء</button>
              <button className="btn btn-danger" onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }}>
                <Trash2 size={14} /> حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
