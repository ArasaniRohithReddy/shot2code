"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const {
  createUpdateInstaller,
  isProcessRunning,
  terminateWindowsProcessTreeSync,
} = require("./update-lifecycle");

test("explicit install stops the backend before launching one installer", () => {
  const events = [];
  let autoInstallOnAppQuit = true;
  const updater = {
    get autoInstallOnAppQuit() {
      return autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value) {
      autoInstallOnAppQuit = value;
      events.push(`auto-install:${value}`);
    },
    quitAndInstall(isSilent, isForceRunAfter) {
      events.push(`install:${isSilent}:${isForceRunAfter}`);
    },
  };
  const install = createUpdateInstaller({
    getUpdater: () => updater,
    isDownloaded: () => true,
    stopBackend: () => {
      events.push("stop-backend");
      return true;
    },
    log: () => events.push("log-ready"),
  });

  assert.equal(autoInstallOnAppQuit, true);
  assert.equal(install(), true);
  assert.deepEqual(events, [
    "stop-backend",
    "auto-install:false",
    "log-ready",
    "install:true:true",
  ]);

  assert.equal(install(), false);
  assert.equal(
    events.filter((event) => event.startsWith("install:")).length,
    1
  );
});

test("explicit install aborts and remains retryable when shutdown fails", () => {
  const errors = [];
  let canStop = false;
  let installCount = 0;
  const updater = {
    autoInstallOnAppQuit: true,
    quitAndInstall() {
      installCount += 1;
    },
  };
  const install = createUpdateInstaller({
    getUpdater: () => updater,
    isDownloaded: () => true,
    stopBackend: () => canStop,
    onError: (err) => errors.push(err.message),
  });

  assert.equal(install(), false);
  assert.equal(installCount, 0);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.deepEqual(errors, ["Backend process tree did not stop"]);

  canStop = true;
  assert.equal(install(), true);
  assert.equal(installCount, 1);
});

function firstLine(stream, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for child PID")),
      timeoutMs
    );
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timeout);
      resolve(buffer.slice(0, newline).trim());
    });
    stream.on("error", reject);
  });
}

async function waitForExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Process ${pid} was still running after ${timeoutMs}ms`);
}

test(
  "Windows backend tree is gone before the installer is launched",
  { skip: process.platform !== "win32" },
  async (t) => {
    const parentScript = [
      'const { spawn } = require("node:child_process");',
      "const child = spawn(process.execPath,",
      '  ["-e", "setInterval(() => {}, 1000)"],',
      '  { stdio: "ignore", windowsHide: true });',
      "console.log(child.pid);",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const parent = spawn(process.execPath, ["-e", parentScript], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const childPid = Number(await firstLine(parent.stdout));

    t.after(() => {
      for (const pid of [childPid, parent.pid]) {
        if (!Number.isInteger(pid) || !isProcessRunning(pid)) continue;
        try {
          process.kill(pid);
        } catch {
          // The assertion already reports failures; cleanup is best effort.
        }
      }
    });

    assert.equal(isProcessRunning(parent.pid), true);
    assert.equal(isProcessRunning(childPid), true);

    let installerLaunched = false;
    const install = createUpdateInstaller({
      getUpdater: () => ({
        autoInstallOnAppQuit: true,
        quitAndInstall(isSilent, isForceRunAfter) {
          assert.equal(isSilent, true);
          assert.equal(isForceRunAfter, true);
          assert.equal(isProcessRunning(parent.pid), false);
          assert.equal(isProcessRunning(childPid), false);
          installerLaunched = true;
        },
      }),
      isDownloaded: () => true,
      stopBackend: () => {
        terminateWindowsProcessTreeSync(parent);
        return true;
      },
    });

    assert.equal(install(), true);
    assert.equal(installerLaunched, true);
    await waitForExit(parent.pid);
    await waitForExit(childPid);
  }
);
