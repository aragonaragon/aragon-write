import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Sparkles, RefreshCw, Minimize2, Maximize2,
  ArrowRight, Languages, CheckCircle, Lightbulb,
  FileText, Type, Send, Copy, Check, PenLine,
  ChevronLeft, Video,
} from "lucide-react";

// Strip leftover Markdown artifacts from model output (some models keep emitting
// `**bold**`, `### headers`, and `---` dividers despite the system prompt)
function cleanMarkdown(text) {
  if (!text) return text;
  return text
    // Headers: ###, ##, # at line start → drop the hashes
    .replace(/^#{1,6}\s+/gm, "")
    // Bold/italic markers: **text** or __text__ → text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    // Single * or _ around text (italic) — only when paired around non-space
    .replace(/(^|[\s(])\*(\S[^*]*?\S)\*(?=[\s.,!?:;)]|$)/g, "$1$2")
    .replace(/(^|[\s(])_(\S[^_]*?\S)_(?=[\s.,!?:;)]|$)/g, "$1$2")
    // Horizontal rules: --- or *** or ___ on their own line
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, "")
    // Inline code: `text` → text
    .replace(/`([^`]+)`/g, "$1")
    // Bullet markers at line start (* or -) → keep as plain dash
    .replace(/^\s*\*\s+/gm, "- ")
    // Trim excessive blank lines (more than 2 consecutive → 2)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUICK_ACTIONS = [
  { id: "rewrite", label: "إعادة صياغة", icon: RefreshCw, requiresSelection: true },
  { id: "improve", label: "تحسين الأسلوب", icon: Sparkles, requiresSelection: true },
  { id: "shorter", label: "اختصار", icon: Minimize2, requiresSelection: true },
  { id: "longer", label: "إطالة", icon: Maximize2, requiresSelection: true },
  { id: "continue", label: "استكمال", icon: ArrowRight, requiresSelection: true },
  { id: "fix_grammar", label: "تصحيح إملائي", icon: CheckCircle, requiresSelection: true },
  { id: "translate_en", label: "ترجمة للإنجليزية", icon: Languages, requiresSelection: true },
  { id: "translate_ar", label: "ترجمة للعربية", icon: Languages, requiresSelection: false },
  { id: "ideas", label: "أفكار ومقترحات", icon: Lightbulb, requiresSelection: false },
  { id: "outline", label: "اقتراح مخطط", icon: FileText, requiresSelection: false },
  { id: "titles", label: "اقتراح عناوين", icon: Type, requiresSelection: false },
  { id: "youtube_script", label: "سكربت يوتيوب", icon: Video, requiresSelection: false },
];

// Turn low-level network errors into something a writer can act on.
function friendlyError(message) {
  const m = String(message || "");
  if (/fetch failed|ECONNREFUSED|Failed to fetch|NetworkError/i.test(m)) {
    return "تعذّر الوصول إلى المساعد. تأكد أن Ollama يعمل (أو أن إعدادات API صحيحة) ثم أعد المحاولة.";
  }
  if (/model .* not found|no such model/i.test(m)) {
    return "الموديل غير موجود. حمّله من الإعدادات أو اختر موديلاً آخر.";
  }
  return m || "حدث خطأ";
}

function useStream(apiUrl) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const run = useCallback(async (body) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setText("");
    setError(null);
    setStreaming(true);

    try {
      const res = await fetch(`${apiUrl}/ai/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل الاتصال");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === "[DONE]") break;
          try {
            const data = JSON.parse(raw);
            if (data.error) throw new Error(data.error);
            if (data.text) setText((prev) => prev + data.text);
          } catch (parseErr) {
            if (parseErr.message !== "Unexpected token D in JSON") {
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(friendlyError(err.message));
      }
    } finally {
      setStreaming(false);
    }
  }, [apiUrl]);

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setStreaming(false);
  }, []);

  const clear = useCallback(() => {
    setText("");
    setError(null);
  }, []);

  return { text, streaming, error, run, stop, clear };
}

export default function AIPanel({ editor, isOpen, onClose, settings, apiUrl }) {
  const [tab, setTab] = useState("actions"); // "actions" | "chat"
  const [instruction, setInstruction] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedChatIdx, setCopiedChatIdx] = useState(null);
  const [addedChatIdx, setAddedChatIdx] = useState(null);
  const chatEndRef = useRef(null);

  const { text: result, streaming, error, run, stop, clear } = useStream(apiUrl);

  const getSelectionOrDoc = () => {
    if (!editor) return { selected: "", full: "" };
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, " ");
    const full = editor.getText();
    return { selected, full };
  };

  // Resolve which model + provider to pass to the backend, based on current settings.
  // Ollama mode uses the local model name; external mode uses the API model + providerConfig.
  const resolveProvider = () => {
    if (settings.provider === "openai_compat") {
      return {
        model: settings.apiModel,
        providerConfig: {
          type: "openai_compat",
          baseUrl: settings.apiBaseUrl,
          apiKey: settings.apiKey,
        },
      };
    }
    return { model: settings.model, providerConfig: null };
  };

  const runAction = async (actionId) => {
    if (!editor) return;
    const { selected, full } = getSelectionOrDoc();
    const text = selected || full;
    if (!text.trim()) return;

    clear();
    await run({
      action: actionId,
      text,
      instruction,
      ...resolveProvider(),
    });
  };

  const insertResult = () => {
    if (!editor || !result) return;
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    if (hasSelection) {
      editor.chain().focus().deleteSelection().insertContent(result).run();
    } else {
      editor.chain().focus().insertContent(result).run();
    }
    clear();
  };

  const appendResult = () => {
    if (!editor || !result) return;
    editor.chain().focus().command(({ tr, dispatch }) => {
      if (dispatch) {
        const end = tr.doc.content.size;
        tr.insertText("\n" + result, end);
      }
      return true;
    }).run();
    clear();
  };

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const appendChatToDoc = (content, idx) => {
    if (!editor || !content) return;
    editor.chain().focus().command(({ tr, dispatch }) => {
      if (dispatch) {
        const end = tr.doc.content.size;
        tr.insertText("\n" + content, end);
      }
      return true;
    }).run();
    setAddedChatIdx(idx);
    setTimeout(() => setAddedChatIdx(null), 1500);
  };

  const copyChatMessage = async (content, idx) => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopiedChatIdx(idx);
    setTimeout(() => setCopiedChatIdx(null), 1500);
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const message = chatInput.trim();
    const docContent = editor ? editor.getText() : "";
    setChatInput("");
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: message },
      { role: "assistant", content: "__streaming__" },
    ]);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    await run({
      action: "chat",
      text: message,
      instruction: message,
      docContent,
      ...resolveProvider(),
    });
  };

  // When streaming ends, replace __streaming__ message with actual result
  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming && result && tab === "chat") {
      setChatMessages((prev) =>
        prev.map((m) => (m.content === "__streaming__" ? { ...m, content: result } : m))
      );
      clear();
    }
  }, [streaming, result, tab, clear]);

  if (!isOpen) return null;

  const { selected } = getSelectionOrDoc();
  const hasSelection = selected.trim().length > 0;

  return (
    <aside className={`ai-panel${isOpen ? "" : " closed"}`}>
      {/* Header */}
      <div className="ai-panel__header">
        <div className="ai-panel__title">
          <Sparkles size={16} />
          مساعد الكتابة
        </div>
        <button className="btn-icon" onClick={onClose} title="إغلاق" aria-label="إغلاق المساعد">
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="ai-tabs">
        <button
          className={`ai-tab${tab === "actions" ? " active" : ""}`}
          onClick={() => setTab("actions")}
        >
          إجراءات سريعة
        </button>
        <button
          className={`ai-tab${tab === "chat" ? " active" : ""}`}
          onClick={() => setTab("chat")}
        >
          محادثة
        </button>
      </div>

      {/* Body */}
      <div className="ai-panel__body">
        {tab === "actions" && (
          <>
            {/* Selected text preview */}
            {hasSelection && (
              <div>
                <div className="ai-section-label">النص المحدد</div>
                <div className="ai-selected-text">{selected}</div>
              </div>
            )}

            {/* Optional instruction */}
            <div>
              <div className="ai-section-label">تعليمات إضافية (اختياري)</div>
              <input
                className="ai-instruction"
                placeholder="مثال: اجعله أكثر رسمية..."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>

            {/* Action buttons */}
            <div>
              <div className="ai-section-label">اختر الإجراء</div>
              <div className="ai-actions-grid">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  const isDisabled = streaming || (action.requiresSelection && !hasSelection && !editor?.getText().trim());
                  return (
                    <button
                      key={action.id}
                      className={`ai-action-btn${streaming ? " loading" : ""}`}
                      onClick={() => runAction(action.id)}
                      disabled={isDisabled}
                      title={action.requiresSelection ? "يتطلب نصاً محدداً أو محتوى في المستند" : ""}
                    >
                      <Icon size={13} />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Result */}
            {(result || streaming || error) && (
              <div>
                <div className="ai-section-label">
                  النتيجة {streaming && <span className="ai-spinner" />}
                </div>

                {error && (
                  <div className="ai-error">
                    ⚠ {error}
                  </div>
                )}

                {(result || streaming) && (
                  <>
                    <div className="ai-result">
                      {result}
                      {streaming && <span className="ai-streaming">▋</span>}
                    </div>
                    {!streaming && result && (
                      <div className="ai-result-actions">
                        <button className="btn-sm primary" onClick={insertResult} title="استبدل النص المحدد أو أدرج في المكان الحالي">
                          <PenLine size={12} />
                          إدراج
                        </button>
                        <button className="btn-sm" onClick={appendResult} title="أضف في نهاية المستند">
                          إضافة
                        </button>
                        <button className="btn-sm" onClick={copyResult}>
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                          {copied ? "تم" : "نسخ"}
                        </button>
                        <button className="btn-sm" onClick={clear}>
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    {streaming && (
                      <button
                        className="btn-sm btn-sm--full"
                        onClick={stop}
                      >
                        إيقاف
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {tab === "chat" && (
          <div className="ai-chat">
            {chatMessages.length === 0 && (
              <div className="outline-empty">
                <Sparkles size={24} className="ai-chat__empty-icon" />
                اسأل عن أي شي — معلومة، فكرة، أو مساعدة في مستندك
              </div>
            )}
            <div className="ai-chat__messages">
              {chatMessages.map((msg, i) => {
                const isStreaming = msg.content === "__streaming__";
                const rawContent = isStreaming ? result : msg.content;
                const displayContent = msg.role === "assistant" ? cleanMarkdown(rawContent) : rawContent;
                const showActions = msg.role === "assistant" && !isStreaming && msg.content;
                return (
                  <div key={i} className={`chat-message ${msg.role}${isStreaming ? " streaming" : ""}`}>
                    {isStreaming
                      ? (displayContent || <span className="ai-spinner" />)
                      : displayContent}
                    {showActions && (
                      <div className="chat-message__actions">
                        <button
                          className="btn-sm"
                          onClick={() => appendChatToDoc(displayContent, i)}
                          disabled={!editor}
                          title="أضف في نهاية المستند"
                        >
                          {addedChatIdx === i ? <Check size={11} /> : <PenLine size={11} />}
                          {addedChatIdx === i ? "أُضيف" : "أضف للمستند"}
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => copyChatMessage(displayContent, i)}
                          title="نسخ"
                        >
                          {copiedChatIdx === i ? <Check size={11} /> : <Copy size={11} />}
                          {copiedChatIdx === i ? "تم" : "نسخ"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            <div className="ai-chat__input-area">
              <textarea
                className="ai-chat__input"
                placeholder="اكتب سؤالك هنا..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                rows={1}
                disabled={streaming}
              />
              <button
                className="ai-chat__send"
                onClick={sendChat}
                disabled={!chatInput.trim() || streaming}
                title="إرسال (Enter)"
              >
                {streaming
                  ? <span className="ai-spinner" />
                  : <ChevronLeft size={16} />
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
