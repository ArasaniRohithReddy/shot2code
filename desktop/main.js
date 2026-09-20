const {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
  ipcMain,
  session,
  desktopCapturer,
} = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const {
  createUpdateInstaller,
  terminateWindowsProcessTreeSync,
} = require("./update-lifecycle");
const { waitForBackend } = require("./backend-readiness");
const { applyZoomCommand, installZoomControls } = require("./zoom-controls");
const {
  DEFAULT_MENU_STATE,
  MENU_COMMAND_CHANNEL,
  MENU_LINKS,
  MENU_STATE_CHANNEL,
  createAppMenu,
} = require("./app-menu");

const untrustedPreloadPath = path.join(__dirname, "untrusted-preload.js");

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
let appMenu = null;
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

/**
 * Frozen Python still has a visible cold-start cost. Put a window up
 * immediately while the shell waits for the bounded core health check;
 * optional Chromium and Copilot discovery continue after core readiness.
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
 * A menu click must reach the app even when the window is behind something,
 * minimised, or hidden - on Windows the menu bar lives on the window, but the
 * accelerators and a restored-from-tray click can both fire while the renderer
 * is not the foreground. Raise it first, then deliver.
 */
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

/**
 * Menu -> renderer. The renderer runs the command through the very same
 * function its keyboard shortcut uses, so the menu can never drift from the
 * keyboard.
 */
function sendMenuCommand(command) {
  const target = focusMainWindow();
  if (!target) {
    log(`menu: dropped "${command}" because no window is open`);
    return false;
  }
  log(`menu: ${command}`);
  target.webContents.send(MENU_COMMAND_CHANNEL, { command });
  return true;
}

/**
 * View > Zoom uses the same helper as Ctrl+=/-/0 so both paths share one step
 * size, one clamp and one log line. The menu items are registered with
 * `registerAccelerator: false`, so a keypress is still handled once, by the
 * `before-input-event` handler installed on the window.
 */
function applyMenuZoom(command) {
  const target = focusMainWindow();
  if (!target) return false;
  try {
    const result = applyZoomCommand(target.webContents, command);
    log(`page zoom ${command}: ${Math.round(result.factor * 100)}%`);
    return true;
  } catch (err) {
    log(`page zoom ${command} failed: ${err.message}`);
    return false;
  }
}

function showAboutDialog() {
  const detail = [
    `Electron ${process.versions.electron}`,
    `Chromium ${process.versions.chrome}`,
    `Node ${process.versions.node}`,
    "",
    `Log file: ${logFile()}`,
  ].join("\n");

  const options = {
    type: "info",
    title: "About shot2code",
    message: `shot2code ${app.getVersion()}`,
    detail,
    buttons: ["Close", "Product page"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };

  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const shown = parent
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options);

  shown
    .then(({ response }) => {
      if (response === 1) shell.openExternal(MENU_LINKS.productPage);
    })
    .catch((err) => log(`about dialog failed: ${err.message}`));
}

function installApplicationMenu() {
  appMenu = createAppMenu({
    buildFromTemplate: (template) => Menu.buildFromTemplate(template),
    setApplicationMenu: (menu) => Menu.setApplicationMenu(menu),
    isDev,
    version: app.getVersion(),
    send: sendMenuCommand,
    openExternal: (url) => {
      log(`menu: opening ${url}`);
      shell.openExternal(url);
    },
    openDiagnosticLogs: () => openDiagnosticLogs(),
    applyZoom: applyMenuZoom,
    showAbout: showAboutDialog,
  });
  appMenu.render();
  return appMenu;
}

function openDiagnosticLogs() {
  return shell.openPath(logFile());
}

/**
 * Screen recording. navigator.mediaDevices.getDisplayMedia() is rejected in
 * Electron unless the main process answers the request, which is why "Record
 * Screen" reported "Could not start screen recording". Prefer the OS picker so
 * the user chooses what to share, and fall back to the primary screen.
 */function enableScreenCapture() {
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
      installDownloadedUpdate();
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
  installZoomControls(mainWindow.webContents, {
    onZoom: ({ command, factor }) => {
      log(`page zoom ${command}: ${Math.round(factor * 100)}%`);
    },
  });

  // Keep real external links in the user's browser, but let the app open its
  // own preview windows (blob:/data:/about:) internally - shell.openExternal
  // cannot handle those schemes and would silently do nothing.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isolatedWindow = {
      autoHideMenuBar: true,
      webPreferences: {
        preload: untrustedPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    };

    // CodePen is opened by POSTing a form to /pen/define. Handing that to the
    // OS browser would drop the body and open an empty pen, so let it open
    // in-app without the privileged shot2code preload bridge.
    if (/^https:\/\/codepen\.io\//i.test(url)) {
      return { action: "allow", overrideBrowserWindowOptions: isolatedWindow };
    }
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    if (/^(?:blob:|data:|about:blank)/i.test(url)) {
      return { action: "allow", overrideBrowserWindowOptions: isolatedWindow };
    }
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
    // The next window starts with no project, so the menu must not keep
    // offering Export and the workspace views from the previous one.
    if (appMenu) appMenu.setState({ ...DEFAULT_MENU_STATE, hasProject: false });
  });
}

function stopBackend() {
  if (!backendProcess) return true;
  if (
    backendProcess.exitCode !== null ||
    backendProcess.signalCode !== null
  ) {
    backendProcess = null;
    return true;
  }

  log("stopping backend");
  try {
    if (process.platform === "win32") {
      // The updater starts replacing resources immediately after before-quit.
      // Waiting for the full Python/Copilot/Chromium tree to die prevents a
      // partial install with locked native DLLs.
      terminateWindowsProcessTreeSync(backendProcess);
    } else {
      backendProcess.kill("SIGTERM");
    }
  } catch (err) {
    log(`failed to stop backend: ${err.message}`);
    return false;
  }
  backendProcess = null;
  log("backend stopped");
  return true;
}

const installDownloadedUpdate = createUpdateInstaller({
  getUpdater: () => desktopUpdater,
  isDownloaded: () => updateState.status === "downloaded",
  stopBackend,
  log,
  onError: (err) => {
    log(`auto-update: install aborted (${err.message})`);
    publishUpdateState({
      status: "error",
      progress: null,
      message:
        "The update was not started because shot2code could not shut down safely. Quit the app and try again.",
    });
  },
});

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
    ipcMain.handle("shot2code:open-logs", () => openDiagnosticLogs());
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
      return installDownloadedUpdate();
    });
    // The renderer owns the truth about whether a project is open, so it tells
    // the menu what to enable. Until that first message the project items stay
    // enabled and the renderer answers with its own toast, which is honest
    // either way.
    ipcMain.on(MENU_STATE_CHANNEL, (_event, state) => {
      if (appMenu) appMenu.setState(state);
    });

    installApplicationMenu();
    createSplash();
    enableScreenCapture();
    initAutoUpdate();

    try {
      const port = await findFreePort();
      process.env.SHOT2CODE_BACKEND_HTTP = `http://127.0.0.1:${port}`;
      process.env.SHOT2CODE_BACKEND_WS = `ws://127.0.0.1:${port}`;

      const backendStartedAt = Date.now();
      backendProcess = startBackend(port);
      await waitForBackend(port, { backendProcess });
      log(`backend ready on ${port} in ${Date.now() - backendStartedAt}ms`);
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
