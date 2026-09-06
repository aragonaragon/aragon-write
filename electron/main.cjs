/**
 * Aragon Write — Electron main process
 *
 * Dev:  npm run electron:dev
 * Prod: npm run electron
 * Dist: npm run dist
 */

const { app, BrowserWindow, shell, utilityProcess, ipcMain, dialog, Menu, safeStorage } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs/promises");

const isDev = !app.isPackaged;
const ROOT = path.join(__dirname, "..");

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let speechProcess = null;
let speechStdoutBuffer = "";
let allowWindowClose = false;
let isQuitting = false;
let secretsWriteQueue = Promise.resolve();

app.setName("Aragon Write");

function secretsFilePath() {
  return path.join(app.getPath("userData"), "secure-settings.json");
}

async function readSecrets() {
  try {
    return JSON.parse(await fs.readFile(secretsFilePath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeSecrets(secrets) {
  const filePath = secretsFilePath();
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(tmpPath, JSON.stringify(secrets), { mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

// ─── Splash Screen ────────────────────────────────────────────────────────────
function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
    splashWindow = null;
  }
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow.show());

  // Safety: close splash after 20s no matter what
  setTimeout(closeSplash, 20000);
}

function createApplicationMenu() {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about", label: "حول أرغون رايت" },
        { type: "separator" },
        { role: "hide", label: "إخفاء أرغون رايت" },
        { role: "hideOthers", label: "إخفاء البقية" },
        { role: "unhide", label: "إظهار الكل" },
        { type: "separator" },
        { role: "quit", label: "إنهاء أرغون رايت" },
      ],
    },
    {
      label: "ملف",
      submenu: [
        {
          label: "حفظ",
          accelerator: "CmdOrCtrl+S",
          click: () => mainWindow?.webContents.send("app:save-shortcut"),
        },
      ],
    },
    {
      label: "تحرير",
      submenu: [
        {
          label: "بدء أو إيقاف الإملاء العربي",
          accelerator: "CmdOrCtrl+Shift+D",
          click: () => mainWindow?.webContents.send("speech:toggle-shortcut"),
        },
        { type: "separator" },
        { role: "undo", label: "تراجع" },
        { role: "redo", label: "إعادة" },
        { type: "separator" },
        { role: "cut", label: "قص" },
        { role: "copy", label: "نسخ" },
        { role: "paste", label: "لصق" },
        { role: "selectAll", label: "تحديد الكل" },
      ],
    },
    {
      label: "عرض",
      submenu: [
        { role: "togglefullscreen", label: "ملء الشاشة" },
        { type: "separator" },
        { role: "zoomIn", label: "تكبير" },
        { role: "zoomOut", label: "تصغير" },
        { role: "resetZoom", label: "الحجم الفعلي" },
      ],
    },
    { role: "windowMenu", label: "نافذة" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Backend ──────────────────────────────────────────────────────────────────
function startBackend() {
  const env = { ...process.env, PORT: "3001" };

  if (app.isPackaged) {
    // Packaged: use utilityProcess.fork() — runs inside Electron's Node.js,
    // no external node.exe needed.
    const serverPath = path.join(process.resourcesPath, "server.cjs");
    backendProcess = utilityProcess.fork(serverPath, [], {
      env,
      stdio: "pipe",
    });
    backendProcess.stdout?.on("data", (d) =>
      process.stdout.write(`[backend] ${d}`)
    );
    backendProcess.stderr?.on("data", (d) =>
      process.stderr.write(`[backend] ${d}`)
    );
    backendProcess.on("exit", (c) =>
      console.log(`[backend] utility process exited (code ${c})`)
    );
  } else {
    // Dev: spawn regular node process
    const { spawn } = require("child_process");
    const serverEntry = path.join(ROOT, "backend", "src", "server.js");
    backendProcess = spawn("node", [serverEntry], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    backendProcess.stdout?.on("data", (d) =>
      process.stdout.write(`[backend] ${d}`)
    );
    backendProcess.stderr?.on("data", (d) =>
      process.stderr.write(`[backend] ${d}`)
    );
    backendProcess.on("exit", (c) =>
      console.log(`[backend] exited (code ${c})`)
    );
  }
}

// Poll /health until backend ready — max 15 s
function waitForBackend(retries = 50) {
  return new Promise((resolve) => {
    const try_ = (n) => {
      http
        .get("http://127.0.0.1:3001/health", (res) => {
          res.resume(); // drain response
          resolve(true);
        })
        .on("error", () => {
          if (n <= 0) return resolve(false);
          setTimeout(() => try_(n - 1), 300);
        });
    };
    try_(retries);
  });
}

// ─── Main Window ──────────────────────────────────────────────────────────────
async function createWindow() {
  const windowIcon = process.platform === "darwin" ? "logo.png" : "icon.ico";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 820,
    minHeight: 660,
    backgroundColor: "#fdf8f0",
    title: "Aragon Write",
    icon: path.join(__dirname, windowIcon),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (process.platform !== "darwin") mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    await mainWindow
      .loadURL("http://localhost:5173")
      .catch(() => mainWindow.loadURL("about:blank"));
  } else {
    await mainWindow.loadFile(
      path.join(ROOT, "frontend", "dist", "index.html")
    );
  }

  // Force-show after 3s in case ready-to-show is slow
  const forceShow = setTimeout(() => {
    closeSplash();
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 3000);

  mainWindow.once("ready-to-show", () => {
    clearTimeout(forceShow);
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("close", (event) => {
    if (allowWindowClose || !mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    mainWindow.webContents.send("app:before-close");
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      allowWindowClose = true;
      mainWindow.close();
    }, 3000);
  });
}

ipcMain.on("app:ready-to-close", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  allowWindowClose = true;
  mainWindow.close();
  if (isQuitting) app.quit();
});

ipcMain.handle("secrets:get", async (_event, key) => {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const secrets = await readSecrets();
  const encrypted = secrets[String(key || "")];
  if (!encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return null;
  }
});

ipcMain.handle("secrets:set", async (_event, key, value) => {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false };
  const normalizedKey = String(key || "");
  if (!normalizedKey) return { ok: false };
  secretsWriteQueue = secretsWriteQueue.then(async () => {
    const secrets = await readSecrets();
    if (value) {
      secrets[normalizedKey] = safeStorage.encryptString(String(value)).toString("base64");
    } else {
      delete secrets[normalizedKey];
    }
    await writeSecrets(secrets);
    return { ok: true };
  });
  return secretsWriteQueue;
});

// ─── Native Arabic dictation (Apple Speech) ─────────────────────────────────
function speechHelperPath() {
  const helperRoot = app.isPackaged
    ? path.join(process.resourcesPath, "AragonSpeechHelper.app")
    : path.join(ROOT, "electron", "bin", "AragonSpeechHelper.app");
  return path.join(helperRoot, "Contents", "MacOS", "AragonSpeechHelper");
}

function sendSpeechEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("speech:event", payload);
  }
}

function stopSpeechRecognition() {
  if (!speechProcess || speechProcess.killed) return false;
  speechProcess.stdin?.write("stop\n");
  return true;
}

ipcMain.handle("speech:start", async () => {
  if (process.platform !== "darwin") {
    return { ok: false, error: "الإملاء الأصلي متاح حالياً على أجهزة Apple فقط" };
  }
  if (speechProcess && !speechProcess.killed) return { ok: true, active: true };

  const executable = speechHelperPath();
  try {
    await fs.access(executable);
  } catch {
    return { ok: false, error: "مكوّن الإملاء العربي غير موجود في هذه النسخة" };
  }

  const { spawn } = require("child_process");
  speechStdoutBuffer = "";
  speechProcess = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });

  speechProcess.stdout.on("data", (chunk) => {
    speechStdoutBuffer += chunk.toString("utf8");
    const lines = speechStdoutBuffer.split("\n");
    speechStdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { sendSpeechEvent(JSON.parse(line)); }
      catch { /* Ignore non-protocol helper output. */ }
    }
  });

  speechProcess.stderr.on("data", (chunk) => {
    if (isDev) process.stderr.write(`[speech] ${chunk}`);
  });

  speechProcess.on("error", () => {
    sendSpeechEvent({ type: "error", message: "تعذّر تشغيل الإملاء العربي" });
    speechProcess = null;
  });

  speechProcess.on("exit", () => {
    speechProcess = null;
    speechStdoutBuffer = "";
    sendSpeechEvent({ type: "stopped" });
  });

  return { ok: true, active: true };
});

ipcMain.handle("speech:stop", async () => ({ ok: stopSpeechRecognition() }));

// ─── IPC: file dialogs & PDF export ───────────────────────────────────────────

// "Save As..." native dialog. Renderer passes filters and optional defaultPath;
// we return the chosen filePath (or {canceled: true}).
ipcMain.handle("dialog:save-as", async (_event, options = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || "حفظ باسم",
    defaultPath: options.defaultPath,
    filters: options.filters || [],
  });
  return result;
});

// "Open..." native dialog. Returns filePaths (multi-select supported via
// options.properties).
ipcMain.handle("dialog:open-import", async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || "اختر ملفاً",
    filters: options.filters || [],
    properties: options.properties || ["openFile"],
  });
  return result;
});

// PDF export using Chromium's built-in printToPDF — no extra dependency.
// We spin up a hidden BrowserWindow with the user's HTML so the print
// only captures the document, not the rest of the app UI.
ipcMain.handle("pdf:export", async (_event, html, savePath) => {
  if (!html || !savePath) return { ok: false, error: "محتوى أو مسار مفقود" };
  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const dataUrl = "data:text/html;charset=UTF-8," + encodeURIComponent(html);
    await win.loadURL(dataUrl);
    // Give web fonts a moment to load before printing.
    await new Promise((r) => setTimeout(r, 250));
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "default" },
    });
    await fs.writeFile(savePath, pdfBuffer);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "فشل تصدير PDF" };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createApplicationMenu();
  createSplash();
  // In dev, concurrently already runs the backend via `npm run dev --workspace backend`
  // with --watch. Spawning a second instance here causes EADDRINUSE and prevents
  // hot-reload of backend changes. Only spawn the bundled backend in packaged builds.
  if (!isDev) startBackend();
  await waitForBackend();
  await createWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (speechProcess) {
    speechProcess.kill();
    speechProcess = null;
  }
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

app.on("activate", () => {
  if (!mainWindow) {
    allowWindowClose = false;
    createWindow();
  }
});
