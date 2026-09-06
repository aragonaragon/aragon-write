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

  /** Host platform used for labels, shortcuts, and Apple-specific UI. */
  platform: process.platform,

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

  /** Flush the active document before Electron closes the window. */
  onBeforeClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:before-close", listener);
    return () => ipcRenderer.removeListener("app:before-close", listener);
  },

  readyToClose: () => ipcRenderer.send("app:ready-to-close"),

  /** Menu "حفظ" (Cmd+S) asks the renderer to write the active document now. */
  onSaveShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:save-shortcut", listener);
    return () => ipcRenderer.removeListener("app:save-shortcut", listener);
  },

  getSecret: (key) => ipcRenderer.invoke("secrets:get", key),
  setSecret: (key, value) => ipcRenderer.invoke("secrets:set", key, value),

  startSpeechRecognition: () => ipcRenderer.invoke("speech:start"),
  stopSpeechRecognition: () => ipcRenderer.invoke("speech:stop"),
  onSpeechEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("speech:event", listener);
    return () => ipcRenderer.removeListener("speech:event", listener);
  },
  onSpeechToggleShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("speech:toggle-shortcut", listener);
    return () => ipcRenderer.removeListener("speech:toggle-shortcut", listener);
  },
});
