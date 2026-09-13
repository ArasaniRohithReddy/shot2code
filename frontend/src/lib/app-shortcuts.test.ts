import {
  displayShortcutKeys,
  getAppShortcutCommand,
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
    ["4", "show-versions"],
    ["/", "show-shortcuts"],
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
