/**
 * Aragon Write — Electron preload script
 *
 * Exposes a minimal, typed surface of Electron APIs to the renderer via
 * contextBridge. Renderer code is sandboxed (nodeIntegration: false,
 * contextIsolation: true), so the only way it can access dialogs / native
 * file ops is through window.electronAPI.* below.
 *
 * IMPORTANT: keep this file small and audit-friendly. Every method here
 * widens the trust boundary between the web content and the OS.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * True when running inside Electron (renderer guard for browser-mode
   * fallbacks in dev).
   */
  isElectron: true,

  /**
   * Open the OS "Save As..." dialog.
   * @param {object} options - { title, defaultPath, filters: [{name, extensions}] }
   * @returns {Promise<{canceled: boolean, filePath?: string}>}
   */
  showSaveDialog: (options) => ipcRenderer.invoke("dialog:save-as", options),

  /**
   * Open the OS "Open File..." dialog.
   * @param {object} options - { title, filters, properties }
   * @returns {Promise<{canceled: boolean, filePaths?: string[]}>}
   */
  showOpenDialog: (options) => ipcRenderer.invoke("dialog:open-import", options),

  /**
   * Render the given HTML to a PDF and write it to the chosen path.
   * Uses Chromium's printToPDF — no extra dependency.
   * @param {string} html - Full HTML document (with <head>, fonts, RTL).
   * @param {string} savePath - Absolute file path to write the PDF to.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  exportPdf: (html, savePath) => ipcRenderer.invoke("pdf:export", html, savePath),
});
