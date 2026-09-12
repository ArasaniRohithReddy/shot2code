const {
  app,
  BrowserWindow,
  shell,
  dialog,
  ipcMain,
  session,
  desktopCapturer,
} = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");

const isDev = !app.isPackaged;
const isManagedInstall =
  process.platform === "win32" &&
  [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter(Boolean)
    .some((root) =>
      process.execPath.toLowerCase().startsWith(root.toLowerCase())
    );

let backendProcess = null;
let mainWindow = null;
let splashWindow = null;
let logStream = null;
let desktopUpdater = null;
let updateState = {
  status: isDev ? "unavailable" : "idle",
  currentVersion: app.getVersion(),
  version: null,
  progress: null,
  message: null,
};

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

function publishUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("shot2code:update-state", updateState);
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

/**
 * The frozen backend needs up to ~70s on a cold start (Python bootstrap plus
 * Chromium and Copilot probes). Without this the app shows nothing at all and
 * looks hung, so put a window up immediately and report progress.
 */
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: "#1e1b4b",
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const html = `
    <html><body style="margin:0;height:100vh;display:flex;flex-direction:column;
      align-items:center;justify-content:center;background:#1e1b4b;color:#e0e7ff;
      font-family:Segoe UI,system-ui,sans-serif;-webkit-user-select:none">
      <div style="font-size:26px;font-weight:600;letter-spacing:-0.5px">shot2code</div>
      <div id="msg" style="margin-top:10px;font-size:13px;opacity:.75">Starting…</div>
      <div style="margin-top:22px;width:240px;height:4px;background:#312e81;border-radius:2px;overflow:hidden">
        <div style="width:40%;height:100%;background:#818cf8;border-radius:2px;
          animation:s 1.1s ease-in-out infinite"></div>
      </div>
      <div style="margin-top:18px;font-size:11px;opacity:.45">First launch takes a little longer</div>
      <style>@keyframes s{0%{margin-left:-40%}100%{margin-left:100%}}</style>
    </body></html>`;

  splashWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

/**
 * Screen recording. navigator.mediaDevices.getDisplayMedia() is rejected in
 * Electron unless the main process answers the request, which is why "Record
 * Screen" reported "Could not start screen recording". Prefer the OS picker so
 * the user chooses what to share, and fall back to the primary screen.
 */
function enableScreenCapture() {
  const handler = async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
      });
      if (!sources.length) {
        log("screen capture: no sources available");
        return callback({});
      }
      const screenSource =
        sources.find((s) => s.id.startsWith("screen:")) || sources[0];
      log(`screen capture: sharing ${screenSource.name}`);
      callback({ video: screenSource });
    } catch (err) {
      log(`screen capture failed: ${err.message}`);
      callback({});
    }
  };

  try {
    // Windows 10+ can show its own picker; the handler above is the fallback
    // when that isn't available.
    session.defaultSession.setDisplayMediaRequestHandler(handler, {
      useSystemPicker: true,
    });
  } catch {
    session.defaultSession.setDisplayMediaRequestHandler(handler);
  }
}

/**
 * Auto-update.
 *
 * The public GitHub release feed provides latest.yml and the matching NSIS
 * installer. The state is mirrored to Settings so updates are visible rather
 * than existing only as log lines and a final restart dialog.
 */
function initAutoUpdate() {
  if (isDev) {
    log("auto-update: skipped in dev");
    publishUpdateState({
      status: "unavailable",
      message: "Updates are only available in the installed app.",
    });
    return;
  }
  if (isManagedInstall) {
    log("auto-update: managed MSI install, updates are administrator-controlled");
    publishUpdateState({
      status: "unavailable",
      message: "Updates are managed by your administrator for this MSI install.",
    });
    return;
  }

  try {
    ({ autoUpdater: desktopUpdater } = require("electron-updater"));
  } catch (err) {
    log(`auto-update: electron-updater unavailable (${err.message})`);
    publishUpdateState({
      status: "error",
      message: "The update service is unavailable.",
    });
    return;
  }

  desktopUpdater.autoDownload = true;
  desktopUpdater.autoInstallOnAppQuit = true;
  desktopUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  desktopUpdater.on("checking-for-update", () => {
    publishUpdateState({ status: "checking", message: null });
  });
  desktopUpdater.on("update-available", (info) => {
    log(`auto-update: ${info.version} available, downloading`);
    publishUpdateState({
      status: "downloading",
      version: info.version,
      progress: 0,
      message: null,
    });
  });
  desktopUpdater.on("download-progress", (progress) => {
    publishUpdateState({
      status: "downloading",
      progress: Math.round(progress.percent || 0),
    });
  });
  desktopUpdater.on("update-not-available", () => {
    log("auto-update: up to date");
    publishUpdateState({
      status: "current",
      version: null,
      progress: null,
      message: null,
    });
  });
  desktopUpdater.on("error", (err) => {
    log(`auto-update: check failed (${err && err.message})`);
    publishUpdateState({
      status: "error",
      progress: null,
      message: err?.message || "Could not check for updates.",
    });
  });
  desktopUpdater.on("update-downloaded", async (info) => {
    log(`auto-update: ${info.version} downloaded`);
    publishUpdateState({
      status: "downloaded",
      version: info.version,
      progress: 100,
      message: null,
    });
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `shot2code ${info.version} has been downloaded.`,
      detail:
        "Restart to install it silently now, or choose Later and it will apply when you quit.",
    });
    if (response === 0) {
      // The default isSilent=false opens the full NSIS setup wizard and waits
      // for user input, which made auto-update look stuck. Install silently
      // and force the updated app to relaunch.
      desktopUpdater.quitAndInstall(true, true);
    }
  });

  publishUpdateState({ status: "checking", message: null });
  desktopUpdater.checkForUpdates().catch((err) => {
    log(`auto-update: ${err.message}`);
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

  mainWindow.once("ready-to-show", () => {
    closeSplash();
    mainWindow.show();
  });

  // Surface renderer failures in the log. Without these a blank window gives
  // no clue why it is blank.
  mainWindow.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      log(`renderer failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    }
  );
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log(`renderer process gone: ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) log(`renderer console [${level}] ${message} (${sourceId}:${line})`);
  });

  // Keep real external links in the user's browser, but let the app open its
  // own preview windows (blob:/data:/about:) internally - shell.openExternal
  // cannot handle those schemes and would silently do nothing.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // CodePen is opened by POSTing a form to /pen/define. Handing that to the
    // OS browser would drop the body and open an empty pen, so let it open
    // in-app where the POST survives.
    if (/^https:\/\/codepen\.io\//i.test(url)) {
      return { action: "allow" };
    }
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
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
      // The updater starts replacing resources immediately after before-quit.
      // Waiting for the full Python/Copilot/Chromium tree to die prevents a
      // partial install with locked native DLLs.
      const result = spawnSync(
        "taskkill",
        ["/pid", String(backendProcess.pid), "/f", "/t"],
        { windowsHide: true, encoding: "utf8" }
      );
      if (result.error) throw result.error;
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
    ipcMain.handle("shot2code:get-app-info", () => ({
      version: app.getVersion(),
      update: updateState,
    }));
    ipcMain.handle("shot2code:check-for-updates", async () => {
      if (!desktopUpdater) return updateState;
      publishUpdateState({ status: "checking", message: null });
      try {
        await desktopUpdater.checkForUpdates();
      } catch {
        // The updater's error event already records and publishes the cause.
      }
      return updateState;
    });
    ipcMain.handle("shot2code:install-update", () => {
      if (!desktopUpdater || updateState.status !== "downloaded") return false;
      setTimeout(() => desktopUpdater.quitAndInstall(true, true), 100);
      return true;
    });

    createSplash();
    enableScreenCapture();
    initAutoUpdate();

    try {
      const port = await findFreePort();
      process.env.SHOT2CODE_BACKEND_HTTP = `http://127.0.0.1:${port}`;
      process.env.SHOT2CODE_BACKEND_WS = `ws://127.0.0.1:${port}`;

      backendProcess = startBackend(port);
      await waitForBackend(port);
      log(`backend ready on ${port}`);
    } catch (err) {
      log(`startup failed: ${err.message}`);
      closeSplash();
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
