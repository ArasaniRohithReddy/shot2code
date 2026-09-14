"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  ZOOM_COMMANDS,
  ZOOM_MAX_FACTOR,
  ZOOM_MIN_FACTOR,
  createZoomInputHandler,
  getNextZoomFactor,
  getZoomCommand,
  installZoomControls,
} = require("./zoom-controls");

function keyboardInput(overrides = {}) {
  return {
    type: "keyDown",
    key: "",
    code: "",
    control: true,
    shift: false,
    alt: false,
    meta: false,
    isComposing: false,
    ...overrides,
  };
}

function createWebContents(initialFactor = 1) {
  const webContents = new EventEmitter();
  let factor = initialFactor;
  const setCalls = [];

  webContents.getZoomFactor = () => factor;
  webContents.setZoomFactor = (nextFactor) => {
    setCalls.push(nextFactor);
    factor = nextFactor;
  };
  webContents.getSetCalls = () => setCalls;

  return webContents;
}

test("maps Windows main-keyboard zoom accelerators", () => {
  assert.equal(
    getZoomCommand(
      keyboardInput({ key: "=", code: "Unidentified" }),
      "win32"
    ),
    ZOOM_COMMANDS.IN
  );
  assert.equal(
    getZoomCommand(
      keyboardInput({ key: "Unidentified", code: "Equal" }),
      "win32"
    ),
    ZOOM_COMMANDS.IN
  );
  assert.equal(
    getZoomCommand(
      keyboardInput({ key: "+", code: "Equal", shift: true }),
      "win32"
    ),
    ZOOM_COMMANDS.IN
  );
  assert.equal(
    getZoomCommand(
      keyboardInput({ key: "+", code: "BracketRight", shift: true }),
      "win32"
    ),
    ZOOM_COMMANDS.IN
  );
  assert.equal(
    getZoomCommand(keyboardInput({ key: "-", code: "Minus" }), "win32"),
    ZOOM_COMMANDS.OUT
  );
  assert.equal(
    getZoomCommand(keyboardInput({ key: "0", code: "Digit0" }), "win32"),
    ZOOM_COMMANDS.RESET
  );
});

test("maps numpad add, subtract, and reset keys", () => {
  assert.equal(
    getZoomCommand(
      keyboardInput({ key: "Unidentified", code: "NumpadAdd", location: 3 }),
      "win32"
    ),
    ZOOM_COMMANDS.IN
  );
  assert.equal(
    getZoomCommand(
      keyboardInput({
        key: "Unidentified",
        code: "NumpadSubtract",
        location: 3,
      }),
      "win32"
    ),
    ZOOM_COMMANDS.OUT
  );
  assert.equal(
    getZoomCommand(
      keyboardInput({ key: "Unidentified", code: "Numpad0", location: 3 }),
      "win32"
    ),
    ZOOM_COMMANDS.RESET
  );
});

test("uses Command on macOS while preserving unrelated editor input", () => {
  assert.equal(
    getZoomCommand(
      keyboardInput({
        key: "=",
        code: "Equal",
        control: false,
        meta: true,
      }),
      "darwin"
    ),
    ZOOM_COMMANDS.IN
  );

  const ignoredInputs = [
    keyboardInput({ type: "keyUp", key: "=", code: "Equal" }),
    keyboardInput({ key: "=", code: "Equal", control: false }),
    keyboardInput({ key: "=", code: "Equal", alt: true }),
    keyboardInput({ key: "=", code: "Equal", meta: true }),
    keyboardInput({ key: "_", code: "Minus", shift: true }),
    keyboardInput({ key: "c", code: "KeyC" }),
    keyboardInput({ key: "=", code: "Equal", isComposing: true }),
  ];

  for (const input of ignoredInputs) {
    assert.equal(getZoomCommand(input, "win32"), null);
  }
});

test("increments deterministically and clamps to safe bounds", () => {
  assert.equal(getNextZoomFactor(1, ZOOM_COMMANDS.IN), 1.1);
  assert.equal(
    getNextZoomFactor(1.1000000000001, ZOOM_COMMANDS.IN),
    1.2
  );
  assert.equal(getNextZoomFactor(1, ZOOM_COMMANDS.OUT), 0.9);
  assert.equal(
    getNextZoomFactor(ZOOM_MAX_FACTOR, ZOOM_COMMANDS.IN),
    ZOOM_MAX_FACTOR
  );
  assert.equal(
    getNextZoomFactor(ZOOM_MIN_FACTOR, ZOOM_COMMANDS.OUT),
    ZOOM_MIN_FACTOR
  );
  assert.equal(
    getNextZoomFactor(1.7, ZOOM_COMMANDS.RESET),
    1
  );
  assert.throws(
    () => getNextZoomFactor(1, "larger"),
    /Unknown zoom command/
  );
});

test("handles matched input once and suppresses Chromium menu zoom", () => {
  const webContents = createWebContents(1);
  const results = [];
  let prevented = 0;
  const handler = createZoomInputHandler(webContents, {
    platform: "win32",
    onZoom: (result) => results.push(result),
  });

  assert.equal(
    handler(
      {
        preventDefault() {
          prevented += 1;
        },
      },
      keyboardInput({ key: "=", code: "Equal" })
    ),
    true
  );

  assert.equal(prevented, 1);
  assert.deepEqual(webContents.getSetCalls(), [1.1]);
  assert.deepEqual(results, [
    {
      command: ZOOM_COMMANDS.IN,
      previousFactor: 1,
      factor: 1.1,
      changed: true,
    },
  ]);
});

test("does not consume unrelated key events and avoids redundant bound writes", () => {
  const webContents = createWebContents(ZOOM_MAX_FACTOR);
  let prevented = false;
  const handler = createZoomInputHandler(webContents, { platform: "win32" });

  assert.equal(
    handler(
      {
        preventDefault() {
          prevented = true;
        },
      },
      keyboardInput({ key: "c", code: "KeyC" })
    ),
    false
  );
  assert.equal(prevented, false);

  assert.equal(
    handler(
      {
        preventDefault() {
          prevented = true;
        },
      },
      keyboardInput({ key: "+", code: "NumpadAdd" })
    ),
    true
  );
  assert.equal(prevented, true);
  assert.deepEqual(webContents.getSetCalls(), []);
});

test("installs the handler on before-input-event", () => {
  const webContents = createWebContents(1);
  const handler = installZoomControls(webContents, { platform: "win32" });

  assert.equal(webContents.listenerCount("before-input-event"), 1);
  assert.equal(webContents.listeners("before-input-event")[0], handler);
});

test("includes the zoom helper in packaged Electron builds", () => {
  const builderConfig = fs.readFileSync(
    path.join(__dirname, "electron-builder.yml"),
    "utf8"
  );

  assert.match(builderConfig, /^\s*-\s+zoom-controls\.js\s*$/m);
});
