/**
 * Aragon Write — Electron main process
 *
 * Dev:  npm run electron:dev
 * Prod: npm run electron
 * Dist: npm run dist
 */

const { app, BrowserWindow, shell, utilityProcess, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs/promises");

const isDev = !app.isPackaged;
const ROOT = path.join(__dirname, "..");

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;

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
        .get("http://localhost:3001/health", (res) => {
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: "#101013",
    title: "Aragon Write",
    icon: process.platform === "darwin" ? undefined : path.join(__dirname, "icon.ico"),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (process.platform === "darwin") {
    // macOS routes Cmd+C / Cmd+V / Cmd+Z through the application menu, so a
    // minimal role-based menu must exist even though we hide it on Windows.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ])
    );
  } else {
    mainWindow.setMenuBarVisibility(false);
  }

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
}

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
  createSplash();
  // In dev, concurrently already runs the backend via `npm run dev --workspace backend`
  // with --watch. Spawning a second instance here causes EADDRINUSE and prevents
  // hot-reload of backend changes. Only spawn the bundled backend in packaged builds.
  if (!isDev) startBackend();
  await waitForBackend();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
