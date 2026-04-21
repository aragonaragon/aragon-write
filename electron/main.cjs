/**
 * Aragon Write — Electron main process
 *
 * Dev:  npm run electron:dev
 * Prod: npm run electron
 * Dist: npm run dist
 */

const { app, BrowserWindow, shell, utilityProcess } = require("electron");
const path = require("path");
const http = require("http");

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
