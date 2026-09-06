import { useState, useRef, useEffect } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Minus,
  Undo2, Redo2, Link, Highlighter, RemoveFormatting,
  Type, ChevronDown, X
} from "lucide-react";

const FONTS = [
  { value: "Amiri, 'Geeza Pro', serif", label: "أميري" },
  { value: "'Geeza Pro', sans-serif", label: "جيزة" },
  { value: "'Al Bayan', serif", label: "البيان" },
  { value: "'SF Arabic', -apple-system, sans-serif", label: "خط النظام" },
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

function TBtn({ title, isActive, onClick, disabled, children, style }) {
  return (
    <button
      className={`toolbar-btn${isActive ? " is-active" : ""}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
      type="button"
      tabIndex={-1}
      style={style}
    >
      {children}
    </button>
  );
}

function Dropdown({ trigger, children, open, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);
  if (!open) return trigger;
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {trigger}
      <div
        className="toolbar-dropdown"
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          right: 0,
          zIndex: 100,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          padding: 6,
          minWidth: 140,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ColorPalette({ colors, onSelect, onClear, activeColor }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, padding: 4 }}>
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onSelect(c)}
          title={c}
          style={{
            width: 22,
            height: 22,
            borderRadius: "var(--radius-sm)",
            background: c,
            border: activeColor === c ? "2px solid var(--primary)" : "1px solid var(--border)",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
      {onClear && (
        <button
          onClick={onClear}
          title="بدون لون"
          style={{
            width: 22,
            height: 22,
            borderRadius: "var(--radius-sm)",
            background: "transparent",
            border: "1px dashed var(--border)",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export default function Toolbar({ editor }) {
  if (!editor) return null;

  const [sizeOpen, setSizeOpen] = useState(false);
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [bgColorOpen, setBgColorOpen] = useState(false);

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
        <TBtn title="تراجع (⌘Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo2 size={15} />
        </TBtn>
        <TBtn title="إعادة (⌘⇧Z)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
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
          style={{ minWidth: 90 }}
        >
          {HEADINGS.map((h) => <option key={h.level} value={h.level}>{h.label}</option>)}
        </select>
      </div>

      <div className="toolbar__sep" />

      {/* Font family */}
      <div className="toolbar__group">
        <select className="toolbar-select" onChange={handleFontChange} title="نوع الخط" style={{ minWidth: 100 }} defaultValue="">
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
              style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 13, minWidth: 44 }}
            >
              <Type size={13} />
              {currentFontSize ? <span>{currentFontSize}</span> : null}
              <ChevronDown size={11} />
            </TBtn>
          }
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => handleFontSize(s)}
                style={{
                  padding: "4px 8px",
                  fontSize: s >= 24 ? 14 : s,
                  borderRadius: "var(--radius-sm)",
                  border: currentFontSize === s ? "2px solid var(--primary)" : "1px solid transparent",
                  background: currentFontSize === s ? "var(--primary-ghost)" : "transparent",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
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
        <TBtn title="غامق (⌘B)" isActive={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </TBtn>
        <TBtn title="مائل (⌘I)" isActive={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={15} />
        </TBtn>
        <TBtn title="تسطير (⌘U)" isActive={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <Underline size={15} />
        </TBtn>
        <TBtn title="يتوسطه خط" isActive={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={15} />
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
              style={{ display: "flex", alignItems: "center", gap: 2 }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: currentTextColor || "var(--text)", lineHeight: 1 }}>A</span>
              <span style={{ width: 14, height: 3, background: currentTextColor || "var(--text)", borderRadius: 1, display: "block" }} />
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
              style={{ display: "flex", alignItems: "center", gap: 2 }}
            >
              <Highlighter size={15} />
              <span style={{ width: 14, height: 3, background: currentHighlight || "var(--text-muted)", borderRadius: 1, display: "block" }} />
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
