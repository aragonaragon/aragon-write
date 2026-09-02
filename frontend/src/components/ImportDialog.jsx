import { useState, useEffect } from "react";
import { X, FileText, BookPlus, ArrowDown } from "lucide-react";

/**
 * Asks the user where the just-imported content should land:
 *   - new chapter in the current project (default)
 *   - brand new project
 *   - append to the currently open chapter
 *
 * The parent component is responsible for the actual import (it already has
 * the parsed HTML); ImportDialog is purely UI + the chosen action.
 *
 * Props:
 *   sourceName     - filename shown in the header ("chapter1.docx")
 *   wordCount      - approximate word count (number)
 *   projectMode    - whether a project is currently open
 *   currentDocTitle- title of the currently open doc (for "append to..." label)
 *   onConfirm      - ({target, title}) => void; target = "new-doc"|"new-project"|"append"
 *   onCancel       - () => void
 *   warning        - optional Arabic warning string (used for .pdf)
 */
export default function ImportDialog({
  sourceName,
  wordCount,
  projectMode,
  currentDocTitle,
  onConfirm,
  onCancel,
  warning,
}) {
  const fallbackTitle = (sourceName || "مستند مستورد")
    .replace(/\.(md|txt|html|htm|docx|pdf|json)$/i, "");
  const [target, setTarget] = useState(projectMode ? "new-doc" : "new-project");
  const [title, setTitle] = useState(fallbackTitle);

  // When the user switches to "append", the title is unused — clear it for
  // clarity, then restore it if they switch back.
  useEffect(() => {
    if (target === "append" && !title) setTitle(fallbackTitle);
  }, [target]); // eslint-disable-line

  const submit = () => {
    onConfirm({ target, title: title.trim() || fallbackTitle });
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal--sm" role="dialog" aria-modal="true" aria-label="استيراد ملف">
        <div className="modal__header">
          <h2 className="modal__title">استيراد ملف</h2>
          <button className="btn-icon" onClick={onCancel} title="إلغاء" aria-label="إغلاق نافذة الاستيراد"><X size={18} /></button>
        </div>

        <div className="modal__body">
          <div className="import-source">
            <FileText size={18} style={{ flexShrink: 0, color: "var(--primary)" }} />
            <div style={{ minWidth: 0 }}>
              <div className="import-source__name">{sourceName}</div>
              <div className="import-source__meta">
                {wordCount > 0 ? `${wordCount.toLocaleString("ar-EG")} كلمة` : ""}
              </div>
            </div>
          </div>

          {warning && (
            <div className="import-warning">⚠ {warning}</div>
          )}

          <div className="settings-section__title" style={{ marginTop: 16 }}>وين تبي تضع المحتوى؟</div>

          <label className={`import-option${target === "new-doc" ? " active" : ""} ${!projectMode ? "disabled" : ""}`}>
            <input
              type="radio"
              name="import-target"
              value="new-doc"
              checked={target === "new-doc"}
              onChange={() => setTarget("new-doc")}
              disabled={!projectMode}
            />
            <div className="import-option__icon"><FileText size={14} /></div>
            <div>
              <div className="import-option__title">فصل جديد في المشروع الحالي</div>
              <div className="import-option__desc">
                {projectMode ? "يضيف فصل بمحتوى الملف للمشروع المفتوح" : "يحتاج فتح مشروع أولاً"}
              </div>
            </div>
          </label>

          <label className={`import-option${target === "new-project" ? " active" : ""}`}>
            <input
              type="radio"
              name="import-target"
              value="new-project"
              checked={target === "new-project"}
              onChange={() => setTarget("new-project")}
            />
            <div className="import-option__icon"><BookPlus size={14} /></div>
            <div>
              <div className="import-option__title">مشروع جديد بالكامل</div>
              <div className="import-option__desc">
                ينشئ مشروع جديد فيه فصل واحد بمحتوى الملف
              </div>
            </div>
          </label>

          <label className={`import-option${target === "append" ? " active" : ""} ${!currentDocTitle ? "disabled" : ""}`}>
            <input
              type="radio"
              name="import-target"
              value="append"
              checked={target === "append"}
              onChange={() => setTarget("append")}
              disabled={!currentDocTitle}
            />
            <div className="import-option__icon"><ArrowDown size={14} /></div>
            <div>
              <div className="import-option__title">إلحاق بنهاية الفصل الحالي</div>
              <div className="import-option__desc">
                {currentDocTitle ? `يضيف للمحتوى في «${currentDocTitle}»` : "يحتاج فتح فصل أولاً"}
              </div>
            </div>
          </label>

          {target !== "append" && (
            <div className="settings-field" style={{ marginTop: 12 }}>
              <label>الاسم</label>
              <input
                className="settings-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={fallbackTitle}
                style={{ direction: "rtl", textAlign: "right" }}
              />
              <span className="settings-field__hint">
                {target === "new-project" ? "اسم المشروع الجديد" : "اسم الفصل الجديد"}
              </span>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn-secondary" onClick={onCancel}>إلغاء</button>
          <button className="btn btn-primary" onClick={submit}>استيراد</button>
        </div>
      </div>
    </div>
  );
}
