export type AppShortcutCommand =
  | "new-project"
  | "open-import"
  | "open-upload"
  | "show-preview"
  | "show-code"
  | "show-chat"
  | "show-history"
  | "show-settings"
  | "export-project"
  | "retry-generation"
  | "show-shortcuts";

export interface AppShortcutDefinition {
  command: AppShortcutCommand;
  group: "Project" | "Workspace" | "Help";
  label: string;
  keys: string[];
}

export const APP_SHORTCUTS: AppShortcutDefinition[] = [
  {
    command: "new-project",
    group: "Project",
    label: "New project",
    keys: ["Mod", "Alt", "N"],
  },
  {
    command: "open-import",
    group: "Project",
    label: "Import existing code",
    keys: ["Mod", "Alt", "I"],
  },
  {
    command: "open-upload",
    group: "Project",
    label: "Upload screenshots",
    keys: ["Mod", "Alt", "U"],
  },
  {
    command: "export-project",
    group: "Project",
    label: "Export project",
    keys: ["Mod", "Alt", "E"],
  },
  {
    command: "retry-generation",
    group: "Project",
    label: "Retry selected version",
    keys: ["Mod", "Shift", "Enter"],
  },
  {
    command: "show-settings",
    group: "Workspace",
    label: "Show settings",
    keys: ["Mod", "Alt", "S"],
  },
  {
    command: "show-preview",
    group: "Workspace",
    label: "Show preview",
    keys: ["Mod", "1"],
  },
  {
    command: "show-code",
    group: "Workspace",
    label: "Show code",
    keys: ["Mod", "2"],
  },
  {
    command: "show-chat",
    group: "Workspace",
    label: "Show chat",
    keys: ["Mod", "3"],
  },
  {
    command: "show-history",
    group: "Workspace",
    label: "Show History",
    keys: ["Mod", "4"],
  },
  {
    command: "show-shortcuts",
    group: "Help",
    label: "Keyboard shortcuts",
    keys: ["Mod", "/"],
  },
];

type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "repeat" | "shiftKey"
>;

export function getAppShortcutCommand(
  event: ShortcutKeyboardEvent
): AppShortcutCommand | null {
  if (event.repeat || (!event.ctrlKey && !event.metaKey)) {
    return null;
  }

  if (event.shiftKey && !event.altKey) {
    return event.code === "Enter" || event.code === "NumpadEnter"
      ? "retry-generation"
      : null;
  }

  if (event.altKey && !event.shiftKey) {
    if (event.code === "KeyN") return "new-project";
    if (event.code === "KeyI") return "open-import";
    if (event.code === "KeyU") return "open-upload";
    if (event.code === "KeyE") return "export-project";
    if (event.code === "KeyS") return "show-settings";
    return null;
  }

  if (event.altKey || event.shiftKey) return null;

  switch (event.code) {
    case "Digit1":
      return "show-preview";
    case "Digit2":
      return "show-code";
    case "Digit3":
      return "show-chat";
    case "Digit4":
      return "show-history";
    case "Slash":
      return "show-shortcuts";
    default:
      return null;
  }
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.isContentEditable ||
      target.closest(
        "input, textarea, select, [contenteditable='true'], .cm-editor"
      )
  );
}

export function displayShortcutKeys(keys: string[], isMac: boolean) {
  return keys.map((key) => {
    if (key === "Mod") return isMac ? "⌘" : "Ctrl";
    if (key === "Alt") return isMac ? "⌥" : "Alt";
    if (key === "Shift") return isMac ? "⇧" : "Shift";
    return key;
  });
}
