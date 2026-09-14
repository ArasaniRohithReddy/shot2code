import {
  CHAT_PANE_WIDTH,
  CHAT_PANE_WIDTH_STORAGE_KEY,
  clampChatPaneWidth,
  clampFileExplorerWidth,
  FILE_EXPLORER_WIDTH,
  FILE_EXPLORER_WIDTH_STORAGE_KEY,
  resolvePaneWidth,
  WORKSPACE_PANE_STORAGE_KEYS,
} from "./pane-sizing";
import { withDefaults } from "../hooks/usePersistedState";
import {
  HISTORY_PROJECT_DATA_METADATA_KEY,
  serializeHistoryProjectData,
  serializeHistoryProjectSnapshotRequest,
} from "./history-serialization";
import { useProjectStore } from "../store/project-store";
import { createProjectFile } from "./project-files";
import { Stack } from "./stacks";
import type { Commit } from "../components/commits/types";

/**
 * Every localStorage key the app owns that is not a pane width. Spelled out
 * rather than imported so that renaming a pane key cannot quietly make this
 * check vacuous.
 */
const NON_PANE_STORAGE_KEYS = [
  "setting",
  "app-theme",
  "shot2code-active-history-project",
  "workspace-conversation-collapsed",
  "workspace-file-explorer",
];

/**
 * A stand-in for `window.localStorage` that mirrors what `usePersistedState`
 * does with it, so "restart the app" in these tests means the same thing it
 * means in the browser: read the same string back and parse it again.
 */
class FakeStorage {
  private readonly entries = new Map<string, string>();

  write(key: string, value: unknown) {
    this.entries.set(key, JSON.stringify(value));
  }

  read<T>(key: string, defaultValue: T): T {
    const stored = this.entries.get(key);
    if (stored === undefined) return defaultValue;
    return withDefaults(JSON.parse(stored), defaultValue);
  }

  keys() {
    return [...this.entries.keys()];
  }
}

function commit(hash: string, parentHash: string | null, code: string): Commit {
  return {
    hash,
    parentHash,
    dateCreated: new Date(1_700_000_000_000),
    isCommitted: true,
    selectedVariantIndex: 0,
    type: parentHash === null ? "ai_create" : "ai_edit",
    inputs: { text: `prompt for ${hash}`, images: [] },
    variants: [
      {
        code,
        status: "complete",
        history: [
          { role: "user", text: "make it blue", imageAssetIds: [], videoAssetIds: [] },
        ],
        files: {
          "index.html": createProjectFile("index.html", code, {
            generated: true,
          }),
        },
      },
      { code: `${code}<!--b-->`, status: "complete", history: [] },
    ],
  };
}

function projectSnapshot() {
  const { commits, head, latestCommitHash } = useProjectStore.getState();
  return JSON.stringify({ commits, head, latestCommitHash });
}

describe("pane width preferences are separate from project history", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject();
    useProjectStore.getState().addCommit(commit("v1", null, "<p>one</p>"));
    useProjectStore.getState().addCommit(commit("v2", "v1", "<p>two</p>"));
    useProjectStore.getState().setHead("v2");
  });

  afterEach(() => {
    useProjectStore.getState().resetProject();
  });

  it("stores widths under keys the project history never uses", () => {
    expect(WORKSPACE_PANE_STORAGE_KEYS).toContain(CHAT_PANE_WIDTH_STORAGE_KEY);
    expect(WORKSPACE_PANE_STORAGE_KEYS).toContain(
      FILE_EXPLORER_WIDTH_STORAGE_KEY
    );
    for (const key of NON_PANE_STORAGE_KEYS) {
      expect(WORKSPACE_PANE_STORAGE_KEYS).not.toContain(key);
    }
    expect(new Set(WORKSPACE_PANE_STORAGE_KEYS).size).toBe(
      WORKSPACE_PANE_STORAGE_KEYS.length
    );
  });

  it("leaves commits, variants and history untouched when a pane is resized", () => {
    const before = projectSnapshot();
    const storage = new FakeStorage();

    // A drag is a sequence of writes; none of them may reach the project.
    for (const width of [321, 360, 404, 455]) {
      storage.write(CHAT_PANE_WIDTH_STORAGE_KEY, width);
    }
    storage.write(FILE_EXPLORER_WIDTH_STORAGE_KEY, 300);

    expect(projectSnapshot()).toBe(before);
    expect(Object.keys(useProjectStore.getState().commits)).toEqual([
      "v1",
      "v2",
    ]);
    expect(useProjectStore.getState().commits.v1.variants).toHaveLength(2);
  });

  it("keeps both widths while switching versions, then restores them on restart", () => {
    const storage = new FakeStorage();
    storage.write(CHAT_PANE_WIDTH_STORAGE_KEY, 455);
    storage.write(FILE_EXPLORER_WIDTH_STORAGE_KEY, 300);
    const before = projectSnapshot();

    // Walk the history the way the version switcher does.
    useProjectStore.getState().setHead("v1");
    useProjectStore.getState().setHead("v2");

    expect(useProjectStore.getState().head).toBe("v2");
    expect(projectSnapshot()).toBe(before);

    // "Restart": nothing but storage survives.
    const chatWidth = resolvePaneWidth(
      storage.read(CHAT_PANE_WIDTH_STORAGE_KEY, CHAT_PANE_WIDTH.default),
      CHAT_PANE_WIDTH.default
    );
    const explorerWidth = resolvePaneWidth(
      storage.read(
        FILE_EXPLORER_WIDTH_STORAGE_KEY,
        FILE_EXPLORER_WIDTH.default
      ),
      FILE_EXPLORER_WIDTH.default
    );

    expect(chatWidth).toBe(455);
    expect(explorerWidth).toBe(300);
    expect(clampChatPaneWidth(chatWidth, 1920)).toBe(455);
    expect(clampFileExplorerWidth(explorerWidth, 1200)).toBe(300);
  });

  it("survives opening a different project, because it is not project state", () => {
    const storage = new FakeStorage();
    storage.write(CHAT_PANE_WIDTH_STORAGE_KEY, 512);

    useProjectStore.getState().resetProject();

    expect(useProjectStore.getState().commits).toEqual({});
    expect(
      storage.read(CHAT_PANE_WIDTH_STORAGE_KEY, CHAT_PANE_WIDTH.default)
    ).toBe(512);
    expect(storage.keys()).toEqual([CHAT_PANE_WIDTH_STORAGE_KEY]);
  });

  it("restores the last width when the chat panel is re-opened", () => {
    const storage = new FakeStorage();
    storage.write(CHAT_PANE_WIDTH_STORAGE_KEY, 480);

    // Collapsing writes a different key, so the width is still there to read.
    storage.write("workspace-conversation-collapsed", true);
    storage.write("workspace-conversation-collapsed", false);

    expect(
      storage.read(CHAT_PANE_WIDTH_STORAGE_KEY, CHAT_PANE_WIDTH.default)
    ).toBe(480);
  });

  it("never serializes a pane width into a saved version", () => {
    const width = 455;
    const payload = serializeHistoryProjectSnapshotRequest({
      title: "Landing page",
      stack: Stack.HTML_TAILWIND,
      inputMode: "image",
      metadata: {
        [HISTORY_PROJECT_DATA_METADATA_KEY]: serializeHistoryProjectData({
          entryPoint: "index.html",
          activeFilePath: "index.html",
          generationTargetPath: "index.html",
          files: {
            "index.html": {
              path: "index.html",
              content: "<p>one</p>",
              language: "html",
              type: "markup",
            },
          },
        }),
      },
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(CHAT_PANE_WIDTH_STORAGE_KEY);
    expect(serialized).not.toContain(FILE_EXPLORER_WIDTH_STORAGE_KEY);
    expect(serialized).not.toContain(String(width));
  });
});
