import { Commit, VariantStatus } from "../components/commits/types";
import { useAppStore } from "./app-store";
import { useProjectStore } from "./project-store";
import { createProjectFile } from "../lib/project-files";
import { Stack } from "../lib/stacks";

function createGeneratingCommit(): Commit {
  return {
    hash: "timed-commit",
    parentHash: null,
    dateCreated: new Date(1_000),
    isCommitted: false,
    variants: [{ code: "", history: [] }],
    selectedVariantIndex: 0,
    type: "ai_create",
    inputs: { text: "Create a page", images: [] },
  };
}

test("preserves the selected multi-screenshot interpretation for retry", () => {
  useProjectStore.getState().setMultiScreenshotMode("responsive");

  expect(useProjectStore.getState().multiScreenshotMode).toBe("responsive");

  useProjectStore.getState().setMultiScreenshotMode("pages");
});

describe("version navigation", () => {
  const selectedElement = {
    tagName: "BUTTON",
    outerHTML: "<button>Save</button>",
    context: "body > button",
    previewId: "preview-one",
  };

  beforeEach(() => {
    useProjectStore.setState({ head: "latest" });
    useAppStore.setState({
      inSelectAndEditMode: true,
      selectedElement,
    });
  });

  afterEach(() => {
    useAppStore.setState({
      inSelectAndEditMode: false,
      selectedElement: null,
    });
  });

  it("exits select-and-edit and clears its target when the head changes", () => {
    useProjectStore.getState().setHead("previous");

    expect(useProjectStore.getState().head).toBe("previous");
    expect(useAppStore.getState().inSelectAndEditMode).toBe(false);
    expect(useAppStore.getState().selectedElement).toBeNull();
  });

  it("does not exit select-and-edit when the requested head is already active", () => {
    useProjectStore.getState().setHead("latest");

    expect(useAppStore.getState().inSelectAndEditMode).toBe(true);
    expect(useAppStore.getState().selectedElement).toBe(selectedElement);
  });
});

describe("append-only retry commits", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject();
  });

  it("retains a failed source and appends repeated retry descendants", () => {
    const source: Commit = {
      hash: "source",
      parentHash: null,
      dateCreated: new Date(5_000),
      isCommitted: true,
      selectedVariantIndex: 1,
      type: "ai_create",
      inputs: { text: "Create", images: [], videos: [] },
      variants: [
        {
          code: "<main>partial</main>",
          history: [
            {
              role: "user",
              text: "Create",
              imageAssetIds: [],
              videoAssetIds: [],
            },
          ],
          status: "error",
          errorMessage: "source failed",
        },
        {
          code: "<main>complete</main>",
          history: [],
          status: "complete",
        },
      ],
    };
    useProjectStore.setState({
      commits: { source },
      head: source.hash,
      latestCommitHash: source.hash,
    });
    const sourceBefore = JSON.stringify(source);

    const firstRetry: Commit = {
      ...source,
      hash: "retry-one",
      parentHash: source.hash,
      retryOfHash: source.hash,
      dateCreated: new Date(6_000),
      isCommitted: false,
      selectedVariantIndex: 0,
      variants: [{ code: "", history: [], status: "generating" }],
    };
    useProjectStore.getState().addCommit(firstRetry);

    expect(useProjectStore.getState().head).toBe(firstRetry.hash);
    expect(useProjectStore.getState().latestCommitHash).toBe(firstRetry.hash);
    expect(JSON.stringify(useProjectStore.getState().commits.source)).toBe(
      sourceBefore
    );

    useProjectStore.getState().finalizeGeneratingVariants(
      firstRetry.hash,
      "error",
      "retry failed"
    );
    useProjectStore.getState().setHead(source.hash);

    const secondRetry: Commit = {
      ...source,
      hash: "retry-two",
      parentHash: source.hash,
      retryOfHash: source.hash,
      dateCreated: new Date(7_000),
      isCommitted: false,
      selectedVariantIndex: 0,
      variants: [{ code: "", history: [], status: "generating" }],
    };
    useProjectStore.getState().addCommit(secondRetry);

    const state = useProjectStore.getState();
    expect(Object.keys(state.commits)).toEqual([
      "source",
      "retry-one",
      "retry-two",
    ]);
    expect(state.commits["retry-one"].variants[0]).toEqual(
      expect.objectContaining({ status: "error", errorMessage: "retry failed" })
    );
    expect(state.commits["retry-two"]).toEqual(
      expect.objectContaining({
        parentHash: source.hash,
        retryOfHash: source.hash,
      })
    );
    expect(state.head).toBe("retry-two");
  });

  it("allows selecting options on an immutable historical version", () => {
    const source = createGeneratingCommit();
    source.hash = "historical";
    source.isCommitted = true;
    source.variants = [
      { code: "<main>One</main>", history: [], status: "complete" },
      { code: "<main>Two</main>", history: [], status: "complete" },
    ];
    useProjectStore.setState({
      commits: { [source.hash]: source },
      head: source.hash,
      latestCommitHash: source.hash,
    });

    useProjectStore.getState().updateSelectedVariantIndex(source.hash, 1);

    expect(
      useProjectStore.getState().commits[source.hash].selectedVariantIndex
    ).toBe(1);
  });
});

describe("variant completion timestamps", () => {
  beforeEach(() => {
    useProjectStore.setState({
      commits: {},
      head: null,
      latestCommitHash: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each<VariantStatus>(["complete", "error", "cancelled"])(
    "records one stable timestamp when a variant becomes %s",
    (status) => {
      const now = jest.spyOn(Date, "now").mockReturnValue(116_000);
      const store = useProjectStore.getState();
      store.addCommit(createGeneratingCommit());
      store.updateVariantStatus("timed-commit", 0, status);

      expect(
        useProjectStore.getState().commits["timed-commit"].variants[0]
          .completedAt
      ).toBe(116_000);

      now.mockReturnValue(999_000);
      store.updateVariantStatus("timed-commit", 0, status);

      expect(
        useProjectStore.getState().commits["timed-commit"].variants[0]
          .completedAt
      ).toBe(116_000);
    }
  );
});


describe("multi-file variant state", () => {
  beforeEach(() => {
    useProjectStore.setState({
      commits: {},
      head: null,
      latestCommitHash: null,
    });
  });

  function addProjectCommit() {
    const commit: Commit = {
      hash: "project-commit",
      parentHash: null,
      dateCreated: new Date(2_000),
      isCommitted: false,
      selectedVariantIndex: 0,
      type: "code_create",
      inputs: null,
      variants: [
        {
          code: "<main>One</main>",
          files: {
            "index.html": createProjectFile("index.html", "<main>One</main>"),
            "styles.css": createProjectFile("styles.css", "main { color: red; }"),
          },
          history: [],
        },
        {
          code: "<main>Two</main>",
          files: {
            "index.html": createProjectFile("index.html", "<main>Two</main>"),
            "script.js": createProjectFile("script.js", "console.log('two');"),
          },
          history: [],
        },
        {
          code: "<main>Three</main>",
          files: {
            "index.html": createProjectFile("index.html", "<main>Three</main>"),
            "theme.css": createProjectFile("theme.css", "main { color: blue; }"),
          },
          history: [],
        },
      ],
    };

    useProjectStore.getState().addCommit(commit);
    useProjectStore.getState().setHead(commit.hash);
  }

  it("normalizes legacy code when a commit enters the store", () => {
    const legacy: Commit = {
      hash: "legacy",
      parentHash: null,
      dateCreated: new Date(3_000),
      isCommitted: false,
      selectedVariantIndex: 0,
      type: "code_create",
      inputs: null,
      variants: [{ code: "<p>Legacy</p>", history: [] }],
    };

    useProjectStore.getState().addCommit(legacy);

    const variant = useProjectStore.getState().commits.legacy.variants[0];
    expect(variant.entryPoint).toBe("index.html");
    expect(variant.activeFilePath).toBe("index.html");
    expect(variant.files?.["index.html"].content).toBe("<p>Legacy</p>");
  });

  it("clears select-and-edit state when switching variants", () => {
    addProjectCommit();
    const selectedElement = {
      tagName: "MAIN",
      outerHTML: "<main>Content</main>",
      context: "body > main",
      previewId: "preview-two",
    };
    useAppStore.setState({
      inSelectAndEditMode: true,
      selectedElement,
    });

    useProjectStore
      .getState()
      .updateSelectedVariantIndex("project-commit", 1);

    expect(useProjectStore.getState().commits["project-commit"].selectedVariantIndex).toBe(1);
    expect(useAppStore.getState().inSelectAndEditMode).toBe(false);
    expect(useAppStore.getState().selectedElement).toBeNull();
  });

  it("keeps an active file for each variant while switching options", () => {
    addProjectCommit();
    const store = useProjectStore.getState();

    store.setVariantActiveFile("project-commit", 0, "styles.css");
    store.updateSelectedVariantIndex("project-commit", 1);
    store.setVariantActiveFile("project-commit", 1, "script.js");
    store.updateSelectedVariantIndex("project-commit", 2);
    store.setVariantActiveFile("project-commit", 2, "theme.css");
    store.updateSelectedVariantIndex("project-commit", 0);

    const commit = useProjectStore.getState().commits["project-commit"];
    expect(commit.selectedVariantIndex).toBe(0);
    expect(commit.variants[0].activeFilePath).toBe("styles.css");
    expect(commit.variants[1].activeFilePath).toBe("script.js");
    expect(commit.variants[2].activeFilePath).toBe("theme.css");
  });

  it("keeps histories isolated when switching through option 3", () => {
    addProjectCommit();
    const store = useProjectStore.getState();

    store.appendVariantHistoryMessage("project-commit", 0, {
      role: "user",
      text: "First option edit",
      imageAssetIds: [],
      videoAssetIds: [],
    });
    store.updateSelectedVariantIndex("project-commit", 2);
    store.appendVariantHistoryMessage("project-commit", 2, {
      role: "user",
      text: "Third option edit",
      imageAssetIds: [],
      videoAssetIds: [],
    });
    store.updateSelectedVariantIndex("project-commit", 1);

    const commit = useProjectStore.getState().commits["project-commit"];
    expect(commit.selectedVariantIndex).toBe(1);
    expect(commit.variants[0].history.map((message) => message.text)).toEqual([
      "First option edit",
    ]);
    expect(commit.variants[1].history).toEqual([]);
    expect(commit.variants[2].history.map((message) => message.text)).toEqual([
      "Third option edit",
    ]);
  });

  it("streams generated content into the requested entry without replacing index.html", () => {
    const commit: Commit = {
      hash: "streamed-project",
      parentHash: null,
      dateCreated: new Date(4_000),
      isCommitted: false,
      selectedVariantIndex: 0,
      type: "ai_edit",
      inputs: { text: "Update the component", images: [] },
      variants: [
        {
          code: "<main>Static shell</main>",
          files: {
            "index.html": createProjectFile(
              "index.html",
              "<main>Static shell</main>"
            ),
            "src/App.tsx": createProjectFile("src/App.tsx", ""),
            "src/theme.css": createProjectFile(
              "src/theme.css",
              ":root { color: red; }"
            ),
          },
          entryPoint: "src/App.tsx",
          activeFilePath: "src/App.tsx",
          generationTargetPath: "src/App.tsx",
          history: [],
        },
      ],
    };

    const store = useProjectStore.getState();
    store.addCommit(commit);
    store.appendCommitCode("streamed-project", 0, "export const ");
    store.appendCommitCode("streamed-project", 0, "App = () => null;");

    const variant =
      useProjectStore.getState().commits["streamed-project"].variants[0];
    expect(variant.files?.["src/App.tsx"].content).toBe(
      "export const App = () => null;"
    );
    expect(variant.files?.["src/theme.css"].content).toContain("red");
    expect(variant.code).toBe("<main>Static shell</main>");
  });

  it("edits only the selected file and keeps setCode on the primary file", () => {
    addProjectCommit();
    const store = useProjectStore.getState();

    store.setVariantActiveFile("project-commit", 0, "styles.css");
    store.setVariantFileContent(
      "project-commit",
      0,
      "styles.css",
      "main { color: blue; }"
    );
    store.setCommitCode("project-commit", 0, "<main>Generated update</main>");

    const variant =
      useProjectStore.getState().commits["project-commit"].variants[0];
    expect(variant.activeFilePath).toBe("styles.css");
    expect(variant.files?.["styles.css"].content).toContain("blue");
    expect(variant.files?.["index.html"].content).toBe(
      "<main>Generated update</main>"
    );
    expect(variant.code).toBe("<main>Generated update</main>");
  });
});


describe("project persistence state", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProject();
  });

  it("restores the full project identity, tree, selection, and input state", () => {
    const commit = createGeneratingCommit();
    commit.variants[0] = {
      ...commit.variants[0],
      code: "<main>Restored</main>",
      files: {
        "index.html": createProjectFile("index.html", "<main>Restored</main>"),
        "styles.css": createProjectFile("styles.css", "main { color: navy; }"),
      },
      entryPoint: "index.html",
      activeFilePath: "styles.css",
      status: "complete",
    };

    useProjectStore.getState().restoreProject({
      projectId: "saved-project",
      projectTitle: "Saved project",
      projectCreatedAt: new Date(10_000),
      projectStack: Stack.REACT_TAILWIND,
      inputMode: "text",
      referenceImages: [],
      initialPrompt: "Restore me",
      multiScreenshotMode: "states",
      assetsById: {},
      commits: { [commit.hash]: commit },
      head: commit.hash,
      latestCommitHash: commit.hash,
    });

    const restored = useProjectStore.getState();
    expect(restored.projectId).toBe("saved-project");
    expect(restored.projectStack).toBe(Stack.REACT_TAILWIND);
    expect(restored.head).toBe(commit.hash);
    expect(restored.commits[commit.hash].variants[0].activeFilePath).toBe(
      "styles.css"
    );
    expect(restored.commits[commit.hash].variants[0].files?.["styles.css"].content)
      .toContain("navy");
  });

  it("freezes and cancels unfinished variants when a newer version is added", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(50_000);
    const store = useProjectStore.getState();
    const first = createGeneratingCommit();
    first.hash = "first";
    store.addCommit(first);

    const second = createGeneratingCommit();
    second.hash = "second";
    second.parentHash = "first";
    store.addCommit(second);
    store.updateVariantStatus("first", 0, "complete");

    const committed = useProjectStore.getState().commits.first;
    expect(committed.isCommitted).toBe(true);
    expect(committed.variants[0].status).toBe("cancelled");
    expect(committed.variants[0].completedAt).toBe(50_000);
    now.mockRestore();
  });
});
