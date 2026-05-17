import { useState, useRef, useEffect } from "react";
import { FileText, ChevronDown, Pencil, Plus, FolderOpen, Check } from "lucide-react";

function formatRelative(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `قبل ${days} يوم`;
  return new Date(iso).toLocaleDateString("ar-SA", { month: "short", day: "numeric" });
}

export default function DocSwitcher({
  documents,
  currentDoc,
  projectMode,
  onOpen,
  onCreate,
  onOpenManager,
  onUpdateTitle,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const commitRename = () => {
    const next = renameValue.trim();
    if (next && next !== currentDoc?.title) {
      onUpdateTitle(next);
    }
    setIsRenaming(false);
  };

  // Close menu on outside click / ESC
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const startRename = () => {
    setRenameValue(currentDoc?.title || "");
    setIsRenaming(true);
    setIsOpen(false);
  };

  const handleRenameKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsRenaming(false);
    }
  };

  // Sort docs: current first, then by updatedAt desc
  const sortedDocs = [...documents].sort((a, b) => {
    if (a.id === currentDoc?.id) return -1;
    if (b.id === currentDoc?.id) return 1;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  const displayedDocs = sortedDocs.slice(0, 6);

  const placeholderLabel = projectMode ? "اسم الفصل" : "اسم المستند";
  const newLabel = projectMode ? "فصل جديد" : "مستند جديد";

  if (isRenaming) {
    return (
      <div className="doc-switcher" ref={wrapRef}>
        <div className="doc-switcher__rename">
          <Pencil size={13} />
          <input
            ref={inputRef}
            className="doc-switcher__rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKey}
            onBlur={commitRename}
            placeholder={placeholderLabel}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="doc-switcher" ref={wrapRef}>
      <button
        className={`doc-switcher__trigger${isOpen ? " is-open" : ""}`}
        onClick={() => setIsOpen((v) => !v)}
        title="تبديل / إعادة تسمية"
      >
        <FileText size={14} />
        <span className="doc-switcher__title">{currentDoc?.title || "..."}</span>
        <ChevronDown size={12} className={`doc-switcher__caret${isOpen ? " is-open" : ""}`} />
      </button>

      {isOpen && (
        <div className="doc-switcher__menu" role="menu">
          <button className="doc-switcher__item" onClick={startRename}>
            <Pencil size={13} />
            <span>إعادة تسمية الحالي</span>
          </button>

          <div className="doc-switcher__divider" />

          {displayedDocs.length === 0 && (
            <div className="doc-switcher__empty">لا توجد {projectMode ? "فصول" : "مستندات"}</div>
          )}

          {displayedDocs.map((doc) => {
            const isCurrent = doc.id === currentDoc?.id;
            return (
              <button
                key={doc.id}
                className={`doc-switcher__item doc-switcher__doc${isCurrent ? " is-current" : ""}`}
                onClick={() => {
                  if (!isCurrent) onOpen(doc.id);
                  setIsOpen(false);
                }}
              >
                {isCurrent ? (
                  <Check size={13} />
                ) : (
                  <span className="doc-switcher__bullet" />
                )}
                <span className="doc-switcher__doc-title">
                  {doc.title || "بدون عنوان"}
                </span>
                <span className="doc-switcher__doc-date">
                  {formatRelative(doc.updatedAt)}
                </span>
              </button>
            );
          })}

          <div className="doc-switcher__divider" />

          <button
            className="doc-switcher__item"
            onClick={() => {
              onCreate();
              setIsOpen(false);
            }}
          >
            <Plus size={13} />
            <span>{newLabel}</span>
          </button>

          <button
            className="doc-switcher__item"
            onClick={() => {
              onOpenManager();
              setIsOpen(false);
            }}
          >
            <FolderOpen size={13} />
            <span>عرض الكل ({documents.length})</span>
          </button>
        </div>
      )}
    </div>
  );
}
