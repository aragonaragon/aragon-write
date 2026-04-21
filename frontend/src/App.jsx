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
import ProjectManager from "./components/ProjectManager";
import Settings from "./components/Settings";
import StatusBar from "./components/StatusBar";
import {
  PenLine, FolderOpen, Settings as SettingsIcon, Sun, Moon, Sparkles,
  AlignJustify, ZoomIn, ZoomOut, Maximize2, Minimize2, Palette,
  BookOpen, ChevronLeft,
} from "lucide-react";

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
  writingGoal: 0,
  typewriterMode: false,
};

// ─── localStorage helpers ─────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function loadDocuments() {
  try { return JSON.parse(localStorage.getItem("aragon-write-docs") || "[]"); }
  catch { return []; }
}
function saveDocuments(docs) {
  localStorage.setItem("aragon-write-docs", JSON.stringify(docs));
}
function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem("aragon-write-settings") || "{}");
    if (!stored._v2) { stored.spellcheckEnabled = false; stored._v2 = true; localStorage.setItem("aragon-write-settings", JSON.stringify(stored)); }
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch { return DEFAULT_SETTINGS; }
}
function saveSettings(s) { localStorage.setItem("aragon-write-settings", JSON.stringify(s)); }

function normalizeWord(word) { return word.trim().replace(/\u0640/g, ""); }

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
      words.push({ id: `${position + start}-${position + start + word.length}-${normalized}`, word, normalized, from: position + start, to: position + start + word.length });
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
    }).filter(Boolean);
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [settings, setSettings] = useState(loadSettings);

  // ── Project state ──
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(
    () => localStorage.getItem("aragon-write-project") || null
  );
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);

  // ── Document state ──
  const [documents, setDocuments] = useState(loadDocuments);
  const [currentDocId, setCurrentDocId] = useState(() => {
    const docs = loadDocuments();
    return docs.length > 0 ? docs[0].id : null;
  });

  // ── UI state ──
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [isOutlineOpen, setIsOutlineOpen] = useState(true);
  const [isDocManagerOpen, setIsDocManagerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [sessionWords, setSessionWords] = useState(0);
  const [issueCount, setIssueCount] = useState(0);
  const [ollamaStatus, setOllamaStatus] = useState("checking");
  const [contextMenu, setContextMenu] = useState(null);

  const paperRef = useRef(null);
  const editorStageRef = useRef(null);
  const cacheRef = useRef(new Map());
  const pendingWordsRef = useRef(new Set());
  const debounceRef = useRef(null);
  const autosaveRef = useRef(null);
  const titleDebounceRef = useRef(null);
  const destroyedRef = useRef(false);
  const sessionStartWordsRef = useRef(null);
  const settingsRef = useRef(settings);
  const currentProjectIdRef = useRef(currentProjectId);
  const currentDocIdRef = useRef(currentDocId);
  const documentsRef = useRef(documents);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { currentProjectIdRef.current = currentProjectId; }, [currentProjectId]);
  useEffect(() => { currentDocIdRef.current = currentDocId; }, [currentDocId]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);

  const currentDoc = documents.find((d) => d.id === currentDocId) || null;
  const currentProject = projects.find((p) => p.id === currentProjectId) || null;
  const projectMode = !!currentProjectId;

  // Persist chosen project
  useEffect(() => {
    if (currentProjectId) localStorage.setItem("aragon-write-project", currentProjectId);
    else localStorage.removeItem("aragon-write-project");
  }, [currentProjectId]);

  // Apply theme
  useEffect(() => { document.documentElement.setAttribute("data-theme", settings.theme); }, [settings.theme]);

  // Ollama status
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (!cancelled) setOllamaStatus(res.ok ? "online" : "error");
      } catch { if (!cancelled) setOllamaStatus("error"); }
    }
    check();
    const iv = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // ── Load projects ──
  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/fs/projects`);
      if (res.ok) {
        const list = await res.json();
        setProjects(list);
        return list;
      }
    } catch {}
    return [];
  }, []);

  useEffect(() => { loadProjects(); }, []); // eslint-disable-line

  // ── Load project docs when project changes ──
  const loadProjectDocs = useCallback(async (projectId) => {
    try {
      const res = await fetch(`${API_URL}/fs/projects/${projectId}/docs`);
      if (res.ok) {
        const docs = await res.json();
        setDocuments(docs);
        setCurrentDocId(docs.length > 0 ? docs[0].id : null);
        sessionStartWordsRef.current = null;
        setSessionWords(0);
        return docs;
      }
    } catch {}
    return [];
  }, []);

  useEffect(() => {
    if (currentProjectId) {
      loadProjectDocs(currentProjectId);
    } else {
      // Back to localStorage docs
      const docs = loadDocuments();
      setDocuments(docs);
      setCurrentDocId(docs.length > 0 ? docs[0].id : null);
    }
  }, [currentProjectId]); // eslint-disable-line

  // ── Spellcheck ──
  const syncDecorationsFromCache = useCallback((e) => {
    if (!e || e.isDestroyed) return;
    const errors = buildDecorationsFromCache(e.state.doc, cacheRef.current);
    e.commands.setSpellErrors(errors);
    setIssueCount(errors.length);
  }, []);

  const scheduleSpellcheck = useCallback((e) => {
    if (!settings.spellcheckEnabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!e || e.isDestroyed || destroyedRef.current) return;
      const words = extractArabicWords(e.state.doc);
      if (words.length === 0) { pendingWordsRef.current.clear(); e.commands.clearSpellErrors(); setIssueCount(0); return; }
      syncDecorationsFromCache(e);
      const toCheck = [...new Set(words.map((w) => w.normalized))].filter(
        (w) => !cacheRef.current.has(w) && !pendingWordsRef.current.has(w)
      );
      if (toCheck.length === 0) return;
      toCheck.forEach((w) => pendingWordsRef.current.add(w));
      await Promise.all(toCheck.map(async (word) => {
        try {
          const res = await fetch(`${API_URL}/check-word`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word, model: settings.model }) });
          const payload = await res.json();
          cacheRef.current.set(word, res.ok ? payload : { correct: true });
        } catch { cacheRef.current.set(word, { correct: true }); }
        finally { pendingWordsRef.current.delete(word); }
        if (!destroyedRef.current && e && !e.isDestroyed) syncDecorationsFromCache(e);
      }));
    }, SPELLCHECK_DEBOUNCE_MS);
  }, [settings.spellcheckEnabled, settings.model, syncDecorationsFromCache]);

  // ── Editor ──
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle, Color, FontFamily,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "ابدأ الكتابة هنا..." }),
      SpellcheckExtension.configure({
        onWordContextMenu: ({ id, wrong, correct, from, to, clientX, clientY }) => {
          const paperRect = paperRef.current?.getBoundingClientRect();
          if (!paperRect) return;
          setContextMenu({ id, wrong, correct, from, to, top: clientY - paperRect.top + 8, left: clientX - paperRect.left + 8 });
        },
      }),
    ],
    content: currentDoc?.content || "<p></p>",
    editorProps: {
      attributes: { class: "ProseMirror", dir: "rtl", lang: "ar", spellcheck: "false", autocorrect: "off", autocomplete: "off" },
    },
    onCreate: ({ editor: e }) => {
      const text = e.getText().trim();
      const wc = text ? text.split(/\s+/).length : 0;
      setStats({ words: wc, chars: text.length });
      sessionStartWordsRef.current = wc;
      scheduleSpellcheck(e);
    },
    onUpdate: ({ editor: e, transaction }) => {
      const text = e.getText().trim();
      const wc = text ? text.split(/\s+/).length : 0;
      setStats({ words: wc, chars: text.length });
      if (sessionStartWordsRef.current === null) sessionStartWordsRef.current = wc;
      setSessionWords(Math.max(0, wc - sessionStartWordsRef.current));

      if (transaction.docChanged) {
        setContextMenu(null);
        scheduleSpellcheck(e);

        // Typewriter scroll
        if (settingsRef.current.typewriterMode && editorStageRef.current) {
          requestAnimationFrame(() => {
            try {
              const coords = e.view.coordsAtPos(e.state.selection.from);
              const stage = editorStageRef.current;
              if (!stage) return;
              const r = stage.getBoundingClientRect();
              stage.scrollTo({ top: stage.scrollTop + (coords.top - r.top) - r.height * 0.4, behavior: "smooth" });
            } catch {}
          });
        }

        // Autosave
        if (autosaveRef.current) clearTimeout(autosaveRef.current);
        autosaveRef.current = setTimeout(() => {
          const projId = currentProjectIdRef.current;
          const docId = currentDocIdRef.current;
          if (!docId) return;
          setDocuments((prev) => {
            const updated = prev.map((d) =>
              d.id === docId ? { ...d, content: e.getHTML(), updatedAt: new Date().toISOString() } : d
            );
            if (projId) {
              const doc = updated.find((d) => d.id === docId);
              if (doc) {
                fetch(`${API_URL}/fs/projects/${projId}/docs/${docId}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(doc),
                }).catch(() => {});
              }
            } else {
              saveDocuments(updated);
            }
            return updated;
          });
        }, AUTOSAVE_DELAY);
      }
    },
    onSelectionUpdate: () => setContextMenu(null),
    immediatelyRender: false,
  });

  // Load doc content when switching
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

  // Global event handlers
  useEffect(() => {
    destroyedRef.current = false;
    const handlePointerDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest(".context-menu")) setContextMenu(null);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") { setContextMenu(null); setIsDocManagerOpen(false); setIsSettingsOpen(false); setIsFocusMode(false); setIsProjectManagerOpen(false); }
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "F11") { e.preventDefault(); setIsFocusMode((v) => !v); }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setIsAIPanelOpen((v) => !v); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // ── Project management ──
  const createProject = useCallback(async (title) => {
    try {
      const res = await fetch(`${API_URL}/fs/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const project = await res.json();
        setProjects((prev) => [project, ...prev]);
        setCurrentProjectId(project.id);
        setIsProjectManagerOpen(false);
      }
    } catch {}
  }, []);

  const openProject = useCallback((id) => {
    setCurrentProjectId(id);
    setIsProjectManagerOpen(false);
  }, []);

  const deleteProject = useCallback(async (id) => {
    try {
      await fetch(`${API_URL}/fs/projects/${id}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (currentProjectId === id) {
        setCurrentProjectId(null);
      }
    } catch {}
  }, [currentProjectId]);

  const exitProject = useCallback(() => {
    setCurrentProjectId(null);
  }, []);

  // ── Document management ──
  const createDocument = useCallback(async () => {
    const doc = {
      id: genId(),
      title: projectMode ? "فصل جديد" : "مستند جديد",
      content: "<p></p>",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (projectMode) {
      try {
        const res = await fetch(`${API_URL}/fs/projects/${currentProjectId}/docs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(doc),
        });
        const saved = res.ok ? await res.json() : doc;
        setDocuments((prev) => [...prev, saved]);
        setCurrentDocId(saved.id);
        // Refresh project docCount
        loadProjects();
      } catch {
        setDocuments((prev) => [...prev, doc]);
        setCurrentDocId(doc.id);
      }
    } else {
      setDocuments((prev) => {
        const updated = [doc, ...prev];
        saveDocuments(updated);
        return updated;
      });
      setCurrentDocId(doc.id);
    }
    setIsDocManagerOpen(false);
    return doc;
  }, [projectMode, currentProjectId, loadProjects]);

  const openDocument = useCallback((id) => {
    setCurrentDocId(id);
    setIsDocManagerOpen(false);
    sessionStartWordsRef.current = null;
    setSessionWords(0);
  }, []);

  const deleteDocument = useCallback(async (id) => {
    if (projectMode) {
      try {
        await fetch(`${API_URL}/fs/projects/${currentProjectId}/docs/${id}`, { method: "DELETE" });
        loadProjects(); // refresh docCount
      } catch {}
    }
    setDocuments((prev) => {
      const updated = prev.filter((d) => d.id !== id);
      if (!projectMode) saveDocuments(updated);
      if (currentDocId === id) setCurrentDocId(updated.length > 0 ? updated[0].id : null);
      return updated;
    });
  }, [projectMode, currentProjectId, currentDocId, loadProjects]);

  const updateDocTitle = useCallback((title) => {
    if (!currentDocId) return;
    setDocuments((prev) => {
      const updated = prev.map((d) =>
        d.id === currentDocId ? { ...d, title, updatedAt: new Date().toISOString() } : d
      );
      if (!currentProjectIdRef.current) saveDocuments(updated);
      return updated;
    });
    // Debounced save to FS
    if (currentProjectIdRef.current) {
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      titleDebounceRef.current = setTimeout(() => {
        const doc = documentsRef.current.find((d) => d.id === currentDocId);
        if (doc) {
          fetch(`${API_URL}/fs/projects/${currentProjectIdRef.current}/docs/${currentDocId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...doc, title }),
          }).catch(() => {});
        }
      }, 800);
    }
  }, [currentDocId]);

  const applySuggestion = useCallback(() => {
    if (!editor || !contextMenu) return;
    cacheRef.current.set(normalizeWord(contextMenu.correct), { correct: true });
    editor.commands.applySpellSuggestion({ id: contextMenu.id, from: contextMenu.from, to: contextMenu.to, correct: contextMenu.correct });
    setContextMenu(null);
    scheduleSpellcheck(editor);
    editor.commands.focus();
  }, [editor, contextMenu, scheduleSpellcheck]);

  const updateSettings = useCallback((updates) => {
    setSettings((prev) => { const next = { ...prev, ...updates }; saveSettings(next); return next; });
  }, []);

  // Ensure at least one document exists (no-project mode)
  useEffect(() => {
    if (!projectMode && documents.length === 0) createDocument();
  }, []); // eslint-disable-line

  // Theme cycle
  const themeIcon = settings.theme === "dark" ? <Sun size={16} /> : settings.theme === "sepia" ? <Palette size={16} /> : <Moon size={16} />;
  const cycleTheme = () => {
    const next = settings.theme === "light" ? "dark" : settings.theme === "dark" ? "sepia" : "light";
    updateSettings({ theme: next });
  };
  const themeNextLabel = settings.theme === "light" ? "داكن" : settings.theme === "dark" ? "عاجي" : "فاتح";

  return (
    <div id="root" className={isFocusMode ? "app-focus-mode" : ""}>
      {isFocusMode && (
        <div className="focus-exit-hint">
          <span>F11 أو ESC — للخروج من وضع التركيز</span>
        </div>
      )}

      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar__logo">
          <div className="topbar__logo-icon">أ</div>
        </div>

        {/* Project breadcrumb */}
        {projectMode ? (
          <div className="topbar__breadcrumb">
            <button className="topbar__breadcrumb-btn" onClick={() => setIsProjectManagerOpen(true)} title="المكتبة">
              <BookOpen size={14} />
              <span>{currentProject?.title || "..."}</span>
            </button>
            <ChevronLeft size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          </div>
        ) : (
          <button
            className="topbar__library-btn"
            onClick={() => setIsProjectManagerOpen(true)}
            title="مكتبة الروايات"
          >
            <BookOpen size={14} />
            مكتبتي
          </button>
        )}

        <input
          className="topbar__doc-title"
          value={currentDoc?.title || ""}
          onChange={(e) => updateDocTitle(e.target.value)}
          placeholder={projectMode ? "عنوان الفصل" : "عنوان المستند"}
          aria-label="عنوان المستند"
        />

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          <button className="btn-ai" onClick={() => setIsAIPanelOpen((v) => !v)} title="مساعد الكتابة الذكي (Ctrl+K)">
            <Sparkles size={15} />مساعد AI
          </button>

          {/* Zoom */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--bg)", borderRadius: "var(--radius-md)", padding: "2px 4px", border: "1px solid var(--border)", direction: "ltr" }}>
            <button className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => updateSettings({ zoom: Math.max(50, settings.zoom - 10) })} title="تصغير"><ZoomOut size={13} /></button>
            <span style={{ fontSize: 12, minWidth: 36, textAlign: "center", color: "var(--text-secondary)", cursor: "pointer", userSelect: "none" }} onClick={() => updateSettings({ zoom: 100 })} title="100%">{settings.zoom}%</span>
            <button className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => updateSettings({ zoom: Math.min(250, settings.zoom + 10) })} title="تكبير"><ZoomIn size={13} /></button>
          </div>

          <button className="btn-icon" onClick={() => setIsOutlineOpen((v) => !v)} title="جدول المحتويات"><AlignJustify size={16} /></button>
          <button className="btn-icon" onClick={() => setIsDocManagerOpen(true)} title={projectMode ? "فصول الرواية" : "المستندات"}><FolderOpen size={16} /></button>
          <button className="btn-icon" onClick={cycleTheme} title={`التالي: ${themeNextLabel}`}>{themeIcon}</button>
          <button className={`btn-icon${isFocusMode ? " active" : ""}`} onClick={() => setIsFocusMode((v) => !v)} title={isFocusMode ? "الخروج (F11)" : "وضع التركيز (F11)"}>{isFocusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="btn-icon" onClick={() => setIsSettingsOpen(true)} title="الإعدادات"><SettingsIcon size={16} /></button>
        </div>
      </header>

      <Toolbar editor={editor} />

      <div className="editor-layout">
        <OutlineSidebar editor={editor} isOpen={isOutlineOpen} />

        <main className="editor-stage" ref={editorStageRef}>
          <div className="paper" ref={paperRef} style={{ "--editor-zoom": settings.zoom / 100 }}>
            <EditorContent editor={editor} />
            {contextMenu && (
              <div className="context-menu" style={{ top: contextMenu.top, left: contextMenu.left }}>
                <div className="context-menu__label">اقتراح إملائي</div>
                <button className="context-menu__action" onClick={applySuggestion}>
                  <PenLine size={13} />استبدال بـ «{contextMenu.correct}»
                </button>
              </div>
            )}
          </div>
        </main>

        <AIPanel editor={editor} isOpen={isAIPanelOpen} onClose={() => setIsAIPanelOpen(false)} settings={settings} apiUrl={API_URL} />
      </div>

      <StatusBar
        stats={stats}
        issueCount={issueCount}
        ollamaStatus={ollamaStatus}
        model={settings.model}
        docCount={documents.length}
        sessionWords={sessionWords}
        writingGoal={settings.writingGoal || 0}
      />

      {/* Modals */}
      {isProjectManagerOpen && (
        <ProjectManager
          projects={projects}
          currentProjectId={currentProjectId}
          onOpen={openProject}
          onCreate={createProject}
          onDelete={deleteProject}
          onClose={() => setIsProjectManagerOpen(false)}
        />
      )}

      {isDocManagerOpen && (
        <DocumentManager
          documents={documents}
          currentDocId={currentDocId}
          onOpen={openDocument}
          onCreate={createDocument}
          onDelete={deleteDocument}
          onClose={() => setIsDocManagerOpen(false)}
          editor={editor}
          projectMode={projectMode}
          projectTitle={currentProject?.title}
          onExitProject={exitProject}
        />
      )}

      {isSettingsOpen && (
        <Settings
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => setIsSettingsOpen(false)}
          apiUrl={API_URL}
          onOllamaStatusChange={setOllamaStatus}
        />
      )}
    </div>
  );
}
