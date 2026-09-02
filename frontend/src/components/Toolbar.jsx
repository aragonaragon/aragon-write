import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Code, Minus,
  Undo2, Redo2, Link, Highlighter, RemoveFormatting,
  Type, ChevronDown, X
} from "lucide-react";

const FONTS = [
  { value: "Amiri, serif", label: "أميري" },
  { value: "IBM Plex Sans Arabic, sans-serif", label: "بلكس" },
  { value: "Traditional Arabic, serif", label: "عربي تقليدي" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Times New Roman, serif", label: "Times New Roman" },
];

const SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

const HEADINGS = [
  { label: "نص عادي", level: 0 },
  { label: "عنوان 1", level: 1 },
  { label: "عنوان 2", level: 2 },
  { label: "عنوان 3", level: 3 },
  { label: "عنوان 4", level: 4 },
];

const TEXT_COLORS = [
  "#000000", "#434343", "#666666", "#999999",
  "#b45f06", "#ff9900", "#38761d", "#0b5394",
  "#351c75", "#741b47", "#c00", "#e06666",
];

const BG_COLORS = [
  "#ffffff", "#cccccc", "#ffff00", "#ff9900",
  "#00ff00", "#00ffff", "#9900ff", "#ff00ff",
  "#ff0000", "#fce5cd", "#d9ead3", "#c9daf8",
];

function TBtn({ title, isActive, onClick, disabled, children, style, className }) {
  return (
    <button
      className={`toolbar-btn${isActive ? " is-active" : ""}${className ? ` ${className}` : ""}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
      type="button"
      aria-label={title}
      style={style}
    >
      {children}
    </button>
  );
}

function Dropdown({ trigger, children, open, onClose }) {
  const ref = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !menuRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);

  const rect = open ? ref.current?.getBoundingClientRect() : null;
  return (
    <div ref={ref} className="toolbar-dropdown-wrap">
      {trigger}
      {open && createPortal(
        <div
          ref={menuRef}
          className="toolbar-dropdown toolbar-dropdown--floating"
          role="menu"
          style={rect ? {
            top: rect.bottom + 5,
            right: document.documentElement.clientWidth - rect.right,
          } : undefined}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  );
}

function ColorPalette({ colors, onSelect, onClear, activeColor }) {
  return (
    <div className="color-palette">
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onSelect(c)}
          title={c}
          aria-label={`اختيار اللون ${c}`}
          className={`color-palette__swatch${activeColor === c ? " active" : ""}`}
          style={{ "--swatch-color": c }}
        />
      ))}
      {onClear && (
        <button
          onClick={onClear}
          title="بدون لون"
          aria-label="إزالة اللون"
          className="color-palette__swatch color-palette__swatch--clear"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export default function Toolbar({ editor }) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [bgColorOpen, setBgColorOpen] = useState(false);

  if (!editor) return null;

  const getCurrentHeadingLabel = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) return `عنوان ${i}`;
    }
    return "نص عادي";
  };

  const handleHeadingChange = (e) => {
    const level = parseInt(e.target.value, 10);
    if (level === 0) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level }).run();
  };

  const handleFontChange = (e) => {
    if (e.target.value) editor.chain().focus().setFontFamily(e.target.value).run();
  };

  const handleFontSize = (size) => {
    editor.chain().focus().setFontSize(size).run();
    setSizeOpen(false);
  };

  const handleTextColor = (color) => {
    editor.chain().focus().setColor(color).run();
    setTextColorOpen(false);
  };

  const handleBgColor = (color) => {
    editor.chain().focus().toggleHighlight({ color }).run();
    setBgColorOpen(false);
  };

  const clearHighlight = () => {
    editor.chain().focus().unsetHighlight().run();
    setBgColorOpen(false);
  };

  const setLink = () => {
    const url = window.prompt("أدخل الرابط:");
    if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    else if (url === "") editor.chain().focus().unsetLink().run();
  };

  // Detect current font size from fontSize mark
  const getCurrentFontSize = () => {
    const attrs = editor.getAttributes("fontSize");
    return attrs?.fontSize || "";
  };

  const currentFontSize = getCurrentFontSize();
  const currentTextColor = editor.getAttributes("textStyle")?.color || "";
  const currentHighlight = editor.getAttributes("highlight")?.color || "";

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
          value={HEADINGS.find((h) => h.level === 0 ? !editor.isActive("heading") : editor.isActive("heading", { level: h.level }))?.level ?? 0}
          onChange={handleHeadingChange}
          title="نمط العنوان"
        >
          {HEADINGS.map((h) => <option key={h.level} value={h.level}>{h.label}</option>)}
        </select>
      </div>

      <div className="toolbar__sep" />

      {/* Font family */}
      <div className="toolbar__group">
        <select className="toolbar-select" onChange={handleFontChange} title="نوع الخط" defaultValue="">
          <option value="">الخط</option>
          {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {/* Font size */}
      <div className="toolbar__group">
        <Dropdown
          open={sizeOpen}
          onClose={() => setSizeOpen(false)}
          trigger={
            <TBtn
              title="حجم الخط"
              onClick={() => setSizeOpen((v) => !v)}
              className="toolbar-btn--wide"
            >
              <Type size={13} />
              {currentFontSize ? <span>{currentFontSize}</span> : null}
              <ChevronDown size={11} />
            </TBtn>
          }
        >
          <div className="font-size-grid">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => handleFontSize(s)}
                className={`font-size-grid__option${currentFontSize === s ? " active" : ""}`}
              >
                {s}
              </button>
            ))}
          </div>
        </Dropdown>
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

      {/* Text color */}
      <div className="toolbar__group">
        <Dropdown
          open={textColorOpen}
          onClose={() => setTextColorOpen(false)}
          trigger={
            <TBtn
              title="لون النص"
              onClick={() => setTextColorOpen((v) => !v)}
              isActive={!!currentTextColor}
              className="toolbar-btn--combo"
            >
              <span className="toolbar-color__glyph" style={{ "--swatch-color": currentTextColor || "var(--text)" }}>A</span>
              <span className="toolbar-color__bar" style={{ "--swatch-color": currentTextColor || "var(--text)" }} />
            </TBtn>
          }
        >
          <ColorPalette
            colors={TEXT_COLORS}
            onSelect={handleTextColor}
            onClear={() => { editor.chain().focus().unsetColor().run(); setTextColorOpen(false); }}
            activeColor={currentTextColor}
          />
        </Dropdown>

        {/* Background color */}
        <Dropdown
          open={bgColorOpen}
          onClose={() => setBgColorOpen(false)}
          trigger={
            <TBtn
              title="لون الخلفية"
              onClick={() => setBgColorOpen((v) => !v)}
              isActive={editor.isActive("highlight")}
              className="toolbar-btn--combo"
            >
              <Highlighter size={15} />
              <span className="toolbar-color__bar" style={{ "--swatch-color": currentHighlight || "var(--text-3)" }} />
            </TBtn>
          }
        >
          <ColorPalette
            colors={BG_COLORS}
            onSelect={handleBgColor}
            onClear={clearHighlight}
            activeColor={currentHighlight}
          />
        </Dropdown>
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
