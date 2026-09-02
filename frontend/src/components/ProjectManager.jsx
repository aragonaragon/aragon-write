import { useState } from "react";
import { X, BookPlus, Trash2, BookOpen, FolderOpen } from "lucide-react";

const COVER_TONES = [
  "#203142",
  "#5e4b43",
  "#36574f",
  "#6a5331",
  "#4d5367",
  "#70464c",
  "#40556b",
  "#59603f",
];

function pickCoverTone(id) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return COVER_TONES[Math.abs(hash) % COVER_TONES.length];
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

  const cancelCreate = () => {
    setCreatingNew(false);
    setNewTitle("");
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--library" role="dialog" aria-modal="true" aria-label="مكتبتي">
        <div className="modal__header">
          <h2 className="modal__title">
            <BookOpen size={20} />
            مكتبتي
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="إغلاق المكتبة"><X size={18} /></button>
        </div>

        <div className="modal__body">
          {creatingNew ? (
            <div className="project-new-form">
              <input
                className="settings-input settings-input--lg"
                placeholder="اسم المشروع..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") cancelCreate();
                }}
                autoFocus
              />
              <div className="project-new-form__actions">
                <button className="btn btn-secondary" onClick={cancelCreate}>إلغاء</button>
                <button className="btn btn-primary" onClick={handleCreate} disabled={!newTitle.trim()}>
                  <BookPlus size={15} />
                  إنشاء
                </button>
              </div>
            </div>
          ) : (
            <div className="project-grid">
              <button className="project-new-card" onClick={() => setCreatingNew(true)}>
                <BookPlus size={28} />
                <span>مشروع جديد</span>
              </button>

              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`project-card${project.id === currentProjectId ? " active" : ""}`}
                  onClick={() => onOpen(project.id)}
                >
                  <div
                    className="project-card__cover"
                    style={{ "--cover-tone": pickCoverTone(project.id) }}
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
                    aria-label={`حذف مشروع ${project.title || "بدون عنوان"}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              {projects.length === 0 && (
                <div className="project-empty">
                  <div className="project-empty__icon"><BookOpen size={24} /></div>
                  <div>ما عندك أي مشروع حتى الآن.</div>
                  <div>اضغط «مشروع جديد» لإنشاء أول مشروع.</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <span className="modal__footer-note">
            <FolderOpen size={12} />
            المستندات محفوظة في مجلد المشاريع على جهازك
          </span>
          <button className="btn btn-secondary" onClick={onClose}>إغلاق</button>
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay modal-overlay--top"
          onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal modal--sm" role="alertdialog" aria-modal="true" aria-label="تأكيد حذف المشروع">
            <div className="modal__header">
              <h2 className="modal__title">حذف المشروع</h2>
            </div>
            <div className="modal__body">
              <p className="modal__text">
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
