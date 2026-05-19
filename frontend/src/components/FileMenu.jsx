import { useState, useRef, useEffect } from "react";
import { ChevronDown, FileDown, FileUp, Package, FileText, FileCode2, FileType2, FileBadge2 } from "lucide-react";

/**
 * "ملف" dropdown menu in the topbar. Pure UI — the parent passes onAction
 * handlers and we just trigger them. Action IDs:
 *   - save-as-md / save-as-txt / save-as-html / save-as-pdf / save-as-docx
 *   - import        (opens file picker via parent)
 *   - export-project (exports the current project as JSON backup)
 *
 * The parent decides which actions are valid (e.g. disable save-as when no
 * editor / no doc).
 */
export default function FileMenu({ onAction, hasDoc, hasProject, showDocx }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fire = (action) => {
    setOpen(false);
    onAction?.(action);
  };

  return (
    <div className="file-menu" ref={wrapRef}>
      <button
        className={`file-menu__trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="ملف"
      >
        ملف
        <ChevronDown size={12} className={`file-menu__caret${open ? " is-open" : ""}`} />
      </button>

      {open && (
        <div className="file-menu__panel" role="menu">
          <div className="file-menu__group-label">حفظ باسم</div>
          {showDocx && (
            <button className="file-menu__item" onClick={() => fire("save-as-docx")} disabled={!hasDoc}>
              <FileBadge2 size={14} />
              <span>Word (.docx)</span>
              <span className="file-menu__hint">للناشرين</span>
            </button>
          )}
          <button className="file-menu__item" onClick={() => fire("save-as-pdf")} disabled={!hasDoc}>
            <FileType2 size={14} />
            <span>PDF (.pdf)</span>
            <span className="file-menu__hint">للقراءة</span>
          </button>
          <button className="file-menu__item" onClick={() => fire("save-as-md")} disabled={!hasDoc}>
            <FileCode2 size={14} />
            <span>Markdown (.md)</span>
          </button>
          <button className="file-menu__item" onClick={() => fire("save-as-html")} disabled={!hasDoc}>
            <FileCode2 size={14} />
            <span>HTML (.html)</span>
          </button>
          <button className="file-menu__item" onClick={() => fire("save-as-txt")} disabled={!hasDoc}>
            <FileText size={14} />
            <span>نص (.txt)</span>
          </button>

          <div className="file-menu__divider" />

          <button className="file-menu__item" onClick={() => fire("import")}>
            <FileUp size={14} />
            <span>استيراد ملف...</span>
            <span className="file-menu__hint">Word / MD / TXT / HTML / PDF / Backup</span>
          </button>

          <div className="file-menu__divider" />

          <div className="file-menu__group-label">نسخ احتياطي</div>
          <button className="file-menu__item" onClick={() => fire("export-project")} disabled={!hasProject}>
            <Package size={14} />
            <span>تصدير المشروع كاملاً (JSON)</span>
            <span className="file-menu__hint">للنقل بين الأجهزة</span>
          </button>
        </div>
      )}
    </div>
  );
}
