/**
 * The renderer half of the native application menu.
 *
 * The desktop shell owns the menu bar; this module owns the contract between
 * the two. It is free of React so the validation, the de-duplication and the
 * unsubscribe behaviour can all be asserted without a DOM.
 *
 * Nothing here decides what a command *does*: a menu click arrives as a typed
 * command id and is handed to the same dispatcher the keyboard shortcuts use.
 * In the browser build the bridge is simply absent and every function here is
 * a no-op.
 */
import { isAppCommand, type AppCommand } from "./app-shortcuts";

/** Main -> renderer. Mirrors MENU_COMMAND_CHANNEL in desktop/app-menu.js. */
export const DESKTOP_MENU_COMMAND_CHANNEL = "shot2code:menu-command";
/** Renderer -> main. Mirrors MENU_STATE_CHANNEL in desktop/app-menu.js. */
export const DESKTOP_MENU_STATE_CHANNEL = "shot2code:menu-state";

/** What the menu is allowed to offer right now. */
export interface DesktopMenuState {
  /** A project is open, so the workspace views mean something. */
  hasProject: boolean;
  /** A finished version exists, so Export would produce a file. */
  canExport: boolean;
  /** The Chat panel is showing, which drives the View checkbox. */
  isChatPanelVisible: boolean;
}

/** The slice of the preload bridge this module needs. */
export interface DesktopMenuBridge {
  onMenuCommand?: (
    listener: (payload: unknown) => void
  ) => (() => void) | void;
  setMenuState?: (state: DesktopMenuState) => void;
}

const NOOP = () => {};

/**
 * Read a command off an IPC payload.
 *
 * The payload crosses a process boundary, so it is treated as unknown: an
 * unrecognised command is dropped rather than dispatched, which keeps a newer
 * shell talking to an older renderer from throwing.
 */
export function readDesktopMenuCommand(payload: unknown): AppCommand | null {
  if (!payload || typeof payload !== "object") return null;
  const command = (payload as { command?: unknown }).command;
  return isAppCommand(command) ? command : null;
}

/**
 * Listen for menu commands. Returns an unsubscribe function that is always
 * safe to call, including when there is no desktop bridge at all.
 */
export function subscribeToDesktopMenuCommands(
  bridge: DesktopMenuBridge | undefined,
  run: (command: AppCommand) => void
): () => void {
  if (!bridge || typeof bridge.onMenuCommand !== "function") return NOOP;

  const unsubscribe = bridge.onMenuCommand((payload) => {
    const command = readDesktopMenuCommand(payload);
    if (command) run(command);
  });

  return typeof unsubscribe === "function" ? unsubscribe : NOOP;
}

export function areDesktopMenuStatesEqual(
  a: DesktopMenuState,
  b: DesktopMenuState
): boolean {
  return (
    a.hasProject === b.hasProject &&
    a.canExport === b.canExport &&
    a.isChatPanelVisible === b.isChatPanelVisible
  );
}

/**
 * Tell the shell what to enable. Export is reported as a strict subset of
 * "a project is open" so the two can never disagree, and the returned boolean
 * says whether anything was actually sent.
 */
export function publishDesktopMenuState(
  bridge: DesktopMenuBridge | undefined,
  state: DesktopMenuState
): boolean {
  if (!bridge || typeof bridge.setMenuState !== "function") return false;

  bridge.setMenuState({
    hasProject: state.hasProject,
    canExport: state.hasProject && state.canExport,
    isChatPanelVisible: state.isChatPanelVisible,
  });
  return true;
}

/** The bridge, or undefined outside the desktop app. */
export function getDesktopMenuBridge(): DesktopMenuBridge | undefined {
  return typeof window === "undefined" ? undefined : window.__SHOT2CODE_APP__;
}
