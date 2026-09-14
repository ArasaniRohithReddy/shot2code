"use strict";

const assert = require("node:assert/strict");
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} = require("node:fs");
const { once } = require("node:events");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { isProcessRunning } = require("./update-lifecycle");

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

async function waitForExit(pid, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Process ${pid} was still running after ${timeoutMs}ms`);
}

async function terminateChild(child, timeoutMs = 10000) {
  if (!child || !Number.isInteger(child.pid) || !isProcessRunning(child.pid)) {
    return;
  }

  const closed = once(child, "close");
  child.kill();
  await Promise.race([
    closed,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Child ${child.pid} did not close`)),
        timeoutMs
      )
    ),
  ]);
}

async function removeTreeEventually(directory, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } while (Date.now() < deadline);

  throw lastError;
}

test("installer configuration wires the pre-install safeguard", () => {
  const installer = readFileSync(
    path.join(__dirname, "build", "installer.nsh"),
    "utf8"
  );
  const builderConfig = readFileSync(
    path.join(__dirname, "electron-builder.yml"),
    "utf8"
  );
  const shutdownScript = readFileSync(
    path.join(__dirname, "build", "stop-installed-backend.ps1"),
    "utf8"
  );

  assert.match(builderConfig, /^\s*include:\s+build\/installer\.nsh\s*$/m);
  assert.match(installer, /!macro customInit/);
  assert.match(installer, /stop-installed-backend\.ps1/);
  assert.match(installer, /-InstallDir "\$INSTDIR"/);
  assert.match(installer, /-LogPath "\$2"/);
  assert.match(installer, /SetErrorLevel 23[\s\S]*Quit/);
  assert.match(shutdownScript, /StartsWith\(/);
  assert.match(shutdownScript, /"\/PID"/);
  assert.match(shutdownScript, /"\/T"/);
  assert.doesNotMatch(shutdownScript, /"\/IM"/i);
});

test(
  "installer pre-init kills the installed tree but no unrelated same-name process",
  { skip: process.platform !== "win32" },
  async (t) => {
    const installDir = mkdtempSync(
      path.join(tmpdir(), "shot2code-installer-preinit-")
    );
    const backendDir = path.join(installDir, "resources", "backend");
    const controlDir = path.join(installDir, "resources", "backend-control");
    mkdirSync(backendDir, { recursive: true });
    mkdirSync(controlDir, { recursive: true });

    const targetExe = path.join(backendDir, "shot2code-backend.exe");
    const controlExe = path.join(controlDir, "shot2code-backend.exe");
    const logPath = path.join(installDir, "preinstall.log");
    copyFileSync(process.execPath, targetExe);
    copyFileSync(process.execPath, controlExe);

    const parentScript = [
      'const { spawn } = require("node:child_process");',
      "const child = spawn(process.argv[1],",
      '  ["-e", "setInterval(() => {}, 1000)"],',
      '  { stdio: "ignore", windowsHide: true });',
      "console.log(child.pid);",
      "setInterval(() => {}, 1000);",
    ].join("\n");

    // The child deliberately runs from outside the backend directory. It
    // models Copilot/Chromium descendants and proves taskkill /T handles the
    // whole tree rather than relying on executable-name matching.
    const targetParent = spawn(
      targetExe,
      ["-e", parentScript, process.execPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    const targetChildPid = Number(await firstLine(targetParent.stdout));
    const control = spawn(
      controlExe,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore", windowsHide: true }
    );

    t.after(async () => {
      if (Number.isInteger(targetChildPid) && isProcessRunning(targetChildPid)) {
        try {
          process.kill(targetChildPid);
          await waitForExit(targetChildPid);
        } catch {
          // Assertions report failures; cleanup remains best effort.
        }
      }
      for (const child of [targetParent, control]) {
        try {
          await terminateChild(child);
        } catch {
          // Assertions report failures; cleanup remains best effort.
        }
      }
      await removeTreeEventually(installDir);
    });

    assert.equal(isProcessRunning(targetParent.pid), true);
    assert.equal(isProcessRunning(targetChildPid), true);
    assert.equal(isProcessRunning(control.pid), true);

    const powershell = path.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const result = spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "build", "stop-installed-backend.ps1"),
        "-InstallDir",
        installDir,
        "-TimeoutSeconds",
        "10",
        "-LogPath",
        logPath,
      ],
      { encoding: "utf8", timeout: 30000, windowsHide: true }
    );

    assert.equal(result.error, undefined);
    assert.equal(
      result.status,
      0,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    await waitForExit(targetParent.pid);
    await waitForExit(targetChildPid);
    assert.equal(isProcessRunning(control.pid), true);
    assert.equal(existsSync(logPath), true);
    const log = readFileSync(logPath, "utf8");
    assert.match(log, new RegExp(`PID ${targetParent.pid}`));
    assert.match(log, /pre-install shutdown is complete/i);
    assert.doesNotMatch(log, new RegExp(`PID ${control.pid}`));
  }
);

test(
  "installer pre-init fails closed and writes a diagnostic log",
  { skip: process.platform !== "win32" },
  async (t) => {
    const installDir = mkdtempSync(
      path.join(tmpdir(), "shot2code-installer-failure-")
    );
    const backendDir = path.join(installDir, "resources", "backend");
    const logPath = path.join(installDir, "preinstall.log");
    mkdirSync(backendDir, { recursive: true });

    const targetExe = path.join(backendDir, "shot2code-backend.exe");
    copyFileSync(process.execPath, targetExe);
    const target = spawn(
      targetExe,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore", windowsHide: true }
    );

    t.after(async () => {
      try {
        await terminateChild(target);
      } catch {
        // Assertions report failures; cleanup remains best effort.
      }
      await removeTreeEventually(installDir);
    });

    assert.equal(isProcessRunning(target.pid), true);

    const powershell = path.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    const result = spawnSync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "build", "stop-installed-backend.ps1"),
        "-InstallDir",
        installDir,
        "-TimeoutSeconds",
        "2",
        "-LogPath",
        logPath,
        "-TaskkillPath",
        path.join(installDir, "missing-taskkill.exe"),
      ],
      { encoding: "utf8", timeout: 30000, windowsHide: true }
    );

    assert.equal(result.error, undefined);
    assert.equal(
      result.status,
      23,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.equal(isProcessRunning(target.pid), true);
    assert.equal(existsSync(logPath), true);
    assert.match(
      readFileSync(logPath, "utf8"),
      /failed safely before any files were replaced/i
    );
  }
);
