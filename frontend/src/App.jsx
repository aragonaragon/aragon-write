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
import { createStorage } from "./lib/storage";
import { isNativeIOS, NativeSecrets } from "./lib/native";
import {
  nativeSpeechAvailable,
  onSpeechEvent,
  startSpeechRecognition,
  stopSpeechRecognition,
} from "./lib/speech";
import {
  PenLine, FolderOpen, Settings as SettingsIcon, Sun, Moon, Sparkles,
  AlignJustify, ZoomIn, ZoomOut, Maximize2, Minimize2, Palette,
  BookOpen, ChevronLeft, Mic, Square,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:3001";
const storage = createStorage(API_URL);
const AUTOSAVE_DELAY = 1500;
// Hard ceiling: while typing continuously the debounce above never fires, so
// force a write at least this often to bound what a crash or force-quit loses.
const AUTOSAVE_MAX_INTERVAL = 10000;
const AUTOSAVE_RETRY_DELAY = 5000;
const ARABIC_WORD_REGEX = /[\p{Script=Arabic}]+/gu;
const SPELLCHECK_DEBOUNCE_MS = 800;

const DEFAULT_SETTINGS = {
  ollamaUrl: "http://localhost:11434",
  model: "gemma4:e4b",
  theme: "light",
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
function saveSettings(s) {
  const stored = { ...s };
  if (window.electronAPI?.setSecret || isNativeIOS) {
    delete stored.apiKey;
  }
  localStorage.setItem("aragon-write-settings", JSON.stringify(stored));
}

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
  const [saveStatus, setSaveStatus] = useState("saved"); // "dirty" | "saving" | "saved" | "error"
  const [dictation, setDictation] = useState({ state: "idle", onDevice: null });
  const [storageStatus, setStorageStatus] = useState({ mode: isNativeIOS ? "checking" : "local", iCloud: false });

  const paperRef = useRef(null);
  const editorStageRef = useRef(null);
  const cacheRef = useRef(new Map());
  const pendingWordsRef = useRef(new Set());
  const debounceRef = useRef(null);
  const autosaveRef = useRef(null);
  const autosaveMaxRef = useRef(null);
  const dirtyRef = useRef(null); // { projId, docId, base } of unsaved editor edits
  const editorRef = useRef(null);
  const persistDocumentRef = useRef(async () => false);
  const titleDebounceRef = useRef(null);
  const destroyedRef = useRef(false);
  const sessionStartWordsRef = useRef(null);
  const settingsRef = useRef(settings);
  const currentProjectIdRef = useRef(currentProjectId);
  const currentDocIdRef = useRef(currentDocId);
  const documentsRef = useRef(documents);
  const dictationRef = useRef(dictation);
  const dictationRangeRef = useRef(null);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { currentProjectIdRef.current = currentProjectId; }, [currentProjectId]);
  useEffect(() => { currentDocIdRef.current = currentDocId; }, [currentDocId]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { dictationRef.current = dictation; }, [dictation]);

  // On macOS, migrate any legacy plaintext API key into Electron's encrypted
  // safe storage and hydrate it back into memory for the current session.
  // Do not touch Keychain for the normal local-writing/Ollama path: unsigned
  // development builds can otherwise trigger a macOS password prompt at launch.
  useEffect(() => {
    if (!window.electronAPI?.getSecret) return;
    if (settings.provider !== "openai_compat") return;
    let cancelled = false;
    const legacyKey = settingsRef.current.apiKey || "";
    const hasSecuredKey = localStorage.getItem("aragon-write-secret-stored") === "1";
    (async () => {
      if (legacyKey) {
        await window.electronAPI.setSecret("external-api-key", legacyKey);
        localStorage.setItem("aragon-write-secret-stored", "1");
        saveSettings({ ...settingsRef.current, apiKey: legacyKey });
      }
      if (!legacyKey && !hasSecuredKey) return;
      const securedKey = await window.electronAPI.getSecret("external-api-key");
      if (!cancelled && securedKey) {
        setSettings((current) => ({ ...current, apiKey: securedKey }));
      }
    })();
    return () => { cancelled = true; };
  }, [settings.provider]);

  // iPad has no local Ollama/backend. Keep the full assistant available through
  // an OpenAI-compatible provider and keep its API key in the native Keychain.
  useEffect(() => {
    if (!isNativeIOS) return;
    let cancelled = false;
    (async () => {
      const stored = await NativeSecrets.get({ key: "external-api-key" }).catch(() => ({ value: "" }));
      if (cancelled) return;
      setSettings((current) => {
        const next = { ...current, provider: "openai_compat", apiKey: stored.value || current.apiKey || "" };
        saveSettings(next);
        return next;
      });
    })();
    return () => { cancelled = true; };
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
    if (isNativeIOS) {
      setOllamaStatus("unavailable");
      return undefined;
    }
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
      const list = await storage.listProjects();
      setProjects(list);
      return list;
    } catch {}
    return [];
  }, []);

  useEffect(() => {
    loadProjects();
    storage.status?.().then(setStorageStatus).catch(() => {
      setStorageStatus({ mode: "local", iCloud: false });
    });
    // No auto-select: the user chooses from the Home screen explicitly.
  }, []); // eslint-disable-line

  // ── Load project docs when project changes ──
  const loadProjectDocs = useCallback(async (projectId) => {
    try {
      let docs = await storage.listDocuments(projectId);
      if (docs.length === 0) {
        const now = new Date().toISOString();
        const firstDocument = await storage.createDocument(projectId, {
          id: genId(),
          title: "الفصل الأول",
          content: "<p></p>",
          createdAt: now,
          updatedAt: now,
        });
        docs = [firstDocument];
        loadProjects();
      }
      setDocuments(docs);
      setCurrentDocId(docs.length > 0 ? docs[0].id : null);
      sessionStartWordsRef.current = null;
      setSessionWords(0);
      return docs;
    } catch {}
    return [];
  }, [loadProjects]);

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

  // ── Toast ──
  const showToast = useCallback((message, type = "info", duration = 4000) => {
    const id = genId();
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

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
        setSaveStatus("dirty");
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

        // Autosave: debounce after the last keystroke, plus a max-interval
        // timer so continuous typing still reaches disk every few seconds.
        const docId = currentDocIdRef.current;
        if (docId) {
          dirtyRef.current = {
            projId: currentProjectIdRef.current,
            docId,
            base: documentsRef.current.find((d) => d.id === docId) || dirtyRef.current?.base,
          };
          if (autosaveRef.current) clearTimeout(autosaveRef.current);
          autosaveRef.current = setTimeout(() => persistDocumentRef.current(), AUTOSAVE_DELAY);
          if (!autosaveMaxRef.current) {
            autosaveMaxRef.current = setTimeout(() => persistDocumentRef.current(), AUTOSAVE_MAX_INTERVAL);
          }
        }
      }
    },
    onSelectionUpdate: () => setContextMenu(null),
    immediatelyRender: false,
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  // The single persistence path for editor content. Used by the debounce and
  // max-interval timers, window blur/hide, Cmd+S, document switches, and app
  // close. Without arguments it saves whatever dirtyRef points at.
  const persistDocument = useCallback(async ({ docId, projId, html } = {}) => {
    const target = dirtyRef.current;
    const id = docId ?? target?.docId;
    if (!id) return false;
    const pid = projId !== undefined ? projId : (target?.projId ?? currentProjectIdRef.current);
    const content = html ?? editorRef.current?.getHTML();
    if (typeof content !== "string") return false;

    if (autosaveRef.current) { clearTimeout(autosaveRef.current); autosaveRef.current = null; }
    if (autosaveMaxRef.current) { clearTimeout(autosaveMaxRef.current); autosaveMaxRef.current = null; }
    if (target && target.docId === id) dirtyRef.current = null;

    const inState = documentsRef.current.find((d) => d.id === id);
    const localList = pid ? null : loadDocuments();
    const base = inState || (target?.docId === id ? target.base : null) || localList?.find((d) => d.id === id);
    if (!base) return false;
    const doc = { ...base, content, updatedAt: new Date().toISOString() };

    setDocuments((prev) => (prev.some((d) => d.id === id) ? prev.map((d) => (d.id === id ? doc : d)) : prev));

    try {
      if (pid) {
        setSaveStatus("saving");
        await storage.saveDocument(pid, doc);
      } else {
        const source = inState ? documentsRef.current : (localList || []);
        const list = source.some((d) => d.id === id) ? source.map((d) => (d.id === id ? doc : d)) : [doc, ...source];
        saveDocuments(list);
      }
      if (!dirtyRef.current) setSaveStatus("saved");
      return true;
    } catch {
      // Keep the edits marked dirty and retry shortly; the text is still in
      // the editor, so nothing is lost while the window stays open.
      if (!dirtyRef.current) dirtyRef.current = { projId: pid, docId: id, base: doc };
      if (!autosaveRef.current) {
        autosaveRef.current = setTimeout(() => persistDocumentRef.current(), AUTOSAVE_RETRY_DELAY);
      }
      setSaveStatus("error");
      showToast("تعذّر الحفظ — احتفظ بالنافذة مفتوحة وحاول مجدداً", "error");
      return false;
    }
  }, [showToast]);
  useEffect(() => { persistDocumentRef.current = persistDocument; }, [persistDocument]);

  // Save when the window loses focus or is hidden (app switch, Cmd+H, sleep),
  // and on Cmd/Ctrl+S from the keyboard or the macOS menu.
  useEffect(() => {
    const flushIfDirty = () => { if (dirtyRef.current) persistDocument(); };
    const saveNow = () => persistDocument({ docId: currentDocIdRef.current, projId: currentProjectIdRef.current });
    const onVisibility = () => { if (document.visibilityState === "hidden") flushIfDirty(); };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.code === "KeyS" || e.key.toLowerCase() === "s")) {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("blur", flushIfDirty);
    window.addEventListener("pagehide", flushIfDirty);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("keydown", onKey);
    const offMenu = window.electronAPI?.onSaveShortcut?.(saveNow);
    return () => {
      window.removeEventListener("blur", flushIfDirty);
      window.removeEventListener("pagehide", flushIfDirty);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("keydown", onKey);
      offMenu?.();
    };
  }, [persistDocument]);

  const replaceDictationText = useCallback((text, isFinal = false) => {
    if (!editor || editor.isDestroyed || !dictationRangeRef.current) return;
    const range = dictationRangeRef.current;
    const value = `${text}${isFinal && text ? " " : ""}`;
    const maxPosition = editor.state.doc.content.size;
    const from = Math.min(range.from, maxPosition);
    const to = Math.min(range.to, maxPosition);
    const transaction = editor.state.tr.insertText(value, from, to);
    editor.view.dispatch(transaction);
    dictationRangeRef.current = { from, to: from + value.length };
  }, [editor]);

  const startDictation = useCallback(async () => {
    if (!editor || !nativeSpeechAvailable) {
      showToast("الإملاء العربي يحتاج نسخة macOS أو iPad الأصلية", "info");
      return;
    }
    if (dictationRef.current.state !== "idle") {
      setDictation((current) => ({ ...current, state: "stopping" }));
      await stopSpeechRecognition();
      return;
    }

    editor.commands.focus();
    const { from, to } = editor.state.selection;
    dictationRangeRef.current = { from, to };
    setDictation({ state: "requesting", onDevice: null });
    const result = await startSpeechRecognition();
    if (!result?.ok) {
      dictationRangeRef.current = null;
      setDictation({ state: "idle", onDevice: null });
      showToast(result?.error || "تعذّر تشغيل الإملاء العربي", "error");
    }
  }, [editor, showToast]);

  useEffect(() => {
    if (!nativeSpeechAvailable) return undefined;
    return onSpeechEvent((event) => {
      if (!event?.type) return;
      if (event.type === "ready") {
        setDictation({ state: "listening", onDevice: !!event.onDevice });
      } else if (event.type === "partial") {
        replaceDictationText(event.text || "", false);
      } else if (event.type === "final") {
        replaceDictationText(event.text || "", true);
      } else if (event.type === "error") {
        showToast(event.message || "تعذّر الإملاء العربي", "error", 6000);
        setDictation({ state: "idle", onDevice: null });
        dictationRangeRef.current = null;
      } else if (event.type === "stopped") {
        setDictation({ state: "idle", onDevice: null });
        dictationRangeRef.current = null;
        editor?.commands.focus();
      }
    });
  }, [editor, replaceDictationText, showToast]);

  useEffect(() => {
    if (!window.electronAPI?.onSpeechToggleShortcut) return undefined;
    return window.electronAPI.onSpeechToggleShortcut(startDictation);
  }, [startDictation]);

  // Electron asks the renderer to flush the newest editor state before the
  // window closes. This protects the final keystrokes that may still be inside
  // the autosave debounce window.
  useEffect(() => {
    if (!editor || !window.electronAPI?.onBeforeClose) return undefined;
    return window.electronAPI.onBeforeClose(async () => {
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      const docId = currentDocIdRef.current;
      try {
        if (docId) {
          await persistDocument({ docId, projId: currentProjectIdRef.current, html: editor.getHTML() });
        }
      } finally {
        window.electronAPI.readyToClose();
      }
    });
  }, [editor, persistDocument]);

  // Load doc content when switching
  useEffect(() => {
    if (!editor) return;
    // Flush edits that belong to the document we are leaving before its text
    // is replaced in the editor; otherwise the last keystrokes typed right
    // before a chapter switch would exist only in memory.
    const pending = dirtyRef.current;
    if (pending && pending.docId !== currentDocId) {
      persistDocument({ docId: pending.docId, projId: pending.projId, html: editor.getHTML() });
    }
    if (currentDoc) {
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
      if (autosaveMaxRef.current) clearTimeout(autosaveMaxRef.current);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const toggleAIAssistant = useCallback(() => {
    if (isNativeIOS && (!settings.apiBaseUrl || !settings.apiKey || !settings.apiModel)) {
      setIsAIPanelOpen(false);
      setIsSettingsOpen(true);
      return;
    }
    setIsAIPanelOpen((value) => !value);
  }, [settings.apiBaseUrl, settings.apiKey, settings.apiModel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "F11") { e.preventDefault(); setIsFocusMode((v) => !v); }
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setIsFocusMode((v) => !v); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); startDictation(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); toggleAIAssistant(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [startDictation, toggleAIAssistant]);

  // ── Project management ──
  const createProject = useCallback(async (title) => {
    try {
      const project = await storage.createProject(title);
      setProjects((prev) => [project, ...prev]);
      setCurrentProjectId(project.id);
      setIsProjectManagerOpen(false);
      setIsHome(false);
    } catch {}
  }, []);

  const openProject = useCallback((id) => {
    setCurrentProjectId(id);
    setIsProjectManagerOpen(false);
    setIsHome(false);
  }, []);

  const startQuickWrite = useCallback(() => {
    setCurrentProjectId(null);
    setIsHome(false);
  }, []);

  const goHome = useCallback(() => {
    setIsHome(true);
  }, []);

  const deleteProject = useCallback(async (id) => {
    try {
      await storage.deleteProject(id);
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
        const saved = await storage.createDocument(currentProjectId, doc);
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
        await storage.deleteDocument(currentProjectId, id);
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
    setSaveStatus("dirty");
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
          storage.saveDocument(currentProjectIdRef.current, { ...doc, title }).then(() => {
            setSaveStatus("saved");
          }).catch(() => {
            setSaveStatus("error");
            showToast("فشل حفظ العنوان", "error");
          });
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
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      if (Object.prototype.hasOwnProperty.call(updates, "apiKey") && window.electronAPI?.setSecret) {
        window.electronAPI.setSecret("external-api-key", updates.apiKey || "").then((result) => {
          if (result?.ok && updates.apiKey) localStorage.setItem("aragon-write-secret-stored", "1");
          if (result?.ok && !updates.apiKey) localStorage.removeItem("aragon-write-secret-stored");
        });
      }
      if (Object.prototype.hasOwnProperty.call(updates, "apiKey") && isNativeIOS) {
        NativeSecrets.set({ key: "external-api-key", value: updates.apiKey || "" }).catch(() => {});
      }
      saveSettings(next);
      return next;
    });
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
              try {
                const data = await storage.importProject(json);
                showToast(`تم استيراد مشروع (${data.docCount} فصل)`, "success");
                await loadProjects();
                setIsHome(true);
              } catch (error) {
                showToast(error.message || "فشل الاستيراد", "error");
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
        const data = await storage.exportProject(currentProjectId);
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
  }, [editor, currentDoc, currentProject, currentProjectId, showToast, loadProjects]);

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
        const saved = await storage.createDocument(currentProjectId, doc);
        setDocuments((prev) => [...prev, saved]);
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
        const project = await storage.createProject(importTitle);
        const doc = {
          id: genId(),
          title: importTitle,
          content: html,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await storage.createDocument(project.id, doc);
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
          storageStatus={storageStatus}
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
          <span>⌘⇧F أو ESC — للخروج من وضع التركيز</span>
        </div>
      )}

      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar__logo">
          <div className="topbar__logo-icon">أ</div>
        </div>

        {/* Project breadcrumb — clicking goes back to Home */}
        {projectMode ? (
          <div className="topbar__breadcrumb">
            <button className="topbar__breadcrumb-btn" onClick={goHome} title="العودة للمكتبة">
              <BookOpen size={14} />
              <span>{currentProject?.title || "..."}</span>
            </button>
            <ChevronLeft size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          </div>
        ) : (
          <button
            className="topbar__library-btn"
            onClick={goHome}
            title="العودة للمكتبة"
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

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          <button
            className={`btn-dictation btn-dictation--${dictation.state}`}
            onClick={startDictation}
            aria-pressed={dictation.state !== "idle"}
            title={dictation.state === "idle" ? "إملاء عربي (⌘⇧D)" : "إيقاف الإملاء (⌘⇧D)"}
          >
            {dictation.state === "idle" ? <Mic size={15} /> : <Square size={13} fill="currentColor" />}
            <span>{dictation.state === "idle" ? "إملاء" : dictation.state === "listening" ? "أستمع…" : "لحظة…"}</span>
          </button>

          <button className="btn-ai" onClick={toggleAIAssistant} title="مساعد الكتابة الذكي (⌘K)">
            <Sparkles size={15} />مساعد AI
          </button>

          {/* Zoom */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--bg)", borderRadius: "var(--radius-md)", padding: "2px 4px", border: "1px solid var(--border)", direction: "ltr" }}>
            <button className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => updateSettings({ zoom: Math.max(50, settings.zoom - 10) })} title="تصغير"><ZoomOut size={13} /></button>
            <span style={{ fontSize: 12, minWidth: 36, textAlign: "center", color: "var(--text-secondary)", cursor: "pointer", userSelect: "none" }} onClick={() => updateSettings({ zoom: 100 })} title="100%">{settings.zoom}%</span>
            <button className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => updateSettings({ zoom: Math.min(250, settings.zoom + 10) })} title="تكبير"><ZoomIn size={13} /></button>
          </div>

          <button className="btn-icon" onClick={() => setIsOutlineOpen((v) => !v)} title="جدول المحتويات"><AlignJustify size={16} /></button>
          <button className="btn-icon" onClick={() => setIsDocManagerOpen(true)} title={projectMode ? "فصول المشروع" : "المستندات"}><FolderOpen size={16} /></button>
          <button className="btn-icon" onClick={cycleTheme} title={`التالي: ${themeNextLabel}`}>{themeIcon}</button>
          <button className={`btn-icon${isFocusMode ? " active" : ""}`} onClick={() => setIsFocusMode((v) => !v)} title={isFocusMode ? "الخروج (⌘⇧F)" : "وضع التركيز (⌘⇧F)"}>{isFocusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          <button className="btn-icon" onClick={() => setIsSettingsOpen(true)} title="الإعدادات"><SettingsIcon size={16} /></button>
        </div>
      </header>

      <Toolbar editor={editor} />

      <div className="editor-layout">
        <OutlineSidebar editor={editor} isOpen={isOutlineOpen} />

        <main className="editor-stage" ref={editorStageRef}>
          {dictation.state !== "idle" && (
            <div className="dictation-indicator" role="status" aria-live="polite">
              <span className={`dictation-indicator__dot${dictation.state === "listening" ? " is-live" : ""}`} />
              <strong>{dictation.state === "listening" ? "الإملاء العربي يعمل" : dictation.state === "stopping" ? "جارٍ إنهاء الإملاء…" : "جارٍ تجهيز الميكروفون…"}</strong>
              {dictation.state === "listening" && (
                <span>{dictation.onDevice ? "المعالجة على هذا الجهاز" : "المعالجة عبر خدمة Apple"}</span>
              )}
            </div>
          )}
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
        sessionWords={sessionWords}
        writingGoal={settings.writingGoal || 0}
        onStartOllama={startOllama}
        onKillOllama={killOllama}
        ollamaAction={ollamaAction}
        saveStatus={saveStatus}
        storageStatus={storageStatus}
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
