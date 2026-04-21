/**
 * Aragon Write — Electron main process
 * Dev mode:  npm run dev (in separate terminal) → npm run electron:dev
 * Prod mode: npm run electron  (builds frontend then launches)
 */

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

// Dev mode when launched with --dev flag or NODE_ENV=development
const isDev =
  process.argv.includes("--dev") || process.env.NODE_ENV === "development";

const ROOT = path.join(__dirname, "..");
let mainWindow = null;
let backendProcess = null;

// ─── Backend spawner ──────────────────────────────────────────────────────────
function startBackend() {
  const serverEntry = path.join(ROOT, "backend", "src", "server.js");
  backendProcess = spawn("node", [serverEntry], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "3001" },
  });
  backendProcess.stdout?.on("data", (d) =>
    process.stdout.write(`[backend] ${d}`)
  );
  backendProcess.stderr?.on("data", (d) =>
    process.stderr.write(`[backend] ${d}`)
  );
  backendProcess.on("exit", (code) =>
    console.log(`[backend] stopped (code ${code})`)
  );
  return backendProcess;
}

// Poll until backend is ready (or give up after ~10 s)
function waitForBackend(retries = 25) {
  return new Promise((resolve) => {
    const try_ = (n) => {
      http
        .get("http://localhost:3001/health", () => resolve(true))
        .on("error", () => {
          if (n <= 0) return resolve(false);
          setTimeout(() => try_(n - 1), 400);
        });
    };
    try_(retries);
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: "#f0f4f9",
    title: "Aragon Write ✍",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    // Dev: load Vite dev server (must be running already)
    await mainWindow.loadURL("http://localhost:5173").catch(() => {
      mainWindow.loadURL("about:blank");
    });
  } else {
    // Production: load built frontend
    await mainWindow.loadFile(
      path.join(ROOT, "frontend", "dist", "index.html")
    );
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in real browser, not Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  if (!isDev) {
    // Production: start backend, wait for it, then show window
    startBackend();
    await waitForBackend();
  }
  await createWindow();
});

app.on("window-all-closed", () => {
  // Kill the backend we spawned
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
