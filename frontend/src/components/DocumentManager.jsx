import { useState } from "react";
import { X, FilePlus, Trash2, BookOpen, LogOut, FileText } from "lucide-react";

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ar-SA", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DocumentManager({
  documents, currentDocId, onOpen, onCreate, onDelete, onClose, editor,
  projectMode, projectTitle, onExitProject,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);

  const exportTxt = (doc) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = doc.content || "";
    downloadFile(tmp.textContent || "", `${doc.title}.txt`, "text/plain;charset=utf-8");
  };

  const exportHtml = (doc) => {
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>${doc.title}</title>
<style>body{font-family:'Amiri',serif;max-width:800px;margin:40px auto;padding:20px;direction:rtl;text-align:right;font-size:18px;line-height:2}</style>
</head><body><h1>${doc.title}</h1>${doc.content || ""}</body></html>`;
    downloadFile(html, `${doc.title}.html`, "text/html;charset=utf-8");
  };

  const exportMd = (doc) => {
    // Simple HTML to Markdown conversion
    const tmp = document.createElement("div");
    tmp.innerHTML = doc.content || "";
    let md = `# ${doc.title}\n\n`;

    tmp.querySelectorAll("h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent.trim();
      if (!text) return;
      if (tag === "h1") md += `# ${text}\n\n`;
      else if (tag === "h2") md += `## ${text}\n\n`;
      else if (tag === "h3") md += `### ${text}\n\n`;
      else if (tag === "h4") md += `#### ${text}\n\n`;
      else if (tag === "h5") md += `##### ${text}\n\n`;
      else if (tag === "h6") md += `###### ${text}\n\n`;
      else if (tag === "p") md += `${text}\n\n`;
      else if (tag === "blockquote") md += `> ${text}\n\n`;
      else if (tag === "li") md += `- ${text}\n`;
    });

    downloadFile(md, `${doc.title}.md`, "text/markdown;charset=utf-8");
  };

  const unitLabel = projectMode ? "فصل" : "مستند";

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--library" role="dialog" aria-modal="true" aria-label={projectMode ? "فصول المشروع" : "المستندات"}>
        <div className="modal__header">
          <h2 className="modal__title">
            {projectMode && <BookOpen size={18} />}
            {projectMode ? (projectTitle || "المشروع") : "المستندات"}
          </h2>
          <div className="modal__header-actions">
            {projectMode && onExitProject && (
              <button
                className="btn btn-secondary btn--compact"
                onClick={() => { onExitProject(); onClose(); }}
                title="الخروج من المشروع"
              >
                <LogOut size={13} />
                خروج
              </button>
            )}
            <button className="btn-icon" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
          </div>
        </div>

        <div className="modal__body">
          <div className="doc-grid">
            <button className="doc-new-card" onClick={onCreate}>
              <FilePlus size={26} />
              <span>{projectMode ? "فصل جديد" : "مستند جديد"}</span>
            </button>

            {documents.map((doc, index) => (
              <div
                key={doc.id}
                className={`doc-card${doc.id === currentDocId ? " active" : ""}`}
                onClick={() => onOpen(doc.id)}
              >
                <div className="doc-card__head">
                  <span className="doc-card__index">{index + 1}</span>
                  <span className="doc-card__icon"><FileText size={14} /></span>
                </div>
                <div className="doc-card__title">{doc.title || "بدون عنوان"}</div>
                <div className="doc-card__meta">{formatDate(doc.updatedAt)}</div>

                <div className="doc-card__exports" onClick={(e) => e.stopPropagation()}>
                  <button className="doc-card__export" onClick={() => exportTxt(doc)} title="تصدير TXT">TXT</button>
                  <button className="doc-card__export" onClick={() => exportHtml(doc)} title="تصدير HTML">HTML</button>
                  <button className="doc-card__export" onClick={() => exportMd(doc)} title="تصدير Markdown">MD</button>
                </div>

                <button
                  className="doc-card__delete"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc.id); }}
                  title="حذف"
                  aria-label={`حذف ${doc.title || "بدون عنوان"}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="modal__footer">
          <span className="modal__footer-note">
            {documents.length} {unitLabel} · {projectMode ? "محفوظ على القرص" : "حفظ تلقائي"}
          </span>
          <button className="btn btn-secondary" onClick={onClose}>إغلاق</button>
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay modal-overlay--top" onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal modal--sm" role="alertdialog" aria-modal="true" aria-label="تأكيد حذف المستند">
            <div className="modal__header">
              <h2 className="modal__title">تأكيد الحذف</h2>
            </div>
            <div className="modal__body">
              <p className="modal__text">
                هل أنت متأكد من حذف هذا {unitLabel}؟ لا يمكن التراجع عن هذا الإجراء.
              </p>
            </div>
            <div className="modal__footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>إلغاء</button>
              <button
                className="btn btn-danger"
                onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }}
              >
                <Trash2 size={14} />
                حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
