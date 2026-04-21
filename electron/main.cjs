/**
 * Aragon Write — Electron main process
 *
 * Dev:  npm run electron:dev
 * Prod: npm run electron          (build + run)
 * Dist: npm run dist              (build installer .exe)
 */

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");

// In packaged app, app.isPackaged is true
const isDev = !app.isPackaged;
const ROOT = path.join(__dirname, "..");

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;

// ─── Splash Screen ────────────────────────────────────────────────────────────
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
}

// ─── Backend ──────────────────────────────────────────────────────────────────
function startBackend() {
  if (app.isPackaged) {
    // Packaged: load bundled Express server directly in main process
    const serverPath = path.join(process.resourcesPath, "server.cjs");
    process.env.PORT = "3001";
    try {
      require(serverPath);
      console.log("[backend] loaded from", serverPath);
    } catch (e) {
      console.error("[backend] failed to load:", e);
    }
  } else {
    // Dev: spawn a separate Node process (hot-reloadable)
    const { spawn } = require("child_process");
    const serverEntry = path.join(ROOT, "backend", "src", "server.js");
    backendProcess = spawn("node", [serverEntry], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "3001" },
    });
    backendProcess.stdout?.on("data", (d) => process.stdout.write(`[backend] ${d}`));
    backendProcess.stderr?.on("data", (d) => process.stderr.write(`[backend] ${d}`));
    backendProcess.on("exit", (c) => console.log(`[backend] exited (code ${c})`));
  }
}

// Poll /health until backend is ready (max ~12 s)
function waitForBackend(retries = 40) {
  return new Promise((resolve) => {
    const try_ = (n) => {
      http
        .get("http://localhost:3001/health", () => resolve(true))
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
    backgroundColor: "#fdf8f0",
    title: "Aragon Write",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    await mainWindow.loadURL("http://localhost:5173").catch(() =>
      mainWindow.loadURL("about:blank")
    );
  } else {
    await mainWindow.loadFile(
      path.join(ROOT, "frontend", "dist", "index.html")
    );
  }

  mainWindow.once("ready-to-show", () => {
    // Close splash then reveal main window
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // External links open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createSplash();
  startBackend();
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
