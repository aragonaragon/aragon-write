import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import SpellcheckExtension from "./extensions/spellcheck";
import Toolbar from "./components/Toolbar";
import AIPanel from "./components/AIPanel";
import OutlineSidebar from "./components/OutlineSidebar";
import DocumentManager from "./components/DocumentManager";
import Settings from "./components/Settings";
import StatusBar from "./components/StatusBar";
import { PenLine, FolderOpen, Settings as SettingsIcon, Sun, Moon, Sparkles, AlignJustify, ZoomIn, ZoomOut } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const AUTOSAVE_DELAY = 1500;
const ARABIC_WORD_REGEX = /[\p{Script=Arabic}]+/gu;
const SPELLCHECK_DEBOUNCE_MS = 800;

const DEFAULT_SETTINGS = {
  ollamaUrl: "http://localhost:11434",
  model: "qwen2.5:7b",
  theme: "light",
  editorFont: "amiri",
  spellcheckEnabled: false,
  zoom: 100,
};

// ─── Document helpers ─────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadDocuments() {
  try {
    return JSON.parse(localStorage.getItem("aragon-write-docs") || "[]");
  } catch {
    return [];
  }
}

function saveDocuments(docs) {
  localStorage.setItem("aragon-write-docs", JSON.stringify(docs));
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem("aragon-write-settings") || "{}");
    // v2: reset spellcheck to off on first load with new version
    if (!stored._v2) {
      stored.spellcheckEnabled = false;
      stored._v2 = true;
      localStorage.setItem("aragon-write-settings", JSON.stringify(stored));
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  localStorage.setItem("aragon-write-settings", JSON.stringify(settings));
}

function normalizeWord(word) {
  return word.trim().replace(/\u0640/g, "");
}

function extractArabicWords(doc) {
  const words = [];
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    ARABIC_WORD_REGEX.lastIndex = 0;
    for (const match of node.text.matchAll(ARABIC_WORD_REGEX)) {
      const word = match[0];
      const start = match.index;
      if (typeof start !== "number" || !word) continue;
      const normalized = normalizeWord(word);
      if (!normalized) continue;
      words.push({
        id: `${position + start}-${position + start + word.length}-${normalized}`,
        word, normalized,
        from: position + start,
        to: position + start + word.length,
      });
    }
  });
  return words;
}

function buildDecorationsFromCache(doc, cache) {
  return extractArabicWords(doc)
    .map((item) => {
      const result = cache.get(item.normalized);
      if (!result || result.correct || !result.suggestion) return null;
      return { id: item.id, wrong: item.word, correct: result.suggestion, from: item.from, to: item.to };
    })
    .filter(Boolean);
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [documents, setDocuments] = useState(loadDocuments);
  const [currentDocId, setCurrentDocId] = useState(() => {
    const docs = loadDocuments();
    return docs.length > 0 ? docs[0].id : null;
  });
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [isOutlineOpen, setIsOutlineOpen] = useState(true);
  const [isDocManagerOpen, setIsDocManagerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [issueCount, setIssueCount] = useState(0);
  const [ollamaStatus, setOllamaStatus] = useState("checking");
  const [contextMenu, setContextMenu] = useState(null);
  const paperRef = useRef(null);
  const cacheRef = useRef(new Map());
  const pendingWordsRef = useRef(new Set());
  const debounceRef = useRef(null);
  const autosaveRef = useRef(null);
  const destroyedRef = useRef(false);

  const currentDoc = documents.find((d) => d.id === currentDocId) || null;

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // Check Ollama status
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (!cancelled) setOllamaStatus(res.ok ? "online" : "error");
      } catch {
        if (!cancelled) setOllamaStatus("error");
      }
    }
    check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Spellcheck helpers
  const syncDecorationsFromCache = useCallback((currentEditor) => {
    if (!currentEditor || currentEditor.isDestroyed) return;
    const errors = buildDecorationsFromCache(currentEditor.state.doc, cacheRef.current);
    currentEditor.commands.setSpellErrors(errors);
    setIssueCount(errors.length);
  }, []);

  const scheduleSpellcheck = useCallback((currentEditor) => {
    if (!settings.spellcheckEnabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!currentEditor || currentEditor.isDestroyed || destroyedRef.current) return;
      const words = extractArabicWords(currentEditor.state.doc);
      if (words.length === 0) {
        pendingWordsRef.current.clear();
        currentEditor.commands.clearSpellErrors();
        setIssueCount(0);
        return;
      }
      syncDecorationsFromCache(currentEditor);
      const uniqueWords = [...new Set(words.map((w) => w.normalized))];
      const toCheck = uniqueWords.filter(
        (w) => !cacheRef.current.has(w) && !pendingWordsRef.current.has(w)
      );
      if (toCheck.length === 0) return;
      toCheck.forEach((w) => pendingWordsRef.current.add(w));

      await Promise.all(
        toCheck.map(async (word) => {
          try {
            const res = await fetch(`${API_URL}/check-word`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ word, model: settings.model }),
            });
            const payload = await res.json();
            cacheRef.current.set(word, res.ok ? payload : { correct: true });
          } catch {
            cacheRef.current.set(word, { correct: true });
          } finally {
            pendingWordsRef.current.delete(word);
          }
          if (!destroyedRef.current && currentEditor && !currentEditor.isDestroyed) {
            syncDecorationsFromCache(currentEditor);
          }
        })
      );
    }, SPELLCHECK_DEBOUNCE_MS);
  }, [settings.spellcheckEnabled, settings.model, syncDecorationsFromCache]);

  // Editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "ابدأ الكتابة هنا..." }),
      SpellcheckExtension.configure({
        onWordContextMenu: ({ id, wrong, correct, from, to, clientX, clientY }) => {
          const paperRect = paperRef.current?.getBoundingClientRect();
          if (!paperRect) return;
          setContextMenu({
            id, wrong, correct, from, to,
            top: clientY - paperRect.top + 8,
            left: clientX - paperRect.left + 8,
          });
        },
      }),
    ],
    content: currentDoc?.content || "<p></p>",
    editorProps: {
      attributes: {
        class: "ProseMirror",
        dir: "rtl",
        lang: "ar",
        spellcheck: "false",
        autocorrect: "off",
        autocomplete: "off",
      },
    },
    onCreate: ({ editor: e }) => {
      const text = e.getText().trim();
      setStats({ words: text ? text.split(/\s+/).length : 0, chars: text.length });
      scheduleSpellcheck(e);
    },
    onUpdate: ({ editor: e, transaction }) => {
      const text = e.getText().trim();
      setStats({ words: text ? text.split(/\s+/).length : 0, chars: text.length });
      if (transaction.docChanged) {
        setContextMenu(null);
        scheduleSpellcheck(e);
        // Autosave
        if (autosaveRef.current) clearTimeout(autosaveRef.current);
        autosaveRef.current = setTimeout(() => {
          if (currentDocId) {
            setDocuments((prev) => {
              const updated = prev.map((d) =>
                d.id === currentDocId
                  ? { ...d, content: e.getHTML(), updatedAt: new Date().toISOString() }
                  : d
              );
              saveDocuments(updated);
              return updated;
            });
          }
        }, AUTOSAVE_DELAY);
      }
    },
    onSelectionUpdate: () => setContextMenu(null),
    immediatelyRender: false,
  });

  // Load doc content when switching documents
  useEffect(() => {
    if (editor && currentDoc) {
      const current = editor.getHTML();
      if (current !== currentDoc.content) {
        editor.commands.setContent(currentDoc.content || "<p></p>", false);
        cacheRef.current.clear();
        pendingWordsRef.current.clear();
      }
    }
  }, [currentDocId]); // eslint-disable-line

  useEffect(() => {
    destroyedRef.current = false;
    const handlePointerDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest(".context-menu")) setContextMenu(null);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setIsDocManagerOpen(false);
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      destroyedRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Document management
  const createDocument = useCallback(() => {
    const doc = {
      id: genId(),
      title: "مستند جديد",
      content: "<p></p>",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDocuments((prev) => {
      const updated = [doc, ...prev];
      saveDocuments(updated);
      return updated;
    });
    setCurrentDocId(doc.id);
    setIsDocManagerOpen(false);
    return doc;
  }, []);

  const openDocument = useCallback((id) => {
    setCurrentDocId(id);
    setIsDocManagerOpen(false);
  }, []);

  const deleteDocument = useCallback((id) => {
    setDocuments((prev) => {
      const updated = prev.filter((d) => d.id !== id);
      saveDocuments(updated);
      if (currentDocId === id) {
        setCurrentDocId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
  }, [currentDocId]);

  const updateDocTitle = useCallback((title) => {
    if (!currentDocId) return;
    setDocuments((prev) => {
      const updated = prev.map((d) =>
        d.id === currentDocId ? { ...d, title, updatedAt: new Date().toISOString() } : d
      );
      saveDocuments(updated);
      return updated;
    });
  }, [currentDocId]);

  const applySuggestion = useCallback(() => {
    if (!editor || !contextMenu) return;
    cacheRef.current.set(normalizeWord(contextMenu.correct), { correct: true });
    editor.commands.applySpellSuggestion({
      id: contextMenu.id, from: contextMenu.from, to: contextMenu.to, correct: contextMenu.correct,
    });
    setContextMenu(null);
    scheduleSpellcheck(editor);
    editor.commands.focus();
  }, [editor, contextMenu, scheduleSpellcheck]);

  const updateSettings = useCallback((updates) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      return next;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsAIPanelOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // Ensure at least one document exists
  useEffect(() => {
    if (documents.length === 0) {
      createDocument();
    }
  }, []); // eslint-disable-line

  return (
    <div id="root">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar__logo">
          <div className="topbar__logo-icon">أ</div>
        </div>

        <input
          className="topbar__doc-title"
          value={currentDoc?.title || ""}
          onChange={(e) => updateDocTitle(e.target.value)}
          placeholder="عنوان المستند"
          aria-label="عنوان المستند"
        />

        <div className="topbar__divider" />

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          <button
            className="btn-ai"
            onClick={() => setIsAIPanelOpen((v) => !v)}
            title="مساعد الكتابة الذكي (Ctrl+K)"
          >
            <Sparkles size={15} />
            مساعد AI
          </button>

          {/* Zoom controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--bg)", borderRadius: "var(--radius-md)", padding: "2px 4px", border: "1px solid var(--border)", direction: "ltr" }}>
            <button
              className="btn-icon"
              style={{ width: 26, height: 26 }}
              onClick={() => updateSettings({ zoom: Math.max(50, settings.zoom - 10) })}
              title="تصغير"
            >
              <ZoomOut size={13} />
            </button>
            <span
              style={{ fontSize: 12, minWidth: 36, textAlign: "center", color: "var(--text-secondary)", cursor: "pointer", userSelect: "none" }}
              onClick={() => updateSettings({ zoom: 100 })}
              title="إعادة إلى 100%"
            >
              {settings.zoom}%
            </span>
            <button
              className="btn-icon"
              style={{ width: 26, height: 26 }}
              onClick={() => updateSettings({ zoom: Math.min(250, settings.zoom + 10) })}
              title="تكبير"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          <button
            className="btn-icon"
            onClick={() => setIsOutlineOpen((v) => !v)}
            title="جدول المحتويات"
          >
            <AlignJustify size={16} />
          </button>

          <button
            className="btn-icon"
            onClick={() => setIsDocManagerOpen(true)}
            title="المستندات"
          >
            <FolderOpen size={16} />
          </button>

          <button
            className="btn-icon"
            onClick={() => updateSettings({ theme: settings.theme === "light" ? "dark" : "light" })}
            title="تبديل الوضع"
          >
            {settings.theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <button
            className="btn-icon"
            onClick={() => setIsSettingsOpen(true)}
            title="الإعدادات"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <Toolbar editor={editor} />

      {/* Editor Layout */}
      <div className="editor-layout">
        <OutlineSidebar editor={editor} isOpen={isOutlineOpen} />

        <main className="editor-stage">
          <div
            className="paper"
            ref={paperRef}
            style={{ "--editor-zoom": settings.zoom / 100 }}
          >
            <EditorContent editor={editor} />
            {contextMenu && (
              <div
                className="context-menu"
                style={{ top: contextMenu.top, left: contextMenu.left }}
              >
                <div className="context-menu__label">اقتراح إملائي</div>
                <button className="context-menu__action" onClick={applySuggestion}>
                  <PenLine size={13} />
                  استبدال بـ «{contextMenu.correct}»
                </button>
              </div>
            )}
          </div>
        </main>

        <AIPanel
          editor={editor}
          isOpen={isAIPanelOpen}
          onClose={() => setIsAIPanelOpen(false)}
          settings={settings}
          apiUrl={API_URL}
        />
      </div>

      {/* Status Bar */}
      <StatusBar
        stats={stats}
        issueCount={issueCount}
        ollamaStatus={ollamaStatus}
        model={settings.model}
        docCount={documents.length}
      />

      {/* Modals */}
      {isDocManagerOpen && (
        <DocumentManager
          documents={documents}
          currentDocId={currentDocId}
          onOpen={openDocument}
          onCreate={createDocument}
          onDelete={deleteDocument}
          onClose={() => setIsDocManagerOpen(false)}
          editor={editor}
        />
      )}

      {isSettingsOpen && (
        <Settings
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => setIsSettingsOpen(false)}
          apiUrl={API_URL}
        />
      )}
    </div>
  );
}
