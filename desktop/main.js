const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");

const isDev = !app.isPackaged;

let backendProcess = null;
let mainWindow = null;
let logStream = null;

const logFile = () =>
  path.join(app.getPath("userData"), "shot2code-backend.log");

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(stamped);
  try {
    if (!logStream) {
      fs.mkdirSync(app.getPath("userData"), { recursive: true });
      logStream = fs.createWriteStream(logFile(), { flags: "a" });
    }
    logStream.write(stamped);
  } catch {
    /* logging must never break startup */
  }
}

/** Ask the OS for a free port so multiple instances can't collide. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Locate the backend entry point.
 * Packaged: the PyInstaller binary in resources/backend.
 * Dev: run the real source tree through uv.
 */
function resolveBackendCommand(port) {
  const exeName =
    process.platform === "win32" ? "shot2code-backend.exe" : "shot2code-backend";
  const packaged = path.join(process.resourcesPath || "", "backend", exeName);

  if (!isDev && fs.existsSync(packaged)) {
    return { command: packaged, args: ["--port", String(port)], cwd: path.dirname(packaged) };
  }

  const backendDir = path.resolve(__dirname, "..", "backend");
  return {
    command: process.platform === "win32" ? "uv.exe" : "uv",
    args: [
      "run",
      "uvicorn",
      "main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    cwd: backendDir,
  };
}

function startBackend(port) {
  const { command, args, cwd } = resolveBackendCommand(port);
  log(`starting backend: ${command} ${args.join(" ")} (cwd=${cwd})`);

  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      BACKEND_PORT: String(port),
      PYTHONUNBUFFERED: "1",
    },
    windowsHide: true,
  });

  child.stdout.on("data", (d) => log(`[backend] ${d.toString().trimEnd()}`));
  child.stderr.on("data", (d) => log(`[backend] ${d.toString().trimEnd()}`));
  child.on("exit", (code, signal) =>
    log(`backend exited code=${code} signal=${signal}`)
  );
  child.on("error", (err) => log(`backend spawn error: ${err.message}`));

  return child;
}

/** Poll a cheap liveness endpoint until the backend answers. */
function waitForBackend(port, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let settled = false;

  return new Promise((resolve, reject) => {
    const finish = (err) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve();
    };

    const attempt = () => {
      if (settled) return;
      const req = http.get(
        { host: "127.0.0.1", port, path: "/api/health", timeout: 5000 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) return finish();
          retry();
        }
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (settled) return;
      if (Date.now() > deadline) {
        return finish(new Error("Backend did not become ready in time."));
      }
      setTimeout(attempt, 400);
    };

    attempt();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Keep external links in the user's browser, not in the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const indexFile = path.join(__dirname, "renderer", "index.html");
  if (fs.existsSync(indexFile)) {
    mainWindow.loadFile(indexFile);
  } else {
    // Dev fallback: the Vite dev server.
    mainWindow.loadURL("http://localhost:5173");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) return;
  log("stopping backend");
  try {
    if (process.platform === "win32") {
      // The Python process may have spawned the Copilot CLI; kill the tree.
      spawn("taskkill", ["/pid", String(backendProcess.pid), "/f", "/t"]);
    } else {
      backendProcess.kill("SIGTERM");
    }
  } catch (err) {
    log(`failed to stop backend: ${err.message}`);
  }
  backendProcess = null;
}

// A second instance would fight over the single backend, so refuse it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    ipcMain.handle("shot2code:open-logs", () => shell.openPath(logFile()));

    try {
      const port = await findFreePort();
      process.env.SHOT2CODE_BACKEND_HTTP = `http://127.0.0.1:${port}`;
      process.env.SHOT2CODE_BACKEND_WS = `ws://127.0.0.1:${port}`;

      backendProcess = startBackend(port);
      await waitForBackend(port);
      log(`backend ready on ${port}`);
    } catch (err) {
      log(`startup failed: ${err.message}`);
      dialog.showErrorBox(
        "shot2code could not start",
        `The backend failed to start.\n\n${err.message}\n\nLog file:\n${logFile()}`
      );
      app.quit();
      return;
    }

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    stopBackend();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", stopBackend);
  process.on("exit", stopBackend);
}
