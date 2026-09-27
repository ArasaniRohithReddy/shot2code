"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_STATE_KEYS,
  clampWindowStateToDisplays,
  createWindowStateStore,
  defaultWindowState,
  normalizeWindowState,
  shouldSaveWindowBounds,
} = require("./window-state");

function createFakeFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const calls = [];
  return {
    files,
    calls,
    mkdirSync(dir) {
      calls.push(["mkdirSync", dir]);
    },
    writeFileSync(path, contents) {
      calls.push(["writeFileSync", path]);
      files.set(path, contents);
    },
    renameSync(from, to) {
      calls.push(["renameSync", from, to]);
      files.set(to, files.get(from));
      files.delete(from);
    },
    readFileSync(path) {
      if (!files.has(path)) {
        const error = new Error(`ENOENT: ${path}`);
        error.code = "ENOENT";
        throw error;
      }
      return files.get(path);
    },
  };
}

function createFakeTimers() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    scheduled,
    api: {
      setTimeout(callback, delay) {
        const id = nextId++;
        scheduled.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        scheduled.delete(id);
      },
    },
    runAll() {
      const entries = [...scheduled.entries()];
      scheduled.clear();
      for (const [, entry] of entries) entry.callback();
      return entries.length;
    },
  };
}

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const SECONDARY = { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
const STATE_PATH = "/userData/window-state.json";

test("rejects anything that is not window geometry", () => {
  assert.equal(normalizeWindowState(null), null);
  assert.equal(normalizeWindowState("1400x900"), null);
  assert.equal(normalizeWindowState([1400, 900]), null);
  assert.equal(normalizeWindowState({}), null);
  assert.equal(normalizeWindowState({ width: "1400", height: 900 }), null);
  assert.equal(normalizeWindowState({ width: Number.NaN, height: 900 }), null);
  assert.equal(normalizeWindowState({ width: 1400, height: Infinity }), null);
  assert.equal(normalizeWindowState({ width: 0, height: 900 }), null);
  assert.equal(normalizeWindowState({ width: -1400, height: -900 }), null);
});

test("raises a stored size to the enforced 900x600 minimum", () => {
  assert.deepEqual(normalizeWindowState({ width: 320, height: 240 }), {
    width: MIN_WINDOW_WIDTH,
    height: MIN_WINDOW_HEIGHT,
    x: null,
    y: null,
    maximized: false,
  });
});

test("keeps a whole-pixel position only when both coordinates are numbers", () => {
  assert.deepEqual(
    normalizeWindowState({
      width: 1400.6,
      height: 900.4,
      x: 12.7,
      y: -3.2,
      maximized: true,
    }),
    { width: 1401, height: 900, x: 13, y: -3, maximized: true }
  );
  assert.deepEqual(
    normalizeWindowState({ width: 1400, height: 900, x: 10, y: null }),
    { width: 1400, height: 900, x: null, y: null, maximized: false }
  );
  assert.equal(
    normalizeWindowState({ width: 1400, height: 900, maximized: "yes" })
      .maximized,
    false
  );
});

test("keeps a window that still overlaps a display exactly where it was", () => {
  const clamped = clampWindowStateToDisplays(
    { width: 1200, height: 800, x: 2100, y: 100, maximized: false },
    [PRIMARY, SECONDARY]
  );

  assert.deepEqual(clamped, {
    width: 1200,
    height: 800,
    x: 2100,
    y: 100,
    maximized: false,
    recentered: false,
  });
});

test("re-centres a window stranded on a monitor that was removed", () => {
  const clamped = clampWindowStateToDisplays(
    { width: 1200, height: 800, x: 2400, y: 200, maximized: false },
    [PRIMARY]
  );

  assert.equal(clamped.recentered, true);
  assert.equal(clamped.x, Math.round((1920 - 1200) / 2));
  assert.equal(clamped.y, Math.round((1040 - 800) / 2));
});

test("caps the size to a display that shrank after a scale change", () => {
  const clamped = clampWindowStateToDisplays(
    { width: 1900, height: 1000, x: 0, y: 0, maximized: false },
    [{ workArea: { x: 0, y: 0, width: 1280, height: 720 } }]
  );

  assert.equal(clamped.width, 1280);
  assert.equal(clamped.height, 720);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
});

test("pulls a partly off-screen window back inside the work area", () => {
  const clamped = clampWindowStateToDisplays(
    { width: 1200, height: 800, x: 1800, y: 900, maximized: false },
    [PRIMARY]
  );

  assert.equal(clamped.x, 1920 - 1200);
  assert.equal(clamped.y, 1040 - 800);
  assert.equal(clamped.recentered, false);
});

test("drops the position entirely when no display is known", () => {
  const clamped = clampWindowStateToDisplays(
    { width: 1400, height: 900, x: 10, y: 10, maximized: true },
    []
  );

  assert.equal(clamped.x, null);
  assert.equal(clamped.y, null);
  assert.equal(clamped.maximized, true);
});

test("never saves a minimized, full-screen or transient box", () => {
  const bounds = { x: 0, y: 0, width: 1400, height: 900 };

  assert.equal(shouldSaveWindowBounds({ bounds }), true);
  assert.equal(shouldSaveWindowBounds({ bounds, isMinimized: true }), false);
  assert.equal(shouldSaveWindowBounds({ bounds, isFullScreen: true }), false);
  assert.equal(shouldSaveWindowBounds({}), false);
  assert.equal(
    shouldSaveWindowBounds({ bounds: { x: 0, y: 0, width: 0, height: 0 } }),
    false
  );
  assert.equal(
    shouldSaveWindowBounds({ bounds: { x: 0, y: 0, width: 400, height: 300 } }),
    false
  );
  assert.equal(
    shouldSaveWindowBounds({
      bounds: { x: Number.NaN, y: 0, width: 1400, height: 900 },
    }),
    false
  );
});

test("starts from the built-in default when nothing has been saved", () => {
  const fs = createFakeFs();
  const store = createWindowStateStore({ filePath: STATE_PATH, fs });

  assert.deepEqual(store.load([PRIMARY]), {
    ...defaultWindowState(),
    width: defaultWindowState().width,
  });
  assert.equal(fs.calls.length, 0);
});

test("falls back to defaults for a corrupt file without throwing", () => {
  const messages = [];
  const fs = createFakeFs({ [STATE_PATH]: "{ not json" });
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    log: (message) => messages.push(message),
  });

  const loaded = store.load([PRIMARY]);

  assert.equal(loaded.width, defaultWindowState().width);
  assert.equal(loaded.maximized, false);
  assert.equal(
    messages.some((message) => message.includes("unreadable")),
    true
  );
});

test("restores the maximized flag so the window can be maximized after show", () => {
  const fs = createFakeFs({
    [STATE_PATH]: JSON.stringify({
      version: 1,
      width: 1500,
      height: 950,
      x: 40,
      y: 30,
      maximized: true,
    }),
  });
  const store = createWindowStateStore({ filePath: STATE_PATH, fs });

  assert.deepEqual(store.load([PRIMARY]), {
    width: 1500,
    height: 950,
    x: 40,
    y: 30,
    maximized: true,
  });
});

test("debounces a burst of move and resize samples into one write", () => {
  const fs = createFakeFs();
  const timers = createFakeTimers();
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    timers: timers.api,
  });

  for (let index = 0; index < 20; index += 1) {
    store.scheduleSave({
      bounds: { x: index, y: index, width: 1400, height: 900 },
      isMaximized: false,
    });
  }

  assert.equal(timers.scheduled.size, 1, "only the latest sample stays queued");
  assert.equal(fs.calls.length, 0, "nothing is written before the delay");

  timers.runAll();

  const writes = fs.calls.filter(([name]) => name === "writeFileSync");
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(fs.files.get(STATE_PATH)), {
    version: 1,
    width: 1400,
    height: 900,
    x: 19,
    y: 19,
    maximized: false,
  });
});

test("ignores minimized samples instead of overwriting the last good size", () => {
  const fs = createFakeFs();
  const timers = createFakeTimers();
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    timers: timers.api,
  });

  assert.equal(
    store.scheduleSave({
      bounds: { x: 100, y: 80, width: 1400, height: 900 },
    }),
    true
  );
  assert.equal(
    store.scheduleSave({
      bounds: { x: -32000, y: -32000, width: 160, height: 28 },
      isMinimized: true,
    }),
    false
  );

  timers.runAll();

  assert.deepEqual(JSON.parse(fs.files.get(STATE_PATH)), {
    version: 1,
    width: 1400,
    height: 900,
    x: 100,
    y: 80,
    maximized: false,
  });
});

test("flush writes the queued sample immediately and cancels the timer", () => {
  const fs = createFakeFs();
  const timers = createFakeTimers();
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    timers: timers.api,
  });

  store.scheduleSave({
    bounds: { x: 5, y: 6, width: 1600, height: 1000 },
    isMaximized: true,
  });
  assert.equal(store.hasPendingSave(), true);
  assert.equal(store.flush(), true);

  assert.equal(timers.scheduled.size, 0);
  assert.equal(store.hasPendingSave(), false);
  assert.equal(store.flush(), false, "a second flush has nothing to write");
  assert.equal(JSON.parse(fs.files.get(STATE_PATH)).maximized, true);
});

test("dispose drops the pending save and its timer", () => {
  const fs = createFakeFs();
  const timers = createFakeTimers();
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    timers: timers.api,
  });

  store.scheduleSave({ bounds: { x: 0, y: 0, width: 1400, height: 900 } });
  store.dispose();

  assert.equal(timers.scheduled.size, 0);
  assert.equal(timers.runAll(), 0);
  assert.equal(fs.files.has(STATE_PATH), false);
});

test("writes through a temporary file and renames it into place", () => {
  const fs = createFakeFs();
  const timers = createFakeTimers();
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    timers: timers.api,
  });

  store.scheduleSave({ bounds: { x: 1, y: 2, width: 1400, height: 900 } });
  timers.runAll();

  const names = fs.calls.map(([name]) => name);
  assert.deepEqual(names, ["mkdirSync", "writeFileSync", "renameSync"]);
  assert.equal(fs.calls[1][1], `${STATE_PATH}.tmp`);
  assert.deepEqual(fs.calls[2].slice(1), [`${STATE_PATH}.tmp`, STATE_PATH]);
  assert.equal(fs.files.has(`${STATE_PATH}.tmp`), false);
});

test("stores window geometry only, never project or settings data", () => {
  const fs = createFakeFs();
  const timers = createFakeTimers();
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    timers: timers.api,
  });

  store.scheduleSave({
    bounds: { x: 1, y: 2, width: 1400, height: 900 },
    isMaximized: false,
    // Anything else an Electron event might carry must be dropped on the floor.
    projectId: "project-1",
    settings: { openAiApiKey: "sk-should-never-be-written" },
  });
  timers.runAll();

  const written = fs.files.get(STATE_PATH);
  assert.deepEqual(Object.keys(JSON.parse(written)).sort(), [
    ...WINDOW_STATE_KEYS,
  ].sort());
  assert.equal(written.includes("sk-should-never-be-written"), false);
  assert.equal(written.includes("project-1"), false);
});

test("survives a write failure without crashing the app", () => {
  const messages = [];
  const fs = createFakeFs();
  fs.writeFileSync = () => {
    throw new Error("EACCES: read-only volume");
  };
  const timers = createFakeTimers();
  const store = createWindowStateStore({
    filePath: STATE_PATH,
    fs,
    timers: timers.api,
    log: (message) => messages.push(message),
  });

  store.scheduleSave({ bounds: { x: 0, y: 0, width: 1400, height: 900 } });

  assert.equal(store.flush(), false);
  assert.equal(
    messages.some((message) => message.includes("save failed")),
    true
  );
});

test("requires a file path", () => {
  assert.throws(() => createWindowStateStore({}), TypeError);
});

test("ships the window-state module and wires it into the main process", () => {
  const builderConfig = fs.readFileSync(
    path.join(__dirname, "electron-builder.yml"),
    "utf8"
  );
  assert.match(builderConfig, /^\s*-\s+window-state\.js\s*$/m);

  const packageJson = fs.readFileSync(
    path.join(__dirname, "package.json"),
    "utf8"
  );
  assert.match(packageJson, /window-state\.test\.js/);

  const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  assert.match(main, /require\("\.\/window-state"\)/);
  assert.match(main, /createWindowStateStore\(/);
  // The restore box, not the maximized box, is what gets remembered.
  assert.match(main, /getNormalBounds\(\)/);
  assert.match(main, /if \(restored\.maximized\) mainWindow\.maximize\(\);/);
  for (const event of ["resize", "move", "maximize", "unmaximize"]) {
    assert.match(
      main,
      new RegExp(`mainWindow\\.on\\("${event}", rememberWindowState\\)`)
    );
  }
  assert.match(main, /windowStateStore\?\.flush\(\)/);
  assert.match(main, /windowStateStore\?\.dispose\(\)/);
});

test("the module never reaches for Electron", () => {
  const source = fs.readFileSync(path.join(__dirname, "window-state.js"), "utf8");
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map(
    (match) => match[1]
  );

  assert.deepEqual(required.sort(), ["fs", "path"]);
});
