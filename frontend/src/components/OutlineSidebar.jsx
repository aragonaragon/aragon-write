import { useEffect, useState } from "react";
import { PanelRightClose } from "lucide-react";

function extractHeadings(editor) {
  if (!editor) return [];
  const headings = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        id: pos,
        level: node.attrs.level,
        text: node.textContent,
        pos,
      });
    }
  });
  return headings;
}

export default function OutlineSidebar({ editor, isOpen, onToggle }) {
  const [headings, setHeadings] = useState([]);

  useEffect(() => {
    if (!editor) return;
    const update = () => setHeadings(extractHeadings(editor));
    update();
    editor.on("update", update);
    return () => editor.off("update", update);
  }, [editor]);

  const scrollToHeading = (pos) => {
    if (!editor) return;
    editor.commands.focus();
    editor.commands.setTextSelection(pos);
    // Scroll the editor stage to the heading
    const domNode = editor.view.domAtPos(pos)?.node;
    if (domNode instanceof Element) {
      domNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <aside className={`outline-sidebar${isOpen ? "" : " collapsed"}`}>
      <div className="outline-header">
        <span>جدول المحتويات</span>
        <button className="btn-icon outline-header__btn" onClick={onToggle} title="إخفاء جدول المحتويات" aria-label="إخفاء جدول المحتويات">
          <PanelRightClose size={15} />
        </button>
      </div>

      {headings.length === 0 ? (
        <div className="outline-empty">
          أضف عناوين (H1–H6) لتظهر هنا تلقائياً
        </div>
      ) : (
        <ul className="outline-list">
          {headings.map((h) => (
            <li key={h.id}>
              <button
                className="outline-item"
                data-level={h.level}
                onClick={() => scrollToHeading(h.pos)}
                title={h.text}
              >
                {h.text || "(بدون نص)"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
