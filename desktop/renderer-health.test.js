"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  createRendererHealthGuard,
  isBlankRendererSnapshot,
} = require("./renderer-health");

function immediateTimer(callback) {
  callback();
  return 1;
}

test("recognizes only a completely loaded empty renderer as blank", () => {
  assert.equal(
    isBlankRendererSnapshot({
      readyState: "complete",
      rootChildren: 0,
      bodyTextLength: 0,
    }),
    true
  );
  assert.equal(
    isBlankRendererSnapshot({
      readyState: "loading",
      rootChildren: 0,
      bodyTextLength: 0,
    }),
    false
  );
  assert.equal(
    isBlankRendererSnapshot({
      readyState: "complete",
      rootChildren: 1,
      bodyTextLength: 0,
    }),
    false
  );
});

test("reloads one blank renderer, then shows a recovery screen", async () => {
  let reloads = 0;
  let fallbacks = 0;
  const logs = [];
  const guard = createRendererHealthGuard({
    inspect: async () => ({
      readyState: "complete",
      rootChildren: 0,
      bodyTextLength: 0,
    }),
    reload: async () => {
      reloads += 1;
    },
    showFallback: async () => {
      fallbacks += 1;
    },
    log: (message) => logs.push(message),
    setTimer: immediateTimer,
    clearTimer: () => {},
  });

  guard.onDidFinishLoad();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloads, 1);
  assert.equal(fallbacks, 0);

  guard.onDidFinishLoad();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloads, 1);
  assert.equal(fallbacks, 1);
  assert.equal(logs.length, 2);
});

test("does nothing when the renderer has content", async () => {
  let actionCount = 0;
  const guard = createRendererHealthGuard({
    inspect: async () => ({
      readyState: "complete",
      rootChildren: 1,
      bodyTextLength: 20,
    }),
    reload: async () => {
      actionCount += 1;
    },
    showFallback: async () => {
      actionCount += 1;
    },
    log: () => {},
    setTimer: immediateTimer,
    clearTimer: () => {},
  });

  guard.onDidFinishLoad();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(actionCount, 0);
});

test("ships the health guard and wires it into the main process", () => {
  const root = __dirname;
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const health = fs.readFileSync(
    path.join(root, "renderer-health.js"),
    "utf8"
  );
  const builder = fs.readFileSync(
    path.join(root, "electron-builder.yml"),
    "utf8"
  );

  assert.match(main, /createRendererHealthGuard/);
  assert.match(main, /did-finish-load/);
  assert.match(health, /renderer stayed blank after reload/);
  assert.match(builder, /- renderer-health\.js/);
});
