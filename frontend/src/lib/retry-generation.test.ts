jest.mock("nanoid", () => {
  let counter = 0;
  return { nanoid: () => `retry-id-${++counter}` };
});

import type { Commit } from "../components/commits/types";
import { createCommit } from "../components/commits/utils";
import type { PromptAsset, PromptAssetType } from "../types";
import { createProjectFile } from "./project-files";
import {
  buildAssistantHistoryMessage,
  buildUserHistoryMessage,
  registerAssetIds,
} from "./prompt-history";
import {
  buildRetryGenerationPlan,
  shouldRetainGenerationAttempt,
} from "./retry-generation";
import { Stack } from "./stacks";

function assetRegistry() {
  const assets: Record<string, PromptAsset> = {};
  let counter = 0;
  return {
    getAssetsById: () => assets,
    registerAssets: (type: PromptAssetType, dataUrls: string[]) =>
      registerAssetIds(
        type,
        dataUrls,
        () => assets,
        (newAssets) => {
          newAssets.forEach((asset) => {
            assets[asset.id] = asset;
          });
        },
        () => `asset-${++counter}`
      ),
  };
}

function createSourceCommit(): Commit {
  return {
    hash: "create-source",
    parentHash: null,
    retryOfHash: null,
    generationContext: {
      inputMode: "image",
      stack: Stack.REACT_TAILWIND,
      selectedModels: ["copilot/model-a", "copilot/model-b"],
      isAssetExtractionEnabled: true,
      designSystem: "Original design context",
      baseCommitHash: null,
      baseVariantIndex: null,
    },
    dateCreated: new Date("2026-09-13T00:00:00.000Z"),
    isCommitted: true,
    selectedVariantIndex: 1,
    type: "ai_create",
    inputs: {
      text: "Match both screenshots",
      images: ["data:image/one", "data:image/two"],
      videos: [],
      multiImageMode: "responsive",
    },
    variants: [
      {
        code: "<main>partial</main>",
        history: [
          buildUserHistoryMessage("Match both screenshots", ["old-one", "old-two"]),
        ],
        status: "error",
        errorMessage: "source failed",
        model: "copilot/model-a",
        stack: Stack.REACT_TAILWIND,
      },
      {
        code: "<main>complete</main>",
        history: [
          buildUserHistoryMessage("Match both screenshots", ["old-one", "old-two"]),
          buildAssistantHistoryMessage("<main>complete</main>"),
        ],
        status: "complete",
        model: "copilot/model-b",
        stack: Stack.REACT_TAILWIND,
      },
    ],
  };
}

function createMultiFileRoot(): Commit {
  return {
    hash: "root",
    parentHash: null,
    dateCreated: new Date("2026-09-13T00:00:00.000Z"),
    isCommitted: true,
    selectedVariantIndex: 0,
    type: "ai_create",
    inputs: { text: "Create the app", images: [], videos: [] },
    variants: [
      {
        code: '<div id="root"></div>',
        files: {
          "index.html": createProjectFile("index.html", '<div id="root"></div>'),
          "src/App.tsx": createProjectFile(
            "src/App.tsx",
            "export const App = () => <main>Option one</main>;"
          ),
        },
        entryPoint: "src/App.tsx",
        activeFilePath: "src/App.tsx",
        history: [
          buildUserHistoryMessage("Create option one"),
          buildAssistantHistoryMessage("Option one response"),
        ],
        status: "complete",
      },
      {
        code: '<div id="root"></div>',
        files: {
          "index.html": createProjectFile("index.html", '<div id="root"></div>'),
          "src/App.tsx": createProjectFile(
            "src/App.tsx",
            "export const App = () => <main>Option two</main>;"
          ),
          "src/theme.css": createProjectFile(
            "src/theme.css",
            ":root { color: navy; }"
          ),
        },
        entryPoint: "src/App.tsx",
        activeFilePath: "src/theme.css",
        history: [
          buildUserHistoryMessage("Create option two"),
          buildAssistantHistoryMessage("Option two response"),
        ],
        status: "complete",
      },
    ],
  };
}

function createFailedEdit(): Commit {
  return {
    hash: "failed-edit",
    parentHash: "root",
    retryOfHash: null,
    generationContext: {
      inputMode: "image",
      stack: Stack.REACT_TAILWIND,
      selectedModels: ["copilot/model-c"],
      designSystem: "Frozen edit context",
      baseCommitHash: "root",
      baseVariantIndex: 1,
    },
    dateCreated: new Date("2026-09-13T00:01:00.000Z"),
    isCommitted: true,
    selectedVariantIndex: 0,
    type: "ai_edit",
    inputs: {
      text: "Make the chart red",
      fullText: "Make the selected chart red",
      images: ["data:image/edit"],
      videos: [],
      selectedElementHtml: '<section id="chart"></section>',
    },
    variants: [
      {
        code: '<div id="root"></div>',
        files: {
          "index.html": createProjectFile("index.html", '<div id="root"></div>'),
          "src/App.tsx": createProjectFile(
            "src/App.tsx",
            "export const App = () => <main>Partial red chart</main>;"
          ),
          "src/theme.css": createProjectFile(
            "src/theme.css",
            ":root { color: navy; }"
          ),
        },
        entryPoint: "src/App.tsx",
        activeFilePath: "src/App.tsx",
        generationTargetPath: "src/App.tsx",
        history: [
          buildUserHistoryMessage("Create option two"),
          buildAssistantHistoryMessage("Option two response"),
          buildUserHistoryMessage("Make the selected chart red", ["edit-old"]),
        ],
        status: "error",
        errorMessage: "provider unavailable",
        model: "copilot/model-c",
        stack: Stack.REACT_TAILWIND,
      },
    ],
  };
}

describe("retry generation planning", () => {
  it("replays create inputs and creates distinct descendants without mutating the source", () => {
    const source = createSourceCommit();
    const before = JSON.stringify(source);
    const registry = assetRegistry();
    const options = {
      sourceCommit: source,
      commits: { [source.hash]: source },
      fallbackInputMode: "text" as const,
      fallbackStack: Stack.HTML_TAILWIND,
      fallbackDesignSystem: "Current context",
      ...registry,
    };

    const firstPlan = buildRetryGenerationPlan(options);
    const secondPlan = buildRetryGenerationPlan(options);
    const firstCommit = createCommit({
      type: "ai_create",
      parentHash: firstPlan.commitParentHash,
      retryOfHash: firstPlan.retryOfHash,
      generationContext: firstPlan.generationContext,
      selectedVariantIndex: firstPlan.selectedVariantIndex,
      inputs: firstPlan.request.prompt,
      variants: firstPlan.initialVariantModels.map((model) => ({
        code: "",
        history: firstPlan.request.variantHistory,
        model,
      })),
    });
    const secondCommit = createCommit({
      type: "ai_create",
      parentHash: secondPlan.commitParentHash,
      retryOfHash: secondPlan.retryOfHash,
      generationContext: secondPlan.generationContext,
      selectedVariantIndex: secondPlan.selectedVariantIndex,
      inputs: secondPlan.request.prompt,
      variants: secondPlan.initialVariantModels.map((model) => ({
        code: "",
        history: secondPlan.request.variantHistory,
        model,
      })),
    });

    expect(firstCommit.hash).not.toBe(secondCommit.hash);
    expect(firstCommit.parentHash).toBe(source.hash);
    expect(firstCommit.retryOfHash).toBe(source.hash);
    expect(secondCommit.parentHash).toBe(source.hash);
    expect(secondCommit.retryOfHash).toBe(source.hash);
    expect(firstPlan.request).toMatchObject({
      generationType: "create",
      inputMode: "image",
      prompt: {
        text: "Match both screenshots",
        images: ["data:image/one", "data:image/two"],
        multiImageMode: "responsive",
      },
      isAssetExtractionEnabled: true,
      retryModels: ["copilot/model-a", "copilot/model-b"],
    });
    expect(firstPlan.request.variantHistory).toEqual([
      expect.objectContaining({
        role: "user",
        text: "Match both screenshots",
        multiImageMode: "responsive",
      }),
    ]);
    expect(firstPlan.generationContext).toEqual(
      expect.objectContaining({
        stack: Stack.REACT_TAILWIND,
        selectedModels: ["copilot/model-a", "copilot/model-b"],
        designSystem: "Original design context",
      })
    );
    expect(firstPlan.initialVariantModels).toEqual([
      "copilot/model-a",
      "copilot/model-b",
    ]);
    expect(firstPlan.selectedVariantIndex).toBe(1);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("replays a failed multi-file edit from its original base option and retains option history", () => {
    const root = createMultiFileRoot();
    const source = createFailedEdit();
    const before = JSON.stringify(source);
    const registry = assetRegistry();

    const plan = buildRetryGenerationPlan({
      sourceCommit: source,
      commits: { root, [source.hash]: source },
      fallbackInputMode: "text",
      fallbackStack: Stack.HTML_TAILWIND,
      fallbackDesignSystem: "Current context",
      ...registry,
    });

    expect(plan.commitParentHash).toBe(source.hash);
    expect(plan.retryOfHash).toBe(source.hash);
    expect(plan.generationBaseHash).toBe(root.hash);
    expect(plan.generationBaseVariantIndex).toBe(1);
    expect(plan.request).toMatchObject({
      generationType: "update",
      inputMode: "image",
      prompt: {
        text: "Make the chart red",
        images: ["data:image/edit"],
      },
      fileState: {
        path: "src/App.tsx",
        content: "export const App = () => <main>Option two</main>;",
      },
      optionCodes: [
        "export const App = () => <main>Option one</main>;",
        "export const App = () => <main>Option two</main>;",
      ],
      retryModels: ["copilot/model-c"],
    });
    expect(plan.request.history?.map((message) => message.text)).toEqual([
      "Create option two",
      "Option two response",
      "Make the selected chart red",
    ]);
    expect(plan.request.variantHistory.map((message) => message.text)).toEqual([
      "Create option two",
      "Option two response",
      "Make the selected chart red",
    ]);
    expect(plan.generationContext).toEqual(
      expect.objectContaining({
        baseCommitHash: root.hash,
        baseVariantIndex: 1,
        stack: Stack.REACT_TAILWIND,
        selectedModels: ["copilot/model-c"],
      })
    );
    expect(JSON.stringify(source)).toBe(before);
  });

  it("retains failed or cancelled retry attempts instead of rolling them back", () => {
    const source = createFailedEdit();
    const retry: Commit = {
      ...source,
      hash: "retry-failure",
      parentHash: source.hash,
      retryOfHash: source.hash,
      isCommitted: false,
    };

    expect(shouldRetainGenerationAttempt(retry, "request_failed")).toBe(true);
    expect(shouldRetainGenerationAttempt(retry, "connection_error")).toBe(true);
    expect(shouldRetainGenerationAttempt(retry, "user_cancelled")).toBe(true);
    expect(shouldRetainGenerationAttempt(source, "request_failed")).toBe(false);
  });

  it("keeps replay context when retrying a retry while linking to the immediate source", () => {
    const root = createMultiFileRoot();
    const original = createFailedEdit();
    const retry: Commit = {
      ...original,
      hash: "retry-1",
      parentHash: original.hash,
      retryOfHash: original.hash,
      generationContext: {
        ...original.generationContext!,
        selectedModels: [...original.generationContext!.selectedModels],
      },
      dateCreated: new Date("2026-09-13T00:02:00.000Z"),
    };
    const registry = assetRegistry();

    const plan = buildRetryGenerationPlan({
      sourceCommit: retry,
      commits: {
        root,
        [original.hash]: original,
        [retry.hash]: retry,
      },
      fallbackInputMode: "text",
      fallbackStack: Stack.HTML_TAILWIND,
      ...registry,
    });

    expect(plan.commitParentHash).toBe(retry.hash);
    expect(plan.retryOfHash).toBe(retry.hash);
    expect(plan.generationBaseHash).toBe(root.hash);
    expect(plan.generationBaseVariantIndex).toBe(1);
    expect(plan.request.fileState?.content).toContain("Option two");
  });
});

describe("retry model provenance", () => {
  it("replays the exact models the source options ran on", () => {
    const source = createSourceCommit();
    source.variants[0].model = "gpt-5.5 (high thinking)";
    source.variants[1].model = "claude-opus-5 (max effort)";

    const plan = buildRetryGenerationPlan({
      sourceCommit: source,
      commits: { [source.hash]: source },
      fallbackInputMode: "image",
      fallbackStack: Stack.HTML_TAILWIND,
      ...assetRegistry(),
    });

    expect(plan.request.retryModels).toEqual([
      "gpt-5.5 (high thinking)",
      "claude-opus-5 (max effort)",
    ]);
    expect(plan.initialVariantModels).toEqual([
      "gpt-5.5 (high thinking)",
      "claude-opus-5 (max effort)",
    ]);
  });

  it("recovers a mixed-provider selection when no context was stored", () => {
    const source = createSourceCommit();
    delete source.generationContext;
    source.variants[0].model = "gpt-5.5 (high thinking)";
    source.variants[1].model = "copilot/claude-opus-5";

    const plan = buildRetryGenerationPlan({
      sourceCommit: source,
      commits: { [source.hash]: source },
      fallbackInputMode: "image",
      fallbackStack: Stack.HTML_TAILWIND,
      ...assetRegistry(),
    });

    expect(plan.generationContext.selectedModels).toEqual([
      "gpt-5.5 (high thinking)",
      "copilot/claude-opus-5",
    ]);
  });

  it("skips options that never recorded a model", () => {
    const source = createSourceCommit();
    delete source.generationContext;
    source.variants[0].model = undefined;
    source.variants[1].model = "gemini-3.6-flash (low thinking)";

    const plan = buildRetryGenerationPlan({
      sourceCommit: source,
      commits: { [source.hash]: source },
      fallbackInputMode: "image",
      fallbackStack: Stack.HTML_TAILWIND,
      ...assetRegistry(),
    });

    expect(plan.generationContext.selectedModels).toEqual([
      "gemini-3.6-flash (low thinking)",
    ]);
    // A partial lineup cannot be replayed exactly, so the backend re-selects.
    expect(plan.request.retryModels).toBeUndefined();
  });

  it("prefers the stored generation context over the option models", () => {
    const source = createSourceCommit();

    const plan = buildRetryGenerationPlan({
      sourceCommit: source,
      commits: { [source.hash]: source },
      fallbackInputMode: "image",
      fallbackStack: Stack.HTML_TAILWIND,
      ...assetRegistry(),
    });

    expect(plan.generationContext.selectedModels).toEqual([
      "copilot/model-a",
      "copilot/model-b",
    ]);
  });
});
