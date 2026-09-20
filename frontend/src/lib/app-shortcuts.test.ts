import {
  APP_COMMANDS,
  APP_SHORTCUTS,
  displayShortcutKeys,
  getAppShortcutCommand,
  isAppCommand,
} from "./app-shortcuts";

function keyboardEvent(
  key: string,
  overrides: Partial<KeyboardEvent> = {}
) {
  const code =
    key === "/"
      ? "Slash"
      : key === "Enter"
        ? "Enter"
        : /^\d$/.test(key)
          ? `Digit${key}`
          : `Key${key.toUpperCase()}`;
  return {
    altKey: false,
    code,
    ctrlKey: true,
    key,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("app shortcuts", () => {
  it.each([
    ["1", "show-preview"],
    ["2", "show-code"],
    ["3", "show-chat"],
    ["4", "show-history"],
    ["/", "show-help"],
  ])("maps Ctrl+%s to %s", (key, command) => {
    expect(getAppShortcutCommand(keyboardEvent(key))).toBe(command);
  });

  it("maps conflict-free project commands", () => {
    expect(
      getAppShortcutCommand(keyboardEvent("I", { altKey: true }))
    ).toBe("open-import");
    expect(
      getAppShortcutCommand(keyboardEvent("U", { altKey: true }))
    ).toBe("open-upload");
    expect(
      getAppShortcutCommand(keyboardEvent("Enter", { shiftKey: true }))
    ).toBe("retry-generation");
    expect(
      getAppShortcutCommand(keyboardEvent("S", { altKey: true }))
    ).toBe("show-settings");
    expect(
      getAppShortcutCommand(keyboardEvent("C", { altKey: true }))
    ).toBe("toggle-chat-panel");
  });

  it("publishes every keyboard command once, with no duplicate keys", () => {
    const commands = APP_SHORTCUTS.map((shortcut) => shortcut.command);
    expect(new Set(commands).size).toBe(commands.length);

    const combos = APP_SHORTCUTS.map((shortcut) => shortcut.keys.join("+"));
    expect(new Set(combos).size).toBe(combos.length);

    for (const command of commands) {
      expect(isAppCommand(command)).toBe(true);
    }
  });

  it("declares every command the desktop menu may send", () => {
    // The native menu also offers commands that have no key of their own.
    expect([...APP_COMMANDS].sort()).toEqual(
      [
        "export-project",
        "new-project",
        "open-import",
        "open-upload",
        "retry-generation",
        "show-chat",
        "show-code",
        "show-help",
        "show-history",
        "show-keyboard-shortcuts",
        "show-preview",
        "show-settings",
        "toggle-chat-panel",
      ].sort()
    );
    expect(isAppCommand("show-keyboard-shortcuts")).toBe(true);
    expect(isAppCommand("toggle-chat-panel")).toBe(true);
    expect(isAppCommand("show-shortcuts")).toBe(false);
  });

  it("supports Command on macOS and ignores unknown modifier combinations", () => {
    expect(
      getAppShortcutCommand(
        keyboardEvent("2", { ctrlKey: false, metaKey: true })
      )
    ).toBe("show-code");
    expect(
      getAppShortcutCommand(keyboardEvent("2", { altKey: true }))
    ).toBe(null);
    expect(getAppShortcutCommand(keyboardEvent("2", { repeat: true }))).toBe(
      null
    );
  });

  it("uses platform-appropriate labels", () => {
    expect(displayShortcutKeys(["Mod", "Shift", "Enter"], false)).toEqual([
      "Ctrl",
      "Shift",
      "Enter",
    ]);
    expect(displayShortcutKeys(["Mod", "Shift", "Enter"], true)).toEqual([
      "⌘",
      "⇧",
      "Enter",
    ]);
  });
});
