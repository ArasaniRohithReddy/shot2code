import { APP_COMMANDS, isAppCommand } from "./app-shortcuts";
import {
  areDesktopMenuStatesEqual,
  DESKTOP_MENU_COMMAND_CHANNEL,
  DESKTOP_MENU_STATE_CHANNEL,
  publishDesktopMenuState,
  readDesktopMenuCommand,
  subscribeToDesktopMenuCommands,
  type DesktopMenuBridge,
  type DesktopMenuState,
} from "./desktop-menu";

function createBridge(
  overrides: Partial<DesktopMenuBridge> = {}
): DesktopMenuBridge & {
  emit: (payload: unknown) => void;
  published: DesktopMenuState[];
  listeners: number;
} {
  let emit: (payload: unknown) => void = () => {};
  const published: DesktopMenuState[] = [];
  const bridge = {
    listeners: 0,
    published,
    emit: (payload: unknown) => emit(payload),
    onMenuCommand(listener: (payload: unknown) => void) {
      bridge.listeners += 1;
      emit = listener;
      return () => {
        bridge.listeners -= 1;
        emit = () => {};
      };
    },
    setMenuState(state: DesktopMenuState) {
      published.push(state);
    },
    ...overrides,
  };
  return bridge;
}

const state = (overrides: Partial<DesktopMenuState> = {}): DesktopMenuState => ({
  hasProject: true,
  canExport: true,
  isChatPanelVisible: true,
  ...overrides,
});

describe("desktop menu bridge", () => {
  it("names the same IPC channels as the desktop shell", () => {
    expect(DESKTOP_MENU_COMMAND_CHANNEL).toBe("shot2code:menu-command");
    expect(DESKTOP_MENU_STATE_CHANNEL).toBe("shot2code:menu-state");
  });

  it("accepts every command the menu can send", () => {
    for (const command of APP_COMMANDS) {
      expect(readDesktopMenuCommand({ command })).toBe(command);
      expect(isAppCommand(command)).toBe(true);
    }

    expect(APP_COMMANDS).toContain("toggle-chat-panel");
    expect(APP_COMMANDS).toContain("show-keyboard-shortcuts");
  });

  it("drops anything that is not a known command", () => {
    for (const payload of [
      null,
      undefined,
      "show-code",
      42,
      {},
      { command: "" },
      { command: 7 },
      { command: "drop-tables" },
      { command: "SHOW-CODE" },
    ]) {
      expect(readDesktopMenuCommand(payload)).toBeNull();
    }

    expect(isAppCommand("rm -rf")).toBe(false);
  });

  it("dispatches commands and unsubscribes cleanly", () => {
    const bridge = createBridge();
    const run = jest.fn();

    const unsubscribe = subscribeToDesktopMenuCommands(bridge, run);
    expect(bridge.listeners).toBe(1);

    bridge.emit({ command: "show-code" });
    bridge.emit({ command: "show-keyboard-shortcuts" });
    // An unknown command must never reach the dispatcher.
    bridge.emit({ command: "not-a-command" });
    bridge.emit("show-code");

    expect(run.mock.calls).toEqual([
      ["show-code"],
      ["show-keyboard-shortcuts"],
    ]);

    unsubscribe();
    expect(bridge.listeners).toBe(0);
    bridge.emit({ command: "show-code" });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("is inert in the browser build", () => {
    const run = jest.fn();

    expect(() => subscribeToDesktopMenuCommands(undefined, run)()).not.toThrow();
    expect(() => subscribeToDesktopMenuCommands({}, run)()).not.toThrow();
    expect(run).not.toHaveBeenCalled();

    expect(publishDesktopMenuState(undefined, state())).toBe(false);
    expect(publishDesktopMenuState({}, state())).toBe(false);
  });

  it("survives a bridge that returns no unsubscribe function", () => {
    const bridge = createBridge({
      onMenuCommand: () => undefined,
    });
    const run = jest.fn();

    expect(() => subscribeToDesktopMenuCommands(bridge, run)()).not.toThrow();
  });

  it("publishes state and never lets Export outlive its project", () => {
    const bridge = createBridge();

    expect(publishDesktopMenuState(bridge, state())).toBe(true);
    publishDesktopMenuState(
      bridge,
      state({ hasProject: false, canExport: true, isChatPanelVisible: false })
    );

    expect(bridge.published).toEqual([
      { hasProject: true, canExport: true, isChatPanelVisible: true },
      { hasProject: false, canExport: false, isChatPanelVisible: false },
    ]);
  });

  it("compares states so an unchanged render sends nothing", () => {
    expect(areDesktopMenuStatesEqual(state(), state())).toBe(true);
    expect(
      areDesktopMenuStatesEqual(state(), state({ canExport: false }))
    ).toBe(false);
    expect(
      areDesktopMenuStatesEqual(state(), state({ isChatPanelVisible: false }))
    ).toBe(false);
    expect(
      areDesktopMenuStatesEqual(state(), state({ hasProject: false }))
    ).toBe(false);
  });
});
