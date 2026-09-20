"use strict";

/**
 * The native application menu.
 *
 * Electron's default menu is built entirely from Chromium roles, so it offers
 * File/Edit/View/Window/Help that say nothing about shot2code: no way to start
 * a project, open Settings, reach the Help centre or read the diagnostic log.
 * This module builds the real menu instead.
 *
 * It deliberately never calls `require("electron")`, so the whole template -
 * labels, accelerators, enablement, checkbox state and click routing - can be
 * asserted by `node --test` without launching a browser process. The Electron
 * pieces (`Menu.buildFromTemplate`, `Menu.setApplicationMenu`, `shell`,
 * `dialog`) are injected by main.js.
 *
 * Two rules keep the menu honest:
 *
 * 1. Anything the app already knows how to do is *sent* to the renderer as a
 *    typed command and runs through exactly the same function the keyboard
 *    shortcut uses. The menu never reimplements a behaviour.
 * 2. Renderer-owned items carry `registerAccelerator: false`. The key is still
 *    printed beside the label, but the keystroke is left to the page, where the
 *    in-app shortcut handler already skips text fields, CodeMirror and open
 *    dialogs. Registering them here would swallow Ctrl+/ inside the editor,
 *    bypass those guards, and - for zoom - fight the `before-input-event`
 *    handler in zoom-controls.js that already owns Ctrl+=/-/0.
 *    `registerAccelerator` is honoured on Windows and Linux, which is what this
 *    app ships; on macOS Electron always registers, and the command still lands
 *    on the same renderer dispatcher.
 */

/** Main -> renderer: a menu item the renderer knows how to run. */
const MENU_COMMAND_CHANNEL = "shot2code:menu-command";
/** Renderer -> main: what the menu is allowed to offer right now. */
const MENU_STATE_CHANNEL = "shot2code:menu-state";

/**
 * Every command the menu may send. These ids are the contract with
 * `frontend/src/lib/app-shortcuts.ts`; app-menu.test.js fails if they drift.
 */
const MENU_COMMANDS = Object.freeze([
  "new-project",
  "open-upload",
  "open-import",
  "export-project",
  "show-settings",
  "show-preview",
  "show-code",
  "show-chat",
  "show-history",
  "toggle-chat-panel",
  "show-help",
  "show-keyboard-shortcuts",
]);

/** The three zoom commands understood by zoom-controls.js. */
const MENU_ZOOM_COMMANDS = Object.freeze(["in", "out", "reset"]);

/**
 * Help destinations. These live in the public release hub, not in this
 * repository, and mirror `frontend/src/lib/help-resources.ts` so the menu and
 * the in-app Help centre can never point at different pages.
 */
const PRODUCT_PAGE_URL =
  "https://arasanirohithreddy.github.io/app-releases/shot2code/";
const RELEASES_PAGE_URL = `${PRODUCT_PAGE_URL}releases/`;
const DOCS_BASE_URL =
  "https://github.com/ArasaniRohithReddy/app-releases/blob/main/products/shot2code/";
const USER_GUIDE_URL = `${DOCS_BASE_URL}USER-GUIDE.md`;
const NEW_ISSUE_URL =
  "https://github.com/ArasaniRohithReddy/app-releases/issues/new/choose";

const MENU_LINKS = Object.freeze({
  productPage: PRODUCT_PAGE_URL,
  releases: RELEASES_PAGE_URL,
  userGuide: USER_GUIDE_URL,
  reportIssue: NEW_ISSUE_URL,
});

/**
 * What the renderer last told us about itself. Until the first message
 * arrives - and in any build where the renderer cannot answer - the
 * project-only items stay enabled and the renderer shows its own honest toast
 * instead of the menu silently doing nothing.
 */
const DEFAULT_MENU_STATE = Object.freeze({
  hasProject: true,
  canExport: true,
  isChatPanelVisible: true,
});

function asBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMenuState(state) {
  const source = state && typeof state === "object" ? state : {};
  const hasProject = asBoolean(source.hasProject, DEFAULT_MENU_STATE.hasProject);
  return {
    hasProject,
    // Export is a strict subset of "there is a project", so a renderer that
    // reports a finished export without a project cannot re-enable the item.
    canExport:
      hasProject && asBoolean(source.canExport, DEFAULT_MENU_STATE.canExport),
    isChatPanelVisible: asBoolean(
      source.isChatPanelVisible,
      DEFAULT_MENU_STATE.isChatPanelVisible
    ),
  };
}

function isSameMenuState(a, b) {
  return (
    a.hasProject === b.hasProject &&
    a.canExport === b.canExport &&
    a.isChatPanelVisible === b.isChatPanelVisible
  );
}

function separator() {
  return { type: "separator" };
}

/**
 * An item the renderer runs. The accelerator is shown but not registered - see
 * the module comment.
 */
function commandItem({ id, label, command, accelerator, enabled, send, type, checked }) {
  const item = {
    id,
    label,
    command,
    click: () => send(command),
  };
  if (accelerator) {
    item.accelerator = accelerator;
    item.registerAccelerator = false;
  }
  if (typeof enabled === "boolean") item.enabled = enabled;
  if (type) item.type = type;
  if (typeof checked === "boolean") item.checked = checked;
  return item;
}

function linkItem({ id, label, url, openExternal }) {
  return { id, label, url, click: () => openExternal(url) };
}

/**
 * Build the whole template as plain data.
 *
 * Every side effect is an injected function, so a test can walk the tree,
 * invoke a click and observe exactly what the menu would have done.
 */
function buildAppMenuTemplate({
  platform = process.platform,
  isDev = false,
  version = "",
  state = DEFAULT_MENU_STATE,
  send = () => {},
  openExternal = () => {},
  openDiagnosticLogs = () => {},
  applyZoom = () => {},
  showAbout = () => {},
} = {}) {
  const isMac = platform === "darwin";
  const menuState = normalizeMenuState(state);
  const { hasProject, canExport, isChatPanelVisible } = menuState;

  const settingsItem = commandItem({
    id: "settings",
    label: isMac ? "Settings…" : "Settings",
    command: "show-settings",
    accelerator: "CmdOrCtrl+Alt+S",
    send,
  });

  const aboutItem = {
    id: "about",
    label: `About shot2code${version ? ` ${version}` : ""}`,
    click: () => showAbout(),
  };

  const template = [];

  if (isMac) {
    template.push({
      id: "app",
      label: "shot2code",
      submenu: [
        aboutItem,
        separator(),
        settingsItem,
        separator(),
        { role: "services" },
        separator(),
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        separator(),
        { role: "quit", label: "Quit shot2code" },
      ],
    });
  }

  const fileSubmenu = [
    commandItem({
      id: "new-project",
      label: "New project",
      command: "new-project",
      accelerator: "CmdOrCtrl+Alt+N",
      send,
    }),
    commandItem({
      id: "upload-screenshots",
      label: "Upload screenshots…",
      command: "open-upload",
      accelerator: "CmdOrCtrl+Alt+U",
      send,
    }),
    commandItem({
      id: "import-project",
      label: "Import project…",
      command: "open-import",
      accelerator: "CmdOrCtrl+Alt+I",
      send,
    }),
    commandItem({
      id: "export-project",
      label: "Export current project…",
      command: "export-project",
      accelerator: "CmdOrCtrl+Alt+E",
      enabled: canExport,
      send,
    }),
  ];

  if (!isMac) {
    fileSubmenu.push(separator(), settingsItem, {
      id: "exit",
      label: "Exit",
      role: "quit",
    });
  }

  template.push({ id: "file", label: "&File", submenu: fileSubmenu });

  // Standard editing roles, so Chromium's own clipboard and undo stack drive
  // the click. registerAccelerator is off because Ctrl+Z/Y/X/C/V/A are already
  // handled inside the page - CodeMirror keeps its own history, and a menu
  // that swallowed the keystroke would undo nothing in the editor.
  const editRole = (role, label, accelerator) => {
    const item = { id: role, role, label };
    if (accelerator) {
      item.accelerator = accelerator;
      item.registerAccelerator = false;
    }
    return item;
  };

  template.push({
    id: "edit",
    label: "&Edit",
    submenu: [
      editRole("undo", "Undo", "CmdOrCtrl+Z"),
      editRole("redo", "Redo", isMac ? "Shift+CmdOrCtrl+Z" : "CmdOrCtrl+Y"),
      separator(),
      editRole("cut", "Cut", "CmdOrCtrl+X"),
      editRole("copy", "Copy", "CmdOrCtrl+C"),
      editRole("paste", "Paste", "CmdOrCtrl+V"),
      ...(isMac
        ? [
            editRole(
              "pasteAndMatchStyle",
              "Paste and Match Style",
              "Shift+CmdOrCtrl+V"
            ),
          ]
        : []),
      editRole("delete", "Delete"),
      separator(),
      editRole("selectAll", "Select All", "CmdOrCtrl+A"),
    ],
  });

  const viewSubmenu = [
    commandItem({
      id: "show-preview",
      label: "Preview",
      command: "show-preview",
      accelerator: "CmdOrCtrl+1",
      enabled: hasProject,
      send,
    }),
    commandItem({
      id: "show-code",
      label: "Code",
      command: "show-code",
      accelerator: "CmdOrCtrl+2",
      enabled: hasProject,
      send,
    }),
    commandItem({
      id: "show-chat",
      label: "Chat",
      command: "show-chat",
      accelerator: "CmdOrCtrl+3",
      enabled: hasProject,
      send,
    }),
    commandItem({
      id: "show-history",
      label: "History",
      command: "show-history",
      accelerator: "CmdOrCtrl+4",
      enabled: hasProject,
      send,
    }),
    separator(),
    commandItem({
      id: "toggle-chat-panel",
      label: "Show Chat panel",
      command: "toggle-chat-panel",
      accelerator: "CmdOrCtrl+Alt+C",
      enabled: hasProject,
      type: "checkbox",
      checked: hasProject && isChatPanelVisible,
      send,
    }),
    separator(),
  ];

  // Reload and DevTools are development tools. Shipping them in a release menu
  // invites a user to reload the renderer out from under a running generation.
  if (isDev) {
    viewSubmenu.push(
      { id: "reload", role: "reload", label: "Reload" },
      { id: "force-reload", role: "forceReload", label: "Force Reload" },
      {
        id: "toggle-devtools",
        role: "toggleDevTools",
        label: "Toggle Developer Tools",
        accelerator: isMac ? "Alt+Command+I" : "F12",
      },
      separator()
    );
  }

  viewSubmenu.push(
    {
      id: "zoom-in",
      label: "Zoom In",
      accelerator: "CmdOrCtrl+=",
      registerAccelerator: false,
      zoom: "in",
      click: () => applyZoom("in"),
    },
    {
      id: "zoom-out",
      label: "Zoom Out",
      accelerator: "CmdOrCtrl+-",
      registerAccelerator: false,
      zoom: "out",
      click: () => applyZoom("out"),
    },
    {
      id: "zoom-reset",
      label: "Actual Size",
      accelerator: "CmdOrCtrl+0",
      registerAccelerator: false,
      zoom: "reset",
      click: () => applyZoom("reset"),
    },
    separator(),
    {
      id: "toggle-fullscreen",
      role: "togglefullscreen",
      label: "Toggle Full Screen",
    }
  );

  template.push({ id: "view", label: "&View", submenu: viewSubmenu });

  template.push({
    id: "window",
    label: "&Window",
    submenu: [
      { id: "minimize", role: "minimize", label: "Minimize" },
      { id: "close", role: "close", label: isMac ? "Close Window" : "Close" },
      ...(isMac
        ? [
            separator(),
            { id: "zoom", role: "zoom", label: "Zoom" },
            { id: "front", role: "front", label: "Bring All to Front" },
          ]
        : []),
    ],
  });

  const helpSubmenu = [
    commandItem({
      id: "help-center",
      label: "Help center",
      command: "show-help",
      accelerator: "CmdOrCtrl+/",
      send,
    }),
    commandItem({
      id: "keyboard-shortcuts",
      label: "Keyboard shortcuts",
      command: "show-keyboard-shortcuts",
      send,
    }),
    separator(),
    linkItem({
      id: "product-page",
      label: "Product page",
      url: MENU_LINKS.productPage,
      openExternal,
    }),
    linkItem({
      id: "user-guide",
      label: "Documentation (User guide)",
      url: MENU_LINKS.userGuide,
      openExternal,
    }),
    linkItem({
      id: "releases",
      label: "All releases",
      url: MENU_LINKS.releases,
      openExternal,
    }),
    separator(),
    linkItem({
      id: "report-issue",
      label: "Report an issue",
      url: MENU_LINKS.reportIssue,
      openExternal,
    }),
    {
      id: "diagnostic-logs",
      label: "Open diagnostic logs",
      click: () => openDiagnosticLogs(),
    },
  ];

  if (!isMac) {
    helpSubmenu.push(separator(), aboutItem);
  }

  template.push({ id: "help", label: "&Help", role: "help", submenu: helpSubmenu });

  return template;
}

/** Depth-first walk over a built template. */
function eachMenuItem(template, visit, trail = []) {
  for (const item of template) {
    const path = [...trail, item];
    visit(item, path);
    if (Array.isArray(item.submenu)) eachMenuItem(item.submenu, visit, path);
  }
}

/** Find an item by id anywhere in a built template. */
function findMenuItem(template, id) {
  let found = null;
  eachMenuItem(template, (item) => {
    if (!found && item.id === id) found = item;
  });
  return found;
}

/** Every accelerator in the template, in menu order. */
function collectAccelerators(template) {
  const accelerators = [];
  eachMenuItem(template, (item) => {
    if (item.accelerator) {
      accelerators.push({ id: item.id, accelerator: item.accelerator });
    }
  });
  return accelerators;
}

/**
 * The live menu.
 *
 * Electron has no API to flip one item's `enabled` without keeping a handle on
 * it, so a state change rebuilds the template. Renderer state changes are rare
 * and de-duplicated here, so that costs nothing in practice.
 */
function createAppMenu({
  buildFromTemplate,
  setApplicationMenu,
  platform = process.platform,
  isDev = false,
  version = "",
  send = () => {},
  openExternal = () => {},
  openDiagnosticLogs = () => {},
  applyZoom = () => {},
  showAbout = () => {},
  onRender = () => {},
} = {}) {
  if (typeof buildFromTemplate !== "function") {
    throw new TypeError("buildFromTemplate is required");
  }
  if (typeof setApplicationMenu !== "function") {
    throw new TypeError("setApplicationMenu is required");
  }

  let state = { ...DEFAULT_MENU_STATE };
  let renderCount = 0;

  function template() {
    return buildAppMenuTemplate({
      platform,
      isDev,
      version,
      state,
      send,
      openExternal,
      openDiagnosticLogs,
      applyZoom,
      showAbout,
    });
  }

  function render() {
    const menu = buildFromTemplate(template());
    setApplicationMenu(menu);
    renderCount += 1;
    onRender(state);
    return menu;
  }

  return {
    render,
    getState: () => ({ ...state }),
    getRenderCount: () => renderCount,
    getTemplate: template,
    /** Returns true when the state actually changed and the menu was rebuilt. */
    setState(next) {
      const normalized = normalizeMenuState(next);
      if (isSameMenuState(state, normalized)) return false;
      state = normalized;
      render();
      return true;
    },
  };
}

module.exports = {
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
};
