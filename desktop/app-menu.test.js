"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  DEFAULT_MENU_STATE,
  MENU_COMMANDS,
  MENU_COMMAND_CHANNEL,
  MENU_LINKS,
  MENU_STATE_CHANNEL,
  MENU_ZOOM_COMMANDS,
  buildAppMenuTemplate,
  collectAccelerators,
  createAppMenu,
  eachMenuItem,
  findMenuItem,
  normalizeMenuState,
} = require("./app-menu");
const {
  ZOOM_COMMANDS,
  applyZoomCommand,
  createZoomInputHandler,
} = require("./zoom-controls");

function recorder() {
  const calls = [];
  const fn = (...args) => calls.push(args.length > 1 ? args : args[0]);
  fn.calls = calls;
  return fn;
}

function build(overrides = {}) {
  const send = recorder();
  const openExternal = recorder();
  const openDiagnosticLogs = recorder();
  const applyZoom = recorder();
  const showAbout = recorder();
  const template = buildAppMenuTemplate({
    platform: "win32",
    isDev: false,
    version: "9.9.9",
    send,
    openExternal,
    openDiagnosticLogs,
    applyZoom,
    showAbout,
    ...overrides,
  });
  return {
    template,
    send,
    openExternal,
    openDiagnosticLogs,
    applyZoom,
    showAbout,
  };
}

function topLevelLabels(template) {
  return template.map((item) => item.label);
}

function submenuIds(template, id) {
  return findMenuItem(template, id)
    .submenu.filter((item) => item.type !== "separator")
    .map((item) => item.id);
}

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

function fakeWebContents(initialFactor = 1) {
  let factor = initialFactor;
  return {
    getZoomFactor: () => factor,
    setZoomFactor: (next) => {
      factor = next;
    },
  };
}

test("offers the five standard menus in the standard order", () => {
  const { template } = build();

  assert.deepEqual(topLevelLabels(template), [
    "&File",
    "&Edit",
    "&View",
    "&Window",
    "&Help",
  ]);
});

test("File covers the project lifecycle, then Settings and Exit", () => {
  const { template, send } = build();

  assert.deepEqual(submenuIds(template, "file"), [
    "new-project",
    "upload-screenshots",
    "import-project",
    "export-project",
    "settings",
    "exit",
  ]);

  // Settings is separated from the project actions, and Exit closes the menu.
  const file = findMenuItem(template, "file").submenu;
  assert.equal(file[4].type, "separator");
  assert.equal(findMenuItem(template, "exit").role, "quit");
  assert.equal(findMenuItem(template, "exit").label, "Exit");

  for (const id of [
    "new-project",
    "upload-screenshots",
    "import-project",
    "export-project",
    "settings",
  ]) {
    findMenuItem(template, id).click();
  }

  assert.deepEqual(send.calls, [
    "new-project",
    "open-upload",
    "open-import",
    "export-project",
    "show-settings",
  ]);
});

test("Edit keeps the standard roles and leaves the keystrokes to the page", () => {
  const { template } = build();

  assert.deepEqual(submenuIds(template, "edit"), [
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "delete",
    "selectAll",
  ]);

  for (const id of ["undo", "redo", "cut", "copy", "paste", "selectAll"]) {
    const item = findMenuItem(template, id);
    assert.equal(item.role, id, `${id} must use the Chromium role`);
    // Registering these would hand Ctrl+Z to the menu, and CodeMirror - which
    // keeps its own history - would stop undoing anything.
    assert.equal(item.registerAccelerator, false, `${id} must not register`);
    assert.ok(item.accelerator, `${id} must still show its key`);
    assert.equal(typeof item.click, "undefined", `${id} must not be custom`);
  }

  assert.equal(findMenuItem(template, "undo").accelerator, "CmdOrCtrl+Z");
  assert.equal(findMenuItem(template, "redo").accelerator, "CmdOrCtrl+Y");
  assert.equal(
    findMenuItem(build({ platform: "darwin" }).template, "redo").accelerator,
    "Shift+CmdOrCtrl+Z"
  );
});

test("View switches workspace panes, toggles Chat and ends in zoom", () => {
  const { template, send } = build();

  assert.deepEqual(submenuIds(template, "view"), [
    "show-preview",
    "show-code",
    "show-chat",
    "show-history",
    "toggle-chat-panel",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
    "toggle-fullscreen",
  ]);

  for (const id of [
    "show-preview",
    "show-code",
    "show-chat",
    "show-history",
    "toggle-chat-panel",
  ]) {
    findMenuItem(template, id).click();
  }

  assert.deepEqual(send.calls, [
    "show-preview",
    "show-code",
    "show-chat",
    "show-history",
    "toggle-chat-panel",
  ]);

  const toggle = findMenuItem(template, "toggle-chat-panel");
  assert.equal(toggle.type, "checkbox");
  assert.equal(toggle.checked, true);
  assert.equal(
    findMenuItem(
      build({ state: { hasProject: true, isChatPanelVisible: false } })
        .template,
      "toggle-chat-panel"
    ).checked,
    false
  );

  assert.equal(
    findMenuItem(template, "toggle-fullscreen").role,
    "togglefullscreen"
  );
});

test("hides reload and developer tools outside development", () => {
  const release = build({ isDev: false }).template;
  for (const id of ["reload", "force-reload", "toggle-devtools"]) {
    assert.equal(findMenuItem(release, id), null, `${id} must not ship`);
  }

  const dev = build({ isDev: true }).template;
  assert.deepEqual(submenuIds(dev, "view"), [
    "show-preview",
    "show-code",
    "show-chat",
    "show-history",
    "toggle-chat-panel",
    "reload",
    "force-reload",
    "toggle-devtools",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
    "toggle-fullscreen",
  ]);
  assert.equal(findMenuItem(dev, "reload").role, "reload");
  assert.equal(findMenuItem(dev, "force-reload").role, "forceReload");
  assert.equal(findMenuItem(dev, "toggle-devtools").role, "toggleDevTools");
  assert.equal(findMenuItem(dev, "toggle-devtools").accelerator, "F12");
  assert.equal(
    findMenuItem(build({ isDev: true, platform: "darwin" }).template,
      "toggle-devtools"
    ).accelerator,
    "Alt+Command+I"
  );
});

test("Window offers the standard window roles", () => {
  const { template } = build();

  assert.deepEqual(submenuIds(template, "window"), ["minimize", "close"]);
  assert.equal(findMenuItem(template, "minimize").role, "minimize");
  assert.equal(findMenuItem(template, "close").role, "close");

  const mac = build({ platform: "darwin" }).template;
  assert.deepEqual(submenuIds(mac, "window"), [
    "minimize",
    "close",
    "zoom",
    "front",
  ]);
  assert.equal(findMenuItem(mac, "front").role, "front");
});

test("Help reaches the app's own screens, the release hub and the log", () => {
  const { template, send, openExternal, openDiagnosticLogs, showAbout } =
    build();

  assert.deepEqual(submenuIds(template, "help"), [
    "help-center",
    "keyboard-shortcuts",
    "product-page",
    "user-guide",
    "releases",
    "report-issue",
    "diagnostic-logs",
    "about",
  ]);

  findMenuItem(template, "help-center").click();
  findMenuItem(template, "keyboard-shortcuts").click();
  assert.deepEqual(send.calls, ["show-help", "show-keyboard-shortcuts"]);

  for (const id of ["product-page", "user-guide", "releases", "report-issue"]) {
    findMenuItem(template, id).click();
  }
  assert.deepEqual(openExternal.calls, [
    MENU_LINKS.productPage,
    MENU_LINKS.userGuide,
    MENU_LINKS.releases,
    MENU_LINKS.reportIssue,
  ]);

  findMenuItem(template, "diagnostic-logs").click();
  assert.equal(openDiagnosticLogs.calls.length, 1);

  const about = findMenuItem(template, "about");
  assert.equal(about.label, "About shot2code 9.9.9");
  about.click();
  assert.equal(showAbout.calls.length, 1);
});

test("every external link points at the authoritative release hub", () => {
  const { template } = build();
  const links = [];
  eachMenuItem(template, (item) => {
    if (item.url) links.push(item.url);
  });

  assert.equal(links.length, 4);
  for (const url of links) {
    const { protocol, hostname } = new URL(url);
    assert.equal(protocol, "https:");
    assert.ok(
      ["arasanirohithreddy.github.io", "github.com"].includes(hostname),
      `${url} is not a published host`
    );
    assert.match(url, /shot2code|app-releases/);
  }
});

test("uses stable, collision-free accelerators", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const { template } = build({ platform, isDev: true });
    const accelerators = collectAccelerators(template);
    const seen = new Map();

    for (const { id, accelerator } of accelerators) {
      assert.ok(
        !seen.has(accelerator),
        `${accelerator} is claimed by both ${seen.get(accelerator)} and ${id}`
      );
      seen.set(accelerator, id);
      assert.match(
        accelerator,
        /^(CmdOrCtrl|Shift|Alt|Command|Control|F\d+)/,
        `${id} has an unexpected accelerator: ${accelerator}`
      );
    }
  }
});

test("labels the modifier the way the platform writes it", () => {
  const win = build({ platform: "win32" }).template;
  const mac = build({ platform: "darwin" }).template;

  // CmdOrCtrl renders as Ctrl on Windows and as the Command glyph on macOS,
  // so one spelling is correct on every platform.
  for (const template of [win, mac]) {
    for (const { accelerator } of collectAccelerators(template)) {
      assert.ok(
        !/\bCtrl\+/.test(accelerator) || accelerator.startsWith("CmdOrCtrl"),
        `hard-coded Ctrl in ${accelerator}`
      );
    }
  }

  assert.equal(findMenuItem(mac, "settings").label, "Settings…");
  assert.equal(findMenuItem(win, "settings").label, "Settings");
  // macOS puts About, Settings and Quit in the application menu.
  assert.equal(win[0].label, "&File");
  assert.equal(mac[0].id, "app");
  assert.deepEqual(submenuIds(mac, "file"), [
    "new-project",
    "upload-screenshots",
    "import-project",
    "export-project",
  ]);
});

test("matches the accelerators the in-app shortcut catalogue publishes", () => {
  const shortcuts = fs.readFileSync(
    path.join(__dirname, "..", "frontend", "src", "lib", "app-shortcuts.ts"),
    "utf8"
  );
  const { template } = build();

  const expected = {
    "new-project": ["Mod", "Alt", "N"],
    "open-upload": ["Mod", "Alt", "U"],
    "open-import": ["Mod", "Alt", "I"],
    "export-project": ["Mod", "Alt", "E"],
    "show-settings": ["Mod", "Alt", "S"],
    "show-preview": ["Mod", "1"],
    "show-code": ["Mod", "2"],
    "show-chat": ["Mod", "3"],
    "show-history": ["Mod", "4"],
    "toggle-chat-panel": ["Mod", "Alt", "C"],
    "show-help": ["Mod", "/"],
  };

  const byCommand = new Map();
  eachMenuItem(template, (item) => {
    if (item.command) byCommand.set(item.command, item);
  });

  for (const [command, keys] of Object.entries(expected)) {
    const block = shortcuts.match(
      new RegExp(`command: "${command}",[\\s\\S]*?keys: \\[([^\\]]*)\\]`)
    );
    assert.ok(block, `${command} is missing from app-shortcuts.ts`);
    const published = block[1]
      .split(",")
      .map((key) => key.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    assert.deepEqual(published, keys, `${command} keys drifted`);

    const accelerator = byCommand.get(command).accelerator;
    assert.equal(
      accelerator,
      keys.map((key) => (key === "Mod" ? "CmdOrCtrl" : key)).join("+"),
      `${command} accelerator does not match its shortcut`
    );
  }
});

test("sends only commands the renderer declares", () => {
  const shortcuts = fs.readFileSync(
    path.join(__dirname, "..", "frontend", "src", "lib", "app-shortcuts.ts"),
    "utf8"
  );
  const declared = shortcuts
    .slice(shortcuts.indexOf("export const APP_COMMANDS"))
    .match(/"([a-z-]+)"/g)
    .map((quoted) => quoted.slice(1, -1));

  const { template } = build();
  const sent = [];
  eachMenuItem(template, (item) => {
    if (item.command) sent.push(item.command);
  });

  assert.deepEqual([...sent].sort(), [...MENU_COMMANDS].sort());
  for (const command of sent) {
    assert.ok(
      declared.includes(command),
      `${command} is not in APP_COMMANDS; the renderer would drop it`
    );
  }
});

test("renderer commands never register their accelerator", () => {
  const { template } = build({ isDev: true });

  eachMenuItem(template, (item) => {
    if ((item.command || item.zoom) && item.accelerator) {
      assert.equal(
        item.registerAccelerator,
        false,
        `${item.id} must leave its key to the page`
      );
    }
  });
});

test("disables project-only items when there is no project", () => {
  const { template } = build({
    state: { hasProject: false, canExport: true, isChatPanelVisible: true },
  });

  for (const id of [
    "export-project",
    "show-preview",
    "show-code",
    "show-chat",
    "show-history",
    "toggle-chat-panel",
  ]) {
    assert.equal(findMenuItem(template, id).enabled, false, `${id} enabled`);
  }

  // Everything that works without a project stays available.
  for (const id of ["new-project", "upload-screenshots", "settings", "help-center"]) {
    assert.notEqual(findMenuItem(template, id).enabled, false);
  }

  // A project that has not finished generating can be viewed but not exported.
  const coding = build({
    state: { hasProject: true, canExport: false, isChatPanelVisible: true },
  }).template;
  assert.equal(findMenuItem(coding, "export-project").enabled, false);
  assert.equal(findMenuItem(coding, "show-code").enabled, true);
});

test("assumes the app is usable until the renderer says otherwise", () => {
  assert.deepEqual(DEFAULT_MENU_STATE, {
    hasProject: true,
    canExport: true,
    isChatPanelVisible: true,
  });

  assert.deepEqual(normalizeMenuState(undefined), DEFAULT_MENU_STATE);
  assert.deepEqual(normalizeMenuState({ hasProject: "yes" }), DEFAULT_MENU_STATE);
  // Export can never outlive the project it belongs to.
  assert.deepEqual(normalizeMenuState({ hasProject: false, canExport: true }), {
    hasProject: false,
    canExport: false,
    isChatPanelVisible: true,
  });
});

test("rebuilds the menu only when the reported state changes", () => {
  const built = [];
  const applied = [];
  const menu = createAppMenu({
    platform: "win32",
    buildFromTemplate: (template) => {
      built.push(template);
      return { template };
    },
    setApplicationMenu: (value) => applied.push(value),
  });

  menu.render();
  assert.equal(menu.getRenderCount(), 1);
  assert.equal(applied.length, 1);

  assert.equal(menu.setState({ hasProject: false }), true);
  assert.equal(menu.getRenderCount(), 2);
  assert.equal(menu.setState({ hasProject: false }), false);
  assert.equal(menu.setState({ hasProject: false, canExport: false }), false);
  assert.equal(menu.getRenderCount(), 2);

  assert.equal(findMenuItem(built[1], "show-code").enabled, false);
  assert.deepEqual(menu.getState(), {
    hasProject: false,
    canExport: false,
    isChatPanelVisible: true,
  });

  assert.throws(() => createAppMenu({}), /buildFromTemplate is required/);
  assert.throws(
    () => createAppMenu({ buildFromTemplate: () => {} }),
    /setApplicationMenu is required/
  );
});

test("zoom items drive the shared zoom helper, once per action", () => {
  const webContents = fakeWebContents(1);
  const { template } = build({
    applyZoom: (command) => applyZoomCommand(webContents, command),
  });

  assert.deepEqual(
    ["zoom-in", "zoom-out", "zoom-reset"].map(
      (id) => findMenuItem(template, id).zoom
    ),
    [...MENU_ZOOM_COMMANDS]
  );

  findMenuItem(template, "zoom-in").click();
  assert.equal(webContents.getZoomFactor(), 1.1);
  findMenuItem(template, "zoom-in").click();
  assert.equal(webContents.getZoomFactor(), 1.2);
  findMenuItem(template, "zoom-out").click();
  assert.equal(webContents.getZoomFactor(), 1.1);
  findMenuItem(template, "zoom-reset").click();
  assert.equal(webContents.getZoomFactor(), 1);

  assert.equal(findMenuItem(template, "zoom-in").accelerator, "CmdOrCtrl+=");
  assert.equal(findMenuItem(template, "zoom-out").accelerator, "CmdOrCtrl+-");
  assert.equal(findMenuItem(template, "zoom-reset").accelerator, "CmdOrCtrl+0");
});

test("keyboard zoom still applies exactly one step with the menu installed", () => {
  const webContents = fakeWebContents(1);
  const { template } = build({
    applyZoom: (command) => applyZoomCommand(webContents, command),
  });
  const handler = createZoomInputHandler(webContents, { platform: "win32" });

  let prevented = 0;
  const event = {
    preventDefault() {
      prevented += 1;
    },
  };

  // The handler runs before the menu and suppresses the accelerator, so the
  // menu item must never fire for the same keypress: one press, one step.
  assert.equal(
    handler(event, keyboardInput({ key: "=", code: "Equal" })),
    true
  );
  assert.equal(prevented, 1);
  assert.equal(webContents.getZoomFactor(), 1.1);

  for (const id of ["zoom-in", "zoom-out", "zoom-reset"]) {
    assert.equal(findMenuItem(template, id).registerAccelerator, false);
  }

  assert.equal(
    handler(event, keyboardInput({ key: "0", code: "Digit0" })),
    true
  );
  assert.equal(webContents.getZoomFactor(), 1);
  assert.equal(ZOOM_COMMANDS.RESET, "reset");
});

test("keeps the IPC channels and the packaged file list in step", () => {
  assert.equal(MENU_COMMAND_CHANNEL, "shot2code:menu-command");
  assert.equal(MENU_STATE_CHANNEL, "shot2code:menu-state");

  const preload = fs.readFileSync(path.join(__dirname, "preload.js"), "utf8");
  assert.match(preload, /onMenuCommand/);
  assert.match(preload, /setMenuState/);
  assert.ok(preload.includes(MENU_COMMAND_CHANNEL));
  assert.ok(preload.includes(MENU_STATE_CHANNEL));

  const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  assert.match(main, /installApplicationMenu\(\)/);
  assert.match(main, /ipcMain\.on\(MENU_STATE_CHANNEL/);
  // A menu click must reach a hidden or minimised window.
  assert.match(main, /function focusMainWindow/);
  assert.match(main, /isMinimized\(\)\) mainWindow\.restore\(\)/);

  const rendererBridge = fs.readFileSync(
    path.join(__dirname, "..", "frontend", "src", "lib", "desktop-menu.ts"),
    "utf8"
  );
  assert.ok(rendererBridge.includes(`"${MENU_COMMAND_CHANNEL}"`));
  assert.ok(rendererBridge.includes(`"${MENU_STATE_CHANNEL}"`));

  const builderConfig = fs.readFileSync(
    path.join(__dirname, "electron-builder.yml"),
    "utf8"
  );
  assert.match(builderConfig, /^\s*-\s+app-menu\.js\s*$/m);
});
