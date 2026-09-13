import type { Commit } from "../components/commits/types";
import { createProjectFile } from "./project-files";
import { Stack } from "./stacks";
import {
  buildHistoryProjectSnapshot,
  buildHistorySelectionUpdate,
  commitToHistoryVersion,
  deriveProjectTitle,
  INTERRUPTED_GENERATION_MESSAGE,
  restoreHistoryProject,
  toRecentHistoryProject,
  type ProjectHistorySnapshotState,
} from "./project-history";
import type {
  HistoryCommit,
  HistoryProject,
  HistoryProjectSnapshotRequest,
  HistoryTimestampInput,
  HistoryVersionInput,
} from "./history-types";

const createdAt = new Date("2026-09-12T20:00:00.000Z");
const restoredAt = new Date("2026-09-13T01:00:00.000Z").getTime();
const imageDataUrl = "data:image/png;base64,AAAA";

function asDate(value: HistoryTimestampInput | null | undefined): Date {
  return value instanceof Date
    ? value
    : new Date(value ?? createdAt.toISOString());
}

function historyCommit(version: HistoryVersionInput): HistoryCommit {
  return {
    id: version.id,
    commitHash: version.commitHash ?? null,
    parentCommitId: version.parentCommitId ?? null,
    retryOfCommitId: version.retryOfCommitId ?? null,
    versionType: version.versionType ?? "create",
    inputs: version.inputs ?? {},
    promptMetadata: version.promptMetadata ?? {},
    metadata: version.metadata ?? {},
    createdAt: asDate(version.createdAt),
    prompts: (version.prompts ?? []).map((prompt, position) => ({
      id: prompt.id ?? `${version.id}:prompt:${position}`,
      position,
      role: prompt.role ?? "user",
      kind: prompt.kind ?? "generation",
      content: prompt.content,
      metadata: prompt.metadata ?? {},
      createdAt: asDate(prompt.createdAt),
    })),
    variants: (version.variants ?? []).map((variant) => ({
      index: variant.index,
      model: variant.model ?? null,
      status: variant.status ?? "complete",
      code: variant.code ?? null,
      currentContent: variant.currentContent ?? null,
      createdAt: asDate(variant.createdAt),
      startedAt: variant.startedAt ? asDate(variant.startedAt) : null,
      completedAt: variant.completedAt ? asDate(variant.completedAt) : null,
      durationMs: variant.durationMs ?? null,
      error: variant.error ?? null,
      metadata: variant.metadata ?? {},
      projectData: variant.projectData,
      messages: (variant.messages ?? []).map((message, position) => ({
        id: message.id ?? `${version.id}:${variant.index}:message:${position}`,
        position,
        role: message.role,
        content: message.content ?? null,
        media: message.media ?? [],
        metadata: message.metadata ?? {},
        createdAt: asDate(message.createdAt),
      })),
    })),
    childCommitIds: [],
  };
}

function stateFixture(): ProjectHistorySnapshotState {
  const root: Commit = {
    hash: "root",
    parentHash: null,
    dateCreated: createdAt,
    isCommitted: true,
    selectedVariantIndex: 0,
    type: "ai_create",
    inputs: {
      text: "Build a dashboard",
      images: [imageDataUrl],
      videos: [],
      multiImageMode: "pages",
    },
    variants: [
      {
        code: "<main>Root</main>",
        files: {
          "index.html": createProjectFile("index.html", "<main>Root</main>"),
          "styles/site.css": createProjectFile(
            "styles/site.css",
            "main { color: navy; }"
          ),
        },
        entryPoint: "index.html",
        activeFilePath: "styles/site.css",
        history: [
          {
            role: "user",
            text: "Build a dashboard",
            imageAssetIds: ["asset-image"],
            videoAssetIds: [],
            multiImageMode: "pages",
          },
          {
            role: "assistant",
            text: "<main>Root</main>",
            imageAssetIds: [],
            videoAssetIds: [],
          },
        ],
        requestStartedAt: createdAt.getTime(),
        completedAt: createdAt.getTime() + 1_000,
        status: "complete",
        model: "model-root",
        stack: Stack.REACT_TAILWIND,
      },
    ],
  };
  const draft: Commit = {
    hash: "draft",
    parentHash: "root",
    retryOfHash: null,
    dateCreated: new Date(createdAt.getTime() + 2_000),
    isCommitted: false,
    selectedVariantIndex: 0,
    type: "ai_edit",
    inputs: {
      text: "Add a chart",
      images: [imageDataUrl],
      videos: [],
    },
    variants: [
      {
        code: "<main>Partial chart</main>",
        files: {
          "index.html": createProjectFile(
            "index.html",
            "<main>Partial chart</main>"
          ),
          "src/chart.ts": createProjectFile(
            "src/chart.ts",
            "export const chart = true;"
          ),
        },
        entryPoint: "index.html",
        activeFilePath: "src/chart.ts",
        generationTargetPath: "src/chart.ts",
        history: [
          {
            role: "user",
            text: "Add a chart",
            imageAssetIds: ["asset-image"],
            videoAssetIds: [],
          },
        ],
        requestStartedAt: createdAt.getTime() + 2_000,
        status: "generating",
        model: "model-a",
        stack: Stack.REACT_TAILWIND,
        agentEvents: [
          {
            id: "thinking-1",
            type: "thinking",
            status: "running",
            content: "Planning",
            startedAt: createdAt.getTime() + 2_000,
          },
        ],
      },
      {
        code: "",
        history: [],
        requestStartedAt: createdAt.getTime() + 2_000,
        completedAt: createdAt.getTime() + 2_500,
        status: "error",
        errorMessage: "Model failed",
        model: "model-b",
        stack: Stack.REACT_TAILWIND,
      },
    ],
  };

  return {
    projectId: "project-1",
    projectTitle: "Dashboard",
    projectCreatedAt: createdAt,
    projectStack: Stack.REACT_TAILWIND,
    inputMode: "image",
    referenceImages: [imageDataUrl],
    initialPrompt: "Build a dashboard",
    multiScreenshotMode: "pages",
    assetsById: {
      "asset-image": {
        id: "asset-image",
        type: "image",
        dataUrl: imageDataUrl,
      },
    },
    commits: { root, draft },
    head: "draft",
    latestCommitHash: "draft",
  };
}

function projectFromSnapshot(
  snapshot: HistoryProjectSnapshotRequest
): HistoryProject {
  const version = snapshot.version;
  return {
    id: "project-1",
    title: snapshot.title,
    stack: snapshot.stack ?? null,
    inputMode: snapshot.inputMode ?? null,
    metadata: snapshot.metadata ?? {},
    createdAt,
    updatedAt: new Date(createdAt.getTime() + 3_000),
    headCommitId: version?.id ?? null,
    selectedCommitId: null,
    selectedVariantIndex: null,
    commitCount: version ? 1 : 0,
    variantCount: version?.variants?.length ?? 0,
    rootCommitIds: version ? [version.id] : [],
    commits: version ? [historyCommit(version)] : [],
  };
}

describe("project history adapters", () => {
  it("persists immutable versions and one mutable draft without repeating media data", () => {
    const state = stateFixture();
    const snapshot = buildHistoryProjectSnapshot(state, state.commits.root);
    const serialized = JSON.stringify(snapshot);

    expect((serialized.match(/data:image\/png;base64,AAAA/g) ?? []).length).toBe(1);
    expect(snapshot.version?.parentCommitId).toBeNull();
    expect(snapshot.version?.variants?.[0].projectData).toEqual(
      expect.objectContaining({
        entryPoint: "index.html",
        activeFilePath: "styles/site.css",
      })
    );
    expect(snapshot.version?.variants?.[0].messages?.[0].media).toEqual([
      { asset_id: "asset-image", type: "image" },
    ]);
    expect(snapshot.metadata).toEqual(
      expect.objectContaining({
        shot2code: expect.objectContaining({
          latest_commit_hash: "draft",
          selected_commit_hash: "draft",
          draft_commit: expect.objectContaining({ hash: "draft" }),
        }),
      })
    );
  });

  it("restores a complete tree, active file, chat, and failed or partial variants", () => {
    const state = stateFixture();
    const snapshot = buildHistoryProjectSnapshot(state, state.commits.root);
    const restored = restoreHistoryProject(projectFromSnapshot(snapshot), {
      restoredAt,
    });

    expect(Object.keys(restored.commits)).toEqual(["root", "draft"]);
    expect(restored.commits.root.isCommitted).toBe(true);
    expect(restored.commits.draft.isCommitted).toBe(false);
    expect(restored.head).toBe("draft");
    expect(restored.latestCommitHash).toBe("draft");
    expect(restored.projectStack).toBe(Stack.REACT_TAILWIND);
    expect(restored.inputMode).toBe("image");
    expect(restored.referenceImages).toEqual([imageDataUrl]);
    expect(restored.commits.root.variants[0].files?.["styles/site.css"].content)
      .toContain("navy");
    expect(restored.commits.draft.variants[0].activeFilePath).toBe("src/chart.ts");
    expect(restored.commits.draft.variants[0].history[0]).toEqual(
      expect.objectContaining({
        text: "Add a chart",
        imageAssetIds: ["asset-image"],
      })
    );
    expect(restored.commits.draft.variants[0]).toEqual(
      expect.objectContaining({
        status: "cancelled",
        completedAt: restoredAt,
        errorMessage: INTERRUPTED_GENERATION_MESSAGE,
      })
    );
    expect(restored.commits.draft.variants[0].agentEvents?.[0]).toEqual(
      expect.objectContaining({ status: "error", endedAt: restoredAt })
    );
    expect(restored.commits.draft.variants[1]).toEqual(
      expect.objectContaining({ status: "error", errorMessage: "Model failed" })
    );
    expect(restored.interruptedGeneration).toBe(true);
  });

  it("maps persisted selection only to immutable versions", () => {
    const state = stateFixture();
    expect(buildHistorySelectionUpdate(state, new Set(["root"]))).toEqual({
      headCommitId: "root",
      selectedCommitId: null,
      selectedVariantIndex: null,
    });

    state.head = "root";
    expect(buildHistorySelectionUpdate(state, new Set(["root"]))).toEqual({
      headCommitId: "root",
      selectedCommitId: "root",
      selectedVariantIndex: 0,
    });
  });

  it("serializes retry ancestry and replay context", () => {
    const state = stateFixture();
    const retry = state.commits.draft;
    retry.retryOfHash = "root";
    retry.generationContext = {
      inputMode: "image",
      stack: Stack.REACT_TAILWIND,
      selectedModels: ["copilot/model-a", "copilot/model-b"],
      isAssetExtractionEnabled: false,
      designSystem: "Frozen context",
      baseCommitHash: "root",
      baseVariantIndex: 0,
    };
    const version = commitToHistoryVersion(retry, state);

    expect(version.versionType).toBe("retry");
    expect(version.parentCommitId).toBe("root");
    expect(version.retryOfCommitId).toBe("root");
    expect(version.metadata).toEqual(
      expect.objectContaining({
        generation_context: {
          input_mode: "image",
          stack: Stack.REACT_TAILWIND,
          selected_models: ["copilot/model-a", "copilot/model-b"],
          is_asset_extraction_enabled: false,
          design_system: "Frozen context",
          base_commit_hash: "root",
          base_variant_index: 0,
        },
      })
    );
  });

  it("restores failed sources and retry drafts with ancestry after restart", () => {
    const state = stateFixture();
    const root = state.commits.root;
    const source = state.commits.draft;
    source.hash = "failed-source";
    source.isCommitted = true;
    source.variants[0].status = "error";
    source.variants[0].errorMessage = "source failed";
    source.variants[0].completedAt = createdAt.getTime() + 2_500;
    const retry: Commit = {
      ...source,
      hash: "retry-draft",
      parentHash: source.hash,
      retryOfHash: source.hash,
      generationContext: {
        inputMode: "image",
        stack: Stack.REACT_TAILWIND,
        selectedModels: ["copilot/model-a"],
        designSystem: "Frozen context",
        baseCommitHash: root.hash,
        baseVariantIndex: 0,
      },
      dateCreated: new Date(createdAt.getTime() + 4_000),
      isCommitted: false,
      variants: source.variants.map((variant) => ({
        ...variant,
        files: variant.files ? { ...variant.files } : undefined,
        history: variant.history.map((message) => ({
          ...message,
          imageAssetIds: [...message.imageAssetIds],
          videoAssetIds: [...message.videoAssetIds],
        })),
        status: "error",
        errorMessage: "retry failed",
      })),
    };
    state.commits = {
      [root.hash]: root,
      [source.hash]: source,
      [retry.hash]: retry,
    };
    state.head = retry.hash;
    state.latestCommitHash = retry.hash;

    const snapshot = buildHistoryProjectSnapshot(state, root);
    const project = projectFromSnapshot(snapshot);
    project.commits = [
      historyCommit(commitToHistoryVersion(root, state)),
      historyCommit(commitToHistoryVersion(source, state)),
    ];
    project.commitCount = 2;
    project.variantCount = root.variants.length + source.variants.length;
    project.headCommitId = source.hash;

    const restored = restoreHistoryProject(project, { restoredAt });

    expect(Object.keys(restored.commits)).toEqual([
      root.hash,
      source.hash,
      retry.hash,
    ]);
    expect(restored.head).toBe(retry.hash);
    expect(restored.latestCommitHash).toBe(retry.hash);
    expect(restored.commits[source.hash]).toEqual(
      expect.objectContaining({
        parentHash: root.hash,
        retryOfHash: null,
      })
    );
    expect(restored.commits[source.hash].variants[0]).toEqual(
      expect.objectContaining({
        status: "error",
        errorMessage: "source failed",
      })
    );
    expect(restored.commits[retry.hash]).toEqual(
      expect.objectContaining({
        parentHash: source.hash,
        retryOfHash: source.hash,
        generationContext: expect.objectContaining({
          baseCommitHash: root.hash,
          baseVariantIndex: 0,
          selectedModels: ["copilot/model-a"],
        }),
      })
    );
    expect(restored.commits[retry.hash].variants[0].history).toEqual(
      retry.variants[0].history
    );
  });

  it("counts the mutable draft in recent-project summaries", () => {
    const state = stateFixture();
    const summary = projectFromSnapshot(
      buildHistoryProjectSnapshot(state, state.commits.root)
    );
    expect(toRecentHistoryProject(summary).versionCount).toBe(2);
  });

  it("derives compact titles for prompts and media-only projects", () => {
    expect(
      deriveProjectTitle({
        prompt: "  Build   a focused dashboard  ",
        inputMode: "text",
      })
    ).toBe("Build a focused dashboard");
    expect(
      deriveProjectTitle({ inputMode: "image", referenceCount: 3 })
    ).toBe("3 screenshot project");
  });
});
