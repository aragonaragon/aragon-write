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
import FontSize from "./extensions/fontSize";
import Toolbar from "./components/Toolbar";
import Toast from "./components/Toast";
import AIPanel from "./components/AIPanel";
import OutlineSidebar from "./components/OutlineSidebar";
import DocumentManager from "./components/DocumentManager";
import DocSwitcher from "./components/DocSwitcher";
import ProjectManager from "./components/ProjectManager";
import Settings from "./components/Settings";
import StatusBar from "./components/StatusBar";
import Welcome from "./components/Welcome";
import Home from "./components/Home";
import FileMenu from "./components/FileMenu";
import ImportDialog from "./components/ImportDialog";
import {
  saveTextAs, saveHtmlAs, savePdfAs, saveDocxAs,
  pickAndReadFile, mdToHtml, htmlToMd, htmlToText,
  readDocxAsHtml, readPdfAsHtml,
} from "./lib/fileIO";
import {
  clearProjectDraft,
  clearProjectDraftIfCurrent,
  clearProjectDrafts,
  mergeProjectDrafts,
  saveProjectDraft,
} from "./lib/autosave";
import {
  PenLine, FolderOpen, Settings as SettingsIcon, Sun, Moon, Sparkles,
  AlignJustify, ZoomIn, ZoomOut, Maximize2, Minimize2, Palette,
  BookOpen, ChevronLeft,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const AUTOSAVE_DELAY = 700;
const ARABIC_WORD_REGEX = /[\p{Script=Arabic}]+/gu;
const SPELLCHECK_DEBOUNCE_MS = 800;

const DEFAULT_SETTINGS = {
  ollamaUrl: "http://localhost:11434",
  model: "gemma4:e4b",
  theme: "dark",
  editorFont: "amiri",
  spellcheckEnabled: false,
  zoom: 100,
  writingGoal: 0,
  typewriterMode: false,
  // External AI provider (for weak devices / cloud usage)
  provider: "ollama",      // "ollama" | "openai_compat"
  apiBaseUrl: "",
  apiKey: "",
  apiModel: "",
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
  const [isHome, setIsHome] = useState(true);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [isOutlineOpen, setIsOutlineOpen] = useState(true);
  const [pendingImport, setPendingImport] = useState(null); // { sourceName, wordCount, html, warning } | null
  const [isDocManagerOpen, setIsDocManagerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [sessionWords, setSessionWords] = useState(0);
  const [issueCount, setIssueCount] = useState(0);
  const [ollamaStatus, setOllamaStatus] = useState("checking");
  const [contextMenu, setContextMenu] = useState(null);
  const [ollamaAction, setOllamaAction] = useState(null); // "starting" | "killing" | null
  const [toasts, setToasts] = useState([]);
  const [saveStatus, setSaveStatus] = useState("saved"); // "saved" | "saving" | "error"
  const [loadedProjectId, setLoadedProjectId] = useState(null); // project whose docs finished loading

  const paperRef = useRef(null);
  const editorStageRef = useRef(null);
  const cacheRef = useRef(new Map());
  const pendingWordsRef = useRef(new Set());
  const debounceRef = useRef(null);
  const autosaveTimersRef = useRef(new Map());
  const pendingProjectSavesRef = useRef(new Map());
  const projectSaveQueuesRef = useRef(new Map());
  const projectLoadRequestRef = useRef(0);
  const destroyedRef = useRef(false);
  const sessionStartWordsRef = useRef(null);
  const settingsRef = useRef(settings);
  const currentProjectIdRef = useRef(currentProjectId);
  const currentDocIdRef = useRef(currentDocId);
  const documentsRef = useRef(documents);
  const autoCreatedForRef = useRef(null);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { currentProjectIdRef.current = currentProjectId; }, [currentProjectId]);
  useEffect(() => { currentDocIdRef.current = currentDocId; }, [currentDocId]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);

  // Serialize saves within each project. The backend updates a shared project
  // metadata file, so ordered writes also protect that atomic-write path.
  const enqueueProjectSave = useCallback(({ projectId, doc }) => {
    if (!projectId || !doc?.id) return Promise.resolve(false);
    const previous = projectSaveQueuesRef.current.get(projectId) || Promise.resolve();
    const request = previous
      .catch(() => {})
      .then(async () => {
        const res = await fetch(`${API_URL}/fs/projects/${projectId}/docs/${doc.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(doc),
          keepalive: true,
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        const cleared = clearProjectDraftIfCurrent(projectId, doc);
        if (cleared && pendingProjectSavesRef.current.size === 0) setSaveStatus("saved");
        return true;
      })
      .catch(() => {
        // The synchronous local draft remains available for recovery.
        setSaveStatus("error");
        return false;
      })
      .finally(() => {
        if (projectSaveQueuesRef.current.get(projectId) === request) {
          projectSaveQueuesRef.current.delete(projectId);
        }
      });
    projectSaveQueuesRef.current.set(projectId, request);
    return request;
  }, []);

  const flushProjectSave = useCallback((key) => {
    const pending = pendingProjectSavesRef.current.get(key);
    if (!pending) return Promise.resolve(false);
    const timer = autosaveTimersRef.current.get(key);
    if (timer) clearTimeout(timer);
    autosaveTimersRef.current.delete(key);
    pendingProjectSavesRef.current.delete(key);
    return enqueueProjectSave(pending);
  }, [enqueueProjectSave]);

  const scheduleProjectSave = useCallback((projectId, doc, delay = AUTOSAVE_DELAY) => {
    const key = `${projectId}:${doc.id}`;
    const previousTimer = autosaveTimersRef.current.get(key);
    if (previousTimer) clearTimeout(previousTimer);
    pendingProjectSavesRef.current.set(key, { projectId, doc });
    autosaveTimersRef.current.set(key, setTimeout(() => flushProjectSave(key), delay));
    setSaveStatus("saving");
  }, [flushProjectSave]);

  const flushPendingProjectSaves = useCallback(() => {
    const keys = [...pendingProjectSavesRef.current.keys()];
    return Promise.all(keys.map((key) => flushProjectSave(key)));
  }, [flushProjectSave]);

  const cancelDocumentSave = useCallback(async (projectId, docId) => {
    const key = `${projectId}:${docId}`;
    const timer = autosaveTimersRef.current.get(key);
    if (timer) clearTimeout(timer);
    autosaveTimersRef.current.delete(key);
    pendingProjectSavesRef.current.delete(key);
    clearProjectDraft(projectId, docId);
    await (projectSaveQueuesRef.current.get(projectId) || Promise.resolve());
  }, []);

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

  // Auto-disable spellcheck when switching to an external API provider.
  // Per-word requests to a paid API would be expensive; we keep spellcheck local-only.
  useEffect(() => {
    if (settings.provider === "openai_compat" && settings.spellcheckEnabled) {
      setSettings((prev) => {
        const next = { ...prev, spellcheckEnabled: false };
        saveSettings(next);
        return next;
      });
      showToast("التدقيق الإملائي عُطّل تلقائياً — يعمل محلياً فقط", "info", 5000);
    }
  }, [settings.provider]); // eslint-disable-line

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

  useEffect(() => {
    loadProjects();
    // No auto-select: the user chooses from the Home screen explicitly.
  }, []); // eslint-disable-line

  // ── Load project docs when project changes ──
  const loadProjectDocs = useCallback(async (projectId) => {
    const requestId = ++projectLoadRequestRef.current;
    try {
      const res = await fetch(`${API_URL}/fs/projects/${projectId}/docs`);
      if (res.ok) {
        const savedDocs = await res.json();
        if (requestId !== projectLoadRequestRef.current || currentProjectIdRef.current !== projectId) {
          return [];
        }
        const { documents: docs, recovered, stale } = mergeProjectDrafts(projectId, savedDocs);
        stale.forEach((docId) => clearProjectDraft(projectId, docId));
        documentsRef.current = docs;
        setDocuments(docs);
        setCurrentDocId(docs.length > 0 ? docs[0].id : null);
        sessionStartWordsRef.current = null;
        setSessionWords(0);
        autoCreatedForRef.current = null;
        setLoadedProjectId(projectId);
        if (recovered.length > 0) {
          setSaveStatus("saving");
          setToasts((prev) => [...prev, {
            id: genId(),
            message: recovered.length === 1
              ? "تم استعادة آخر كتابة غير محفوظة"
              : `تم استعادة ${recovered.length} مسودات غير محفوظة`,
            type: "success",
            duration: 6000,
          }]);
          recovered.forEach((doc) => enqueueProjectSave({ projectId, doc }));
        } else {
          setSaveStatus("saved");
        }
        return docs;
      }
    } catch {}
    return [];
  }, [enqueueProjectSave]);

  useEffect(() => {
    setLoadedProjectId(null);
    if (currentProjectId) {
      loadProjectDocs(currentProjectId);
    } else {
      projectLoadRequestRef.current += 1;
      // Back to localStorage docs
      const docs = loadDocuments();
      documentsRef.current = docs;
      setDocuments(docs);
      setCurrentDocId(docs.length > 0 ? docs[0].id : null);
      setSaveStatus("saved");
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
      // Batch word checks into a single request
      try {
        const res = await fetch(`${API_URL}/check-words`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words: toCheck, model: settings.model }),
        });
        if (res.ok) {
          const results = await res.json();
          for (const item of results) {
            if (item && item.word !== undefined) {
              cacheRef.current.set(item.word, item.result || { correct: true });
            }
          }
        } else {
          // fallback: mark all as correct on server error
          for (const w of toCheck) cacheRef.current.set(w, { correct: true });
        }
      } catch {
        for (const w of toCheck) cacheRef.current.set(w, { correct: true });
      } finally {
        for (const w of toCheck) pendingWordsRef.current.delete(w);
      }
      if (!destroyedRef.current && e && !e.isDestroyed) syncDecorationsFromCache(e);
    }, SPELLCHECK_DEBOUNCE_MS);
  }, [settings.spellcheckEnabled, settings.model, syncDecorationsFromCache]);

  // ── Editor ──
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle, Color, FontFamily, FontSize,
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

        // Keep an immediate, synchronous copy before the delayed disk sync.
        // Capture the IDs and HTML now so switching documents cannot redirect
        // this edit to a different chapter.
        const projectId = currentProjectIdRef.current;
        const docId = currentDocIdRef.current;
        const existing = documentsRef.current.find((doc) => doc.id === docId);
        if (docId && existing) {
          const snapshot = {
            ...existing,
            content: e.getHTML(),
            updatedAt: new Date().toISOString(),
          };
          const updated = documentsRef.current.map((doc) => doc.id === docId ? snapshot : doc);
          documentsRef.current = updated;
          setDocuments(updated);

          if (projectId) {
            const draftSaved = saveProjectDraft(projectId, snapshot);
            scheduleProjectSave(projectId, snapshot);
            if (!draftSaved) setSaveStatus("error");
          } else {
            try {
              saveDocuments(updated);
              setSaveStatus("saved");
            } catch {
              setSaveStatus("error");
            }
          }
        }
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
  }, [currentDocId, currentProjectId]); // eslint-disable-line

  // Flush delayed disk writes whenever the app is hidden or closed. The local
  // draft is already synchronous, so it remains recoverable even if shutdown
  // interrupts the network request.
  useEffect(() => {
    const flush = () => { flushPendingProjectSaves(); };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [flushPendingProjectSaves]);

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
      autosaveTimersRef.current.forEach((timer) => clearTimeout(timer));
      autosaveTimersRef.current.clear();
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "F11") { e.preventDefault(); setIsFocusMode((v) => !v); }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setIsAIPanelOpen((v) => !v); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flushPendingProjectSaves();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [flushPendingProjectSaves]);

  // ── Project management ──
  const createProject = useCallback(async (title) => {
    await flushPendingProjectSaves();
    try {
      const res = await fetch(`${API_URL}/fs/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const project = await res.json();
        setProjects((prev) => [project, ...prev]);
        currentProjectIdRef.current = project.id;
        setCurrentProjectId(project.id);
        setIsProjectManagerOpen(false);
        setIsHome(false);
      }
    } catch {}
  }, [flushPendingProjectSaves]);

  const openProject = useCallback((id) => {
    flushPendingProjectSaves();
    currentProjectIdRef.current = id;
    setCurrentProjectId(id);
    setIsProjectManagerOpen(false);
    setIsHome(false);
  }, [flushPendingProjectSaves]);

  const startQuickWrite = useCallback(() => {
    flushPendingProjectSaves();
    currentProjectIdRef.current = null;
    setCurrentProjectId(null);
    setIsHome(false);
  }, [flushPendingProjectSaves]);

  const goHome = useCallback(() => {
    flushPendingProjectSaves();
    setIsHome(true);
  }, [flushPendingProjectSaves]);

  const deleteProject = useCallback(async (id) => {
    try {
      await flushPendingProjectSaves();
      await fetch(`${API_URL}/fs/projects/${id}`, { method: "DELETE" });
      clearProjectDrafts(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (currentProjectId === id) {
        currentProjectIdRef.current = null;
        setCurrentProjectId(null);
      }
    } catch {}
  }, [currentProjectId, flushPendingProjectSaves]);

  const exitProject = useCallback(() => {
    flushPendingProjectSaves();
    currentProjectIdRef.current = null;
    setCurrentProjectId(null);
  }, [flushPendingProjectSaves]);

  // ── Document management ──
  const createDocument = useCallback(async () => {
    await flushPendingProjectSaves();
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
        if (!res.ok) {
          saveProjectDraft(currentProjectId, saved);
          setSaveStatus("error");
        }
        setDocuments((prev) => {
          const next = [...prev, saved];
          documentsRef.current = next;
          return next;
        });
        currentDocIdRef.current = saved.id;
        setCurrentDocId(saved.id);
        // Refresh project docCount
        loadProjects();
      } catch {
        saveProjectDraft(currentProjectId, doc);
        setSaveStatus("error");
        setDocuments((prev) => {
          const next = [...prev, doc];
          documentsRef.current = next;
          return next;
        });
        currentDocIdRef.current = doc.id;
        setCurrentDocId(doc.id);
      }
    } else {
      setDocuments((prev) => {
        const updated = [doc, ...prev];
        saveDocuments(updated);
        documentsRef.current = updated;
        return updated;
      });
      currentDocIdRef.current = doc.id;
      setCurrentDocId(doc.id);
    }
    setIsDocManagerOpen(false);
    return doc;
  }, [projectMode, currentProjectId, loadProjects, flushPendingProjectSaves]);

  const openDocument = useCallback((id) => {
    flushPendingProjectSaves();
    currentDocIdRef.current = id;
    setCurrentDocId(id);
    setIsDocManagerOpen(false);
    sessionStartWordsRef.current = null;
    setSessionWords(0);
  }, [flushPendingProjectSaves]);

  const deleteDocument = useCallback(async (id) => {
    if (projectMode) {
      try {
        await cancelDocumentSave(currentProjectId, id);
        await fetch(`${API_URL}/fs/projects/${currentProjectId}/docs/${id}`, { method: "DELETE" });
        loadProjects(); // refresh docCount
      } catch {}
    }
    setDocuments((prev) => {
      const updated = prev.filter((d) => d.id !== id);
      if (!projectMode) saveDocuments(updated);
      documentsRef.current = updated;
      if (currentDocId === id) {
        const nextId = updated.length > 0 ? updated[0].id : null;
        currentDocIdRef.current = nextId;
        setCurrentDocId(nextId);
      }
      return updated;
    });
  }, [projectMode, currentProjectId, currentDocId, loadProjects, cancelDocumentSave]);

  const updateDocTitle = useCallback((title) => {
    const docId = currentDocIdRef.current;
    const projectId = currentProjectIdRef.current;
    const existing = documentsRef.current.find((doc) => doc.id === docId);
    if (!docId || !existing) return;
    const snapshot = { ...existing, title, updatedAt: new Date().toISOString() };
    const updated = documentsRef.current.map((doc) => doc.id === docId ? snapshot : doc);
    documentsRef.current = updated;
    setDocuments(updated);

    if (projectId) {
      const draftSaved = saveProjectDraft(projectId, snapshot);
      scheduleProjectSave(projectId, snapshot, 400);
      if (!draftSaved) setSaveStatus("error");
    } else {
      try {
        saveDocuments(updated);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }
  }, [scheduleProjectSave]);

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

  // ── Toast ──
  const showToast = useCallback((message, type = "info", duration = 4000) => {
    const id = genId();
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Ollama control ──
  const startOllama = useCallback(async () => {
    setOllamaAction("starting");
    try {
      await fetch(`${API_URL}/ollama/start`, { method: "POST" });
      setTimeout(() => setOllamaStatus("online"), 3000);
    } catch {}
    setTimeout(() => setOllamaAction(null), 3200);
  }, []);

  const killOllama = useCallback(async () => {
    setOllamaAction("killing");
    try {
      await fetch(`${API_URL}/ollama/kill`, { method: "POST" });
      setOllamaStatus("error");
    } catch {}
    setTimeout(() => setOllamaAction(null), 1000);
  }, []);

  // ── File menu actions (Save As / Import / Export Project) ──
  const runFileAction = useCallback(async (action) => {
    const title = (currentDoc?.title || "مستند").trim() || "مستند";
    const safeName = title.replace(/[\\/:*?"<>|]/g, "_"); // strip Windows-invalid filename chars

    // SAVE AS
    if (action === "save-as-md") {
      if (!editor) return;
      const md = htmlToMd(editor.getHTML());
      const r = await saveTextAs(
        { defaultName: `${safeName}.md`, ext: "md", label: "Markdown", content: md },
        API_URL,
      );
      if (r.ok) showToast("تم الحفظ", "success");
      else if (r.error) showToast(r.error, "error");
      return;
    }
    if (action === "save-as-txt") {
      if (!editor) return;
      const txt = htmlToText(editor.getHTML());
      const r = await saveTextAs(
        { defaultName: `${safeName}.txt`, ext: "txt", label: "Plain Text", content: txt },
        API_URL,
      );
      if (r.ok) showToast("تم الحفظ", "success");
      else if (r.error) showToast(r.error, "error");
      return;
    }
    if (action === "save-as-html") {
      if (!editor) return;
      const r = await saveHtmlAs(
        { defaultName: `${safeName}.html`, htmlBody: editor.getHTML(), title },
        API_URL,
      );
      if (r.ok) showToast("تم الحفظ", "success");
      else if (r.error) showToast(r.error, "error");
      return;
    }
    if (action === "save-as-docx") {
      if (!editor) return;
      const r = await saveDocxAs(
        { defaultName: `${safeName}.docx`, htmlBody: editor.getHTML(), title },
        API_URL,
      );
      if (r.ok) showToast("تم تصدير Word", "success");
      else if (r.error) showToast(r.error, "error");
      return;
    }
    if (action === "save-as-pdf") {
      if (!editor) return;
      // Wrap HTML in standalone RTL doc first (re-use the backend's wrapper).
      try {
        const wrapRes = await fetch(`${API_URL}/convert/wrap-html`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: editor.getHTML(), title }),
        });
        const { html } = await wrapRes.json();
        const r = await savePdfAs({ defaultName: `${safeName}.pdf`, fullHtml: html });
        if (r.ok) showToast("تم تصدير PDF", "success");
        else if (r.error) showToast(r.error, "error");
      } catch (err) {
        showToast(err.message || "فشل تصدير PDF", "error");
      }
      return;
    }

    // IMPORT — pick file, then show options dialog
    if (action === "import") {
      // Use the file picker just to get a path (binary formats are read on the
      // server side). For text formats we still read upfront so the renderer
      // can parse them locally (markdown/html/json).
      if (!window.electronAPI?.isElectron) {
        showToast("الاستيراد متاح فقط في تطبيق سطح المكتب.", "error");
        return;
      }
      const { canceled, filePaths } = await window.electronAPI.showOpenDialog({
        title: "اختر ملفاً للاستيراد",
        filters: [
          { name: "كل المدعومة", extensions: ["docx", "md", "markdown", "txt", "html", "htm", "json", "pdf"] },
          { name: "Word", extensions: ["docx"] },
          { name: "PDF", extensions: ["pdf"] },
          { name: "Markdown", extensions: ["md", "markdown"] },
          { name: "نص", extensions: ["txt"] },
          { name: "HTML", extensions: ["html", "htm"] },
          { name: "Backup (JSON)", extensions: ["json"] },
        ],
        properties: ["openFile"],
      });
      if (canceled || !filePaths?.length) return;
      const sourcePath = filePaths[0];
      const name = sourcePath.split(/[\\/]/).pop();
      const ext = (name.split(".").pop() || "").toLowerCase();
      let html = "";
      let warning = "";

      if (ext === "docx") {
        const r = await readDocxAsHtml(sourcePath, API_URL);
        if (!r.ok) { showToast(r.error, "error"); return; }
        html = r.html;
        if (r.warnings?.length) {
          warning = `بعض التنسيقات قد لا تظهر بدقة (${r.warnings.length} تنبيه).`;
        }
      } else if (ext === "pdf") {
        const r = await readPdfAsHtml(sourcePath, API_URL);
        if (!r.ok) { showToast(r.error, "error"); return; }
        html = r.html;
        warning = `استخراج النص من PDF قد ينتج تنسيقاً مشوّشاً (${r.pageCount} صفحة). يفضّل .docx أو .md للجودة الأفضل.`;
      } else {
        // Text formats — read content first.
        const readRes = await fetch(`${API_URL}/import/read-file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePath }),
        });
        if (!readRes.ok) {
          const err = await readRes.json().catch(() => ({}));
          showToast(err.error || "فشل قراءة الملف", "error");
          return;
        }
        const { content } = await readRes.json();

        if (ext === "json") {
          try {
            const json = JSON.parse(content);
            if (json._format === "aragon-write-backup") {
              const restore = await fetch(`${API_URL}/backup/import-project`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ json, target: "new" }),
              });
              const data = await restore.json();
              if (restore.ok) {
                showToast(`تم استيراد مشروع (${data.docCount} فصل)`, "success");
                await loadProjects();
                setIsHome(true);
              } else {
                showToast(data.error || "فشل الاستيراد", "error");
              }
              return;
            }
            // Not a backup JSON — treat as plain text
            html = `<p>${content.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;
          } catch {
            showToast("ملف JSON غير صالح", "error");
            return;
          }
        } else if (ext === "md" || ext === "markdown") {
          html = await mdToHtml(content, API_URL);
        } else if (ext === "txt") {
          const paras = content.split(/\n\s*\n/).map((p) =>
            `<p>${p.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`
          );
          html = paras.join("");
        } else if (ext === "html" || ext === "htm") {
          const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(content);
          html = m ? m[1] : content;
        } else {
          showToast(`صيغة غير مدعومة: .${ext}`, "error");
          return;
        }
      }

      // Word count for the dialog header (rough)
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const wordCount = (tmp.textContent || "").trim().split(/\s+/).filter(Boolean).length;

      setPendingImport({
        sourceName: name,
        wordCount,
        html,
        warning,
      });
      return;
    }

    // EXPORT PROJECT (JSON backup)
    if (action === "export-project") {
      if (!currentProjectId) return;
      try {
        await flushPendingProjectSaves();
        const res = await fetch(`${API_URL}/backup/export-project?id=${encodeURIComponent(currentProjectId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          showToast(err.error || "فشل تصدير المشروع", "error");
          return;
        }
        const data = await res.json();
        const json = JSON.stringify(data, null, 2);
        const projectSafeName = (currentProject?.title || "project").replace(/[\\/:*?"<>|]/g, "_");
        const r = await saveTextAs(
          {
            defaultName: `${projectSafeName}-backup.json`,
            ext: "json",
            label: "Aragon Backup",
            content: json,
          },
          API_URL,
        );
        if (r.ok) showToast(`تم تصدير ${data.docs?.length || 0} فصل`, "success");
        else if (r.error) showToast(r.error, "error");
      } catch (err) {
        showToast(err.message || "فشل التصدير", "error");
      }
      return;
    }
  }, [editor, currentDoc, currentProject, currentProjectId, showToast, loadProjects, flushPendingProjectSaves]);

  // Called when ImportDialog confirms with the chosen target.
  const confirmImport = useCallback(async ({ target, title: importTitle }) => {
    if (!pendingImport) return;
    const html = pendingImport.html;
    setPendingImport(null);

    if (target === "append" && editor) {
      // Append to current document by inserting at the end.
      editor.chain().focus().command(({ tr, dispatch }) => {
        if (dispatch) {
          const end = tr.doc.content.size;
          tr.insertText("\n", end);
        }
        return true;
      }).run();
      editor.commands.insertContentAt(editor.state.doc.content.size, html);
      showToast("تم الإلحاق", "success");
      return;
    }

    if (target === "new-doc" && projectMode) {
      // Create a new doc in current project, then load the imported content.
      const doc = {
        id: genId(),
        title: importTitle,
        content: html,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      try {
        const res = await fetch(`${API_URL}/fs/projects/${currentProjectId}/docs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(doc),
        });
        const saved = res.ok ? await res.json() : doc;
        if (!res.ok) {
          saveProjectDraft(currentProjectId, saved);
          setSaveStatus("error");
        }
        setDocuments((prev) => {
          const next = [...prev, saved];
          documentsRef.current = next;
          return next;
        });
        currentDocIdRef.current = saved.id;
        setCurrentDocId(saved.id);
        loadProjects();
        showToast(`تم استيراد ${importTitle}`, "success");
      } catch {
        showToast("فشل حفظ الفصل المستورد", "error");
      }
      return;
    }

    if (target === "new-project") {
      // Create a new project, then create a doc inside it.
      try {
        const projRes = await fetch(`${API_URL}/fs/projects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: importTitle }),
        });
        if (!projRes.ok) throw new Error("فشل إنشاء المشروع");
        const project = await projRes.json();
        const doc = {
          id: genId(),
          title: importTitle,
          content: html,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const docRes = await fetch(`${API_URL}/fs/projects/${project.id}/docs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(doc),
        });
        if (!docRes.ok) {
          saveProjectDraft(project.id, doc);
          setSaveStatus("error");
        }
        await loadProjects();
        openProject(project.id);
        showToast(`تم إنشاء «${importTitle}»`, "success");
      } catch (err) {
        showToast(err.message || "فشل الاستيراد", "error");
      }
      return;
    }
  }, [pendingImport, editor, projectMode, currentProjectId, openProject, loadProjects, showToast]);

  // Ensure at least one document exists (no-project mode, but only after leaving Home)
  useEffect(() => {
    if (!isHome && !projectMode && documents.length === 0) createDocument();
  }, [isHome]); // eslint-disable-line

  // Projects must always have a chapter to write into, otherwise typed text
  // has nowhere to be saved. Create one as soon as an empty project loads.
  useEffect(() => {
    if (isHome || !projectMode || loadedProjectId !== currentProjectId) return;
    if (documents.length > 0 || autoCreatedForRef.current === currentProjectId) return;
    autoCreatedForRef.current = currentProjectId;
    createDocument();
  }, [isHome, projectMode, loadedProjectId, currentProjectId, documents.length, createDocument]);

  // Theme cycle
  const themeIcon = settings.theme === "dark" ? <Sun size={16} /> : settings.theme === "sepia" ? <Palette size={16} /> : <Moon size={16} />;
  const cycleTheme = () => {
    const next = settings.theme === "light" ? "dark" : settings.theme === "dark" ? "sepia" : "light";
    updateSettings({ theme: next });
  };
  const themeNextLabel = settings.theme === "light" ? "داكن" : settings.theme === "dark" ? "عاجي" : "فاتح";

  if (isHome) {
    return (
      <div id="root">
        <Welcome ollamaStatus={ollamaStatus} apiUrl={API_URL} settings={settings} />
        <Home
          projects={projects}
          onOpenProject={openProject}
          onCreateProject={createProject}
          onQuickWrite={startQuickWrite}
          onDeleteProject={deleteProject}
          onOpenSettings={() => setIsSettingsOpen(true)}
          theme={settings.theme}
          onCycleTheme={cycleTheme}
          ollamaStatus={ollamaStatus}
          settings={settings}
        />
        {isSettingsOpen && (
          <Settings
            settings={settings}
            onUpdate={updateSettings}
            onClose={() => setIsSettingsOpen(false)}
            apiUrl={API_URL}
          />
        )}
        <Toast toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  return (
    <div id="root" className={isFocusMode ? "app-focus-mode" : ""}>
      <Welcome ollamaStatus={ollamaStatus} apiUrl={API_URL} settings={settings} />

      {isFocusMode && (
        <div className="focus-exit-hint">
          <span>F11 أو ESC — للخروج من وضع التركيز</span>
        </div>
      )}

      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar__identity" aria-label="أرغون رايت">
          <div className="topbar__logo-icon">أ</div>
          <span className="topbar__brand-name">أرغون</span>
        </div>

        <div className="topbar__document-zone">
          {/* Project breadcrumb — clicking goes back to Home */}
          {projectMode ? (
            <div className="topbar__breadcrumb">
              <button className="topbar__breadcrumb-btn" onClick={goHome} title="العودة للمكتبة" aria-label="العودة للمكتبة">
                <BookOpen size={14} />
                <span>{currentProject?.title || "..."}</span>
              </button>
              <ChevronLeft className="topbar__breadcrumb-separator" size={12} />
            </div>
          ) : (
            <button
              className="topbar__library-btn"
              onClick={goHome}
              title="العودة للمكتبة"
              aria-label="العودة للمكتبة"
            >
              <BookOpen size={14} />
              المكتبة
            </button>
          )}

          <DocSwitcher
            documents={documents}
            currentDoc={currentDoc}
            projectMode={projectMode}
            onOpen={openDocument}
            onCreate={createDocument}
            onOpenManager={() => setIsDocManagerOpen(true)}
            onUpdateTitle={updateDocTitle}
          />

          <FileMenu
            onAction={runFileAction}
            hasDoc={!!currentDoc}
            hasProject={!!currentProjectId}
            showDocx={true}
          />
        </div>

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          <button className={`btn-ai${isAIPanelOpen ? " active" : ""}`} onClick={() => setIsAIPanelOpen((v) => !v)} title="مساعد الكتابة الذكي (Ctrl+K)">
            <Sparkles size={15} /><span className="btn-ai__label">المساعد</span>
          </button>

          {/* Zoom */}
          <div className="zoom-control">
            <button className="btn-icon zoom-control__button" onClick={() => updateSettings({ zoom: Math.max(50, settings.zoom - 10) })} title="تصغير" aria-label="تصغير"><ZoomOut size={13} /></button>
            <button className="zoom-control__value" onClick={() => updateSettings({ zoom: 100 })} title="إعادة التكبير إلى 100%">{settings.zoom}%</button>
            <button className="btn-icon zoom-control__button" onClick={() => updateSettings({ zoom: Math.min(250, settings.zoom + 10) })} title="تكبير" aria-label="تكبير"><ZoomIn size={13} /></button>
          </div>

          <button className={`btn-icon${isOutlineOpen ? " active" : ""}`} onClick={() => setIsOutlineOpen((v) => !v)} title="جدول المحتويات" aria-label="جدول المحتويات"><AlignJustify size={16} /></button>
          <button className="btn-icon" onClick={() => setIsDocManagerOpen(true)} title={projectMode ? "فصول المشروع" : "المستندات"} aria-label={projectMode ? "فصول المشروع" : "المستندات"}><FolderOpen size={16} /></button>
          <button className="btn-icon" onClick={cycleTheme} title={`التالي: ${themeNextLabel}`} aria-label={`تبديل المظهر — التالي: ${themeNextLabel}`}>{themeIcon}</button>
          <button className={`btn-icon${isFocusMode ? " active" : ""}`} onClick={() => setIsFocusMode((v) => !v)} title={isFocusMode ? "الخروج (F11)" : "وضع التركيز (F11)"} aria-label={isFocusMode ? "الخروج من وضع التركيز" : "وضع التركيز"}>{isFocusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="btn-icon" onClick={() => setIsSettingsOpen(true)} title="الإعدادات" aria-label="الإعدادات"><SettingsIcon size={16} /></button>
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
        model={settings.provider === "openai_compat" ? settings.apiModel : settings.model}
        settings={settings}
        docCount={documents.length}
        saveStatus={saveStatus}
        sessionWords={sessionWords}
        writingGoal={settings.writingGoal || 0}
        onStartOllama={startOllama}
        onKillOllama={killOllama}
        ollamaAction={ollamaAction}
      />

      <Toast toasts={toasts} onDismiss={dismissToast} />

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

      {pendingImport && (
        <ImportDialog
          sourceName={pendingImport.sourceName}
          wordCount={pendingImport.wordCount}
          projectMode={projectMode}
          currentDocTitle={currentDoc?.title}
          warning={pendingImport.warning}
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  );
}
