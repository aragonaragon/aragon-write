/**
 * File I/O helpers — glue between Electron's preload (native dialogs / PDF)
 * and the backend's read/write endpoints (text + binary).
 *
 * In browser dev mode (no Electron), Save As falls back to a blob download
 * and Import is unavailable (you can't read arbitrary disk paths from a
 * browser sandbox — that's by design).
 */

const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;

// ─── Save As ─────────────────────────────────────────────────────────────────

function browserDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Pick a save location via the OS dialog (Electron) and write the given
 * text content. Falls back to a browser download in dev mode.
 *
 * @param {object} opts
 * @param {string} opts.defaultName - Suggested filename, e.g. "chapter1.md"
 * @param {string} opts.ext - File extension WITHOUT dot, e.g. "md"
 * @param {string} opts.label - Human-readable filter label, e.g. "Markdown"
 * @param {string} opts.content - The text to write (utf-8)
 * @param {string} apiUrl - Backend base URL (passed by caller)
 * @returns {Promise<{ok: boolean, path?: string, canceled?: boolean, error?: string}>}
 */
export async function saveTextAs({ defaultName, ext, label, content }, apiUrl) {
  if (!isElectron) {
    browserDownload(defaultName, content, "text/plain;charset=utf-8");
    return { ok: true, canceled: false };
  }
  const { canceled, filePath } = await window.electronAPI.showSaveDialog({
    title: "حفظ باسم",
    defaultPath: defaultName,
    filters: [{ name: label, extensions: [ext] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const res = await fetch(`${apiUrl}/export/write-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ savePath: filePath, content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || "فشل حفظ الملف" };
  }
  return { ok: true, path: filePath };
}

/**
 * Save the current HTML as a standalone .html document (RTL Arabic wrapper).
 */
export async function saveHtmlAs({ defaultName, htmlBody, title }, apiUrl) {
  // Ask backend to wrap the body in a proper RTL document.
  const wrapRes = await fetch(`${apiUrl}/convert/wrap-html`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: htmlBody, title }),
  });
  const { html } = await wrapRes.json();
  return saveTextAs({ defaultName, ext: "html", label: "HTML", content: html }, apiUrl);
}

/**
 * Save the current HTML as a Word .docx. The backend does the conversion and
 * file write — we just provide the save path.
 */
export async function saveDocxAs({ defaultName, htmlBody, title }, apiUrl) {
  if (!isElectron) {
    alert("تصدير Word متاح فقط في تطبيق سطح المكتب.");
    return { ok: false, error: "DOCX not supported in browser mode" };
  }
  const { canceled, filePath } = await window.electronAPI.showSaveDialog({
    title: "حفظ باسم Word",
    defaultPath: defaultName,
    filters: [{ name: "Word", extensions: ["docx"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const res = await fetch(`${apiUrl}/convert/to-docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html: htmlBody, title, savePath: filePath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || "فشل تصدير DOCX" };
  }
  return { ok: true, path: filePath };
}

/**
 * Read a .docx file from a path and convert it to TipTap-ready HTML.
 */
export async function readDocxAsHtml(sourcePath, apiUrl) {
  const res = await fetch(`${apiUrl}/convert/from-docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || "فشل قراءة DOCX" };
  }
  const data = await res.json();
  return { ok: true, ...data };
}

/**
 * Read a .pdf file from a path and extract text as TipTap-ready HTML.
 * Quality of extraction depends heavily on the source PDF.
 */
export async function readPdfAsHtml(sourcePath, apiUrl) {
  const res = await fetch(`${apiUrl}/convert/from-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || "فشل قراءة PDF" };
  }
  const data = await res.json();
  return { ok: true, ...data };
}

/**
 * Save as PDF using Electron's printToPDF. Falls back to alert in browser mode.
 */
export async function savePdfAs({ defaultName, fullHtml }) {
  if (!isElectron) {
    alert("تصدير PDF متاح فقط في تطبيق سطح المكتب.");
    return { ok: false, error: "PDF not supported in browser mode" };
  }
  const { canceled, filePath } = await window.electronAPI.showSaveDialog({
    title: "حفظ باسم PDF",
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const result = await window.electronAPI.exportPdf(fullHtml, filePath);
  return result;
}

// ─── Import ──────────────────────────────────────────────────────────────────

/**
 * Pick a file via the OS dialog and read its contents.
 *
 * @param {object} opts
 * @param {Array<{name, extensions}>} opts.filters - Dialog file filters
 * @param {boolean} [opts.asBase64=false] - Read as base64 (for binary formats)
 * @returns {Promise<{ok: boolean, path?: string, name?: string, content?: string, contentBase64?: string, canceled?: boolean, error?: string}>}
 */
export async function pickAndReadFile({ filters, asBase64 = false }, apiUrl) {
  if (!isElectron) {
    return {
      ok: false,
      error: "استيراد الملفات متاح فقط في تطبيق سطح المكتب.",
    };
  }
  const { canceled, filePaths } = await window.electronAPI.showOpenDialog({
    title: "اختر ملفاً للاستيراد",
    filters,
    properties: ["openFile"],
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };
  const sourcePath = filePaths[0];
  const res = await fetch(`${apiUrl}/import/read-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath, asBase64 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || "فشل قراءة الملف" };
  }
  const data = await res.json();
  // Extract just the filename (with extension) from the path.
  const name = sourcePath.split(/[\\/]/).pop();
  return { ok: true, path: sourcePath, name, ...data };
}

/**
 * Convert markdown text to TipTap-compatible HTML via the backend's parser.
 */
export async function mdToHtml(mdContent, apiUrl) {
  const res = await fetch(`${apiUrl}/convert/from-md`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: mdContent }),
  });
  const data = await res.json();
  return data.html || "";
}

// ─── HTML → Markdown (improved) ──────────────────────────────────────────────
// Runs in the renderer because it needs the live DOM. Handles inline
// formatting (bold/italic/links/code) that the old converter ignored.

function nodeToMd(node, depth = 0) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  const inner = Array.from(node.childNodes).map((c) => nodeToMd(c, depth + 1)).join("");
  switch (tag) {
    case "h1": return `# ${inner.trim()}\n\n`;
    case "h2": return `## ${inner.trim()}\n\n`;
    case "h3": return `### ${inner.trim()}\n\n`;
    case "h4": return `#### ${inner.trim()}\n\n`;
    case "h5": return `##### ${inner.trim()}\n\n`;
    case "h6": return `###### ${inner.trim()}\n\n`;
    case "p":  return `${inner.trim()}\n\n`;
    case "br": return "\n";
    case "strong":
    case "b":  return `**${inner}**`;
    case "em":
    case "i":  return `*${inner}*`;
    case "code": return `\`${inner}\``;
    case "pre": return `\n\`\`\`\n${inner.replace(/\n+$/, "")}\n\`\`\`\n\n`;
    case "a": {
      const href = node.getAttribute("href") || "";
      return `[${inner}](${href})`;
    }
    case "img": {
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "";
      return `![${alt}](${src})`;
    }
    case "blockquote": return `> ${inner.trim().replace(/\n+/g, "\n> ")}\n\n`;
    case "hr": return `\n---\n\n`;
    case "ul":
    case "ol": {
      const items = Array.from(node.children).map((li, idx) => {
        const text = Array.from(li.childNodes).map((c) => nodeToMd(c, depth + 1)).join("").trim();
        const bullet = tag === "ol" ? `${idx + 1}.` : "-";
        return `${bullet} ${text}`;
      });
      return items.join("\n") + "\n\n";
    }
    case "li": return inner; // handled by parent ul/ol
    default:   return inner;
  }
}

/**
 * Convert TipTap-rendered HTML to clean Markdown. Significantly better
 * than the old converter — handles bold/italic/links/inline code/images.
 */
export function htmlToMd(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = String(html || "");
  const md = Array.from(tmp.childNodes).map((n) => nodeToMd(n, 0)).join("").trim();
  return md.replace(/\n{3,}/g, "\n\n");
}

/**
 * Convert TipTap-rendered HTML to plain text.
 */
export function htmlToText(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = String(html || "");
  return tmp.textContent || "";
}

// ─── Capability flag (renderer can use this for UI guards) ───────────────────
export const fileIOIsElectron = isElectron;
