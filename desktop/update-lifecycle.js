"use strict";

const { spawnSync } = require("child_process");

function isProcessRunning(pid, killImpl = process.kill) {
  try {
    killImpl(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "ESRCH") return false;
    if (err && err.code === "EPERM") return true;
    throw err;
  }
}

/**
 * Kill a Windows process and every descendant, and do not return until the
 * command has completed and the root process is gone.
 */
function terminateWindowsProcessTreeSync(
  child,
  {
    spawnSyncImpl = spawnSync,
    isProcessRunningImpl = isProcessRunning,
  } = {}
) {
  const pid = child && child.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Backend process has no valid PID");
  }

  const result = spawnSyncImpl(
    "taskkill",
    ["/pid", String(pid), "/f", "/t"],
    {
      windowsHide: true,
      encoding: "utf8",
      timeout: 30000,
    }
  );

  if (result.error) throw result.error;

  const stillRunning = isProcessRunningImpl(pid);
  if (result.status !== 0 && stillRunning) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `taskkill exited with code ${result.status}${detail ? `: ${detail}` : ""}`
    );
  }
  if (stillRunning) {
    throw new Error(`Backend process ${pid} is still running after taskkill`);
  }
}

/**
 * Build the one explicit update-install entry point. The in-progress guard is
 * set before any blocking work so a queued renderer click cannot call
 * quitAndInstall twice and reset electron-updater's own guard.
 */
function createUpdateInstaller({
  getUpdater,
  isDownloaded,
  stopBackend,
  log = () => {},
  onError = () => {},
}) {
  let installInProgress = false;

  return function installDownloadedUpdate() {
    if (installInProgress || !isDownloaded()) return false;

    const updater = getUpdater();
    if (!updater) return false;

    installInProgress = true;
    try {
      if (!stopBackend()) {
        throw new Error("Backend process tree did not stop");
      }

      // Keep auto-install enabled for the normal "Later, then quit" flow.
      // Disable it only for this explicit path so app.quit cannot launch a
      // second NSIS process after quitAndInstall has already started one.
      updater.autoInstallOnAppQuit = false;
      log("auto-update: backend stopped; launching installer");
      updater.quitAndInstall(true, true);
      return true;
    } catch (err) {
      installInProgress = false;
      updater.autoInstallOnAppQuit = true;
      onError(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  };
}

module.exports = {
  createUpdateInstaller,
  isProcessRunning,
  terminateWindowsProcessTreeSync,
};
