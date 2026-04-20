import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Minus,
  Undo2, Redo2, Link, Highlighter, RemoveFormatting,
} from "lucide-react";

const FONTS = [
  { value: "Amiri, serif", label: "أميري" },
  { value: "Cairo, sans-serif", label: "القاهرة" },
  { value: "Traditional Arabic, serif", label: "عربي تقليدي" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Times New Roman, serif", label: "Times New Roman" },
];

const SIZES = ["10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "64", "96"];

const HEADINGS = [
  { label: "نص عادي", level: 0 },
  { label: "عنوان 1", level: 1 },
  { label: "عنوان 2", level: 2 },
  { label: "عنوان 3", level: 3 },
  { label: "عنوان 4", level: 4 },
  { label: "عنوان 5", level: 5 },
  { label: "عنوان 6", level: 6 },
];

function TBtn({ title, isActive, onClick, disabled, children }) {
  return (
    <button
      className={`toolbar-btn${isActive ? " is-active" : ""}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
      type="button"
      tabIndex={-1}
    >
      {children}
    </button>
  );
}

export default function Toolbar({ editor }) {
  if (!editor) return null;

  const getCurrentHeadingLabel = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) {
        return `عنوان ${i}`;
      }
    }
    return "نص عادي";
  };

  const handleHeadingChange = (e) => {
    const level = parseInt(e.target.value, 10);
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().toggleHeading({ level }).run();
    }
  };

  const handleFontChange = (e) => {
    if (e.target.value) {
      editor.chain().focus().setFontFamily(e.target.value).run();
    }
  };

  const handleFontSizeChange = (e) => {
    const size = e.target.value;
    if (size) {
      editor.chain().focus().setMark("textStyle", { fontSize: `${size}px` }).run();
    }
  };

  const handleColorChange = (e) => {
    editor.chain().focus().setColor(e.target.value).run();
  };

  const handleHighlightChange = (e) => {
    editor.chain().focus().toggleHighlight({ color: e.target.value }).run();
  };

  const setLink = () => {
    const url = window.prompt("أدخل الرابط:");
    if (url) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else if (url === "") {
      editor.chain().focus().unsetLink().run();
    }
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="شريط تنسيق النص">
      {/* Undo / Redo */}
      <div className="toolbar__group">
        <TBtn title="تراجع (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo2 size={15} />
        </TBtn>
        <TBtn title="إعادة (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo2 size={15} />
        </TBtn>
      </div>

      <div className="toolbar__sep" />

      {/* Heading */}
      <div className="toolbar__group">
        <select
          className="toolbar-select"
          value={HEADINGS.find((h) =>
            h.level === 0
              ? !editor.isActive("heading")
              : editor.isActive("heading", { level: h.level })
          )?.level ?? 0}
          onChange={handleHeadingChange}
          title="نمط العنوان"
          style={{ minWidth: 90 }}
        >
          {HEADINGS.map((h) => (
            <option key={h.level} value={h.level}>
              {h.label}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar__sep" />

      {/* Font family */}
      <div className="toolbar__group">
        <select
          className="toolbar-select"
          onChange={handleFontChange}
          title="نوع الخط"
          style={{ minWidth: 100 }}
          defaultValue=""
        >
          <option value="">الخط</option>
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* Font size */}
      <div className="toolbar__group">
        <select
          className="toolbar-select"
          onChange={handleFontSizeChange}
          title="حجم الخط"
          style={{ minWidth: 56 }}
          defaultValue=""
        >
          <option value="">الحجم</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar__sep" />

      {/* Text formatting */}
      <div className="toolbar__group">
        <TBtn title="غامق (Ctrl+B)" isActive={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </TBtn>
        <TBtn title="مائل (Ctrl+I)" isActive={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={15} />
        </TBtn>
        <TBtn title="تسطير (Ctrl+U)" isActive={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <Underline size={15} />
        </TBtn>
        <TBtn title="يتوسطه خط" isActive={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={15} />
        </TBtn>
        <TBtn title="كود" isActive={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code size={15} />
        </TBtn>
      </div>

      <div className="toolbar__sep" />

      {/* Colors */}
      <div className="toolbar__group">
        <label title="لون النص" style={{ position: "relative", cursor: "pointer" }}>
          <input
            type="color"
            className="toolbar-color"
            onChange={handleColorChange}
            defaultValue="#202124"
            title="لون النص"
          />
        </label>
        <label title="تظليل" style={{ position: "relative", cursor: "pointer" }}>
          <input
            type="color"
            className="toolbar-color"
            onChange={handleHighlightChange}
            defaultValue="#ffff00"
            title="تظليل"
          />
          <Highlighter size={10} style={{ position: "absolute", bottom: 2, right: 2, pointerEvents: "none", opacity: 0.6 }} />
        </label>
      </div>

      <div className="toolbar__sep" />

      {/* Alignment */}
      <div className="toolbar__group">
        <TBtn title="محاذاة يمين" isActive={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight size={15} />
        </TBtn>
        <TBtn title="توسيط" isActive={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter size={15} />
        </TBtn>
        <TBtn title="محاذاة يسار" isActive={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft size={15} />
        </TBtn>
        <TBtn title="ضبط" isActive={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
          <AlignJustify size={15} />
        </TBtn>
      </div>

      <div className="toolbar__sep" />

      {/* Lists */}
      <div className="toolbar__group">
        <TBtn title="قائمة نقطية" isActive={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </TBtn>
        <TBtn title="قائمة مرقمة" isActive={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={15} />
        </TBtn>
        <TBtn title="اقتباس" isActive={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={15} />
        </TBtn>
      </div>

      <div className="toolbar__sep" />

      {/* More */}
      <div className="toolbar__group">
        <TBtn title="رابط" isActive={editor.isActive("link")} onClick={setLink}>
          <Link size={15} />
        </TBtn>
        <TBtn title="خط أفقي" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus size={15} />
        </TBtn>
        <TBtn title="مسح التنسيق" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting size={15} />
        </TBtn>
      </div>
    </div>
  );
}
