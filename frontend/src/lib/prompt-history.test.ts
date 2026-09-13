import {
  buildAssistantHistoryMessage,
  buildUpdateGenerationRequest,
  buildUserHistoryMessage,
  cloneVariantHistory,
  registerAssetIds,
  toRequestHistory,
} from "./prompt-history";
import { Commit } from "../components/commits/types";
import { PromptAsset } from "../types";
import { createProjectFile } from "./project-files";

describe("prompt-history helpers", () => {
  test("cloneVariantHistory deep-copies asset id arrays", () => {
    const source = [
      {
        role: "user" as const,
        text: "Update this",
        imageAssetIds: ["img-1"],
        videoAssetIds: ["vid-1"],
      },
    ];

    const cloned = cloneVariantHistory(source);
    cloned[0].imageAssetIds.push("img-2");
    cloned[0].videoAssetIds.push("vid-2");

    expect(source[0].imageAssetIds).toEqual(["img-1"]);
    expect(source[0].videoAssetIds).toEqual(["vid-1"]);
    expect(cloned[0].imageAssetIds).toEqual(["img-1", "img-2"]);
    expect(cloned[0].videoAssetIds).toEqual(["vid-1", "vid-2"]);
  });

  test("registerAssetIds reuses existing ids and only upserts new assets", () => {
    const assetsById: Record<string, PromptAsset> = {
      existing: { id: "existing", type: "image", dataUrl: "data:image/one" },
    };
    const upsertCalls: PromptAsset[][] = [];

    let idCounter = 0;
    const ids = registerAssetIds(
      "image",
      ["data:image/one", "data:image/two", "data:image/two"],
      () => assetsById,
      (assets) => {
        upsertCalls.push(assets);
        for (const asset of assets) assetsById[asset.id] = asset;
      },
      () => `generated-${++idCounter}`
    );

    expect(ids[0]).toBe("existing");
    expect(ids[1]).toBe(ids[2]);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toHaveLength(1);
    expect(upsertCalls[0][0].type).toBe("image");
    expect(upsertCalls[0][0].dataUrl).toBe("data:image/two");
  });

  test("registerAssetIds ignores blank media strings", () => {
    const upsertCalls: PromptAsset[][] = [];
    const ids = registerAssetIds(
      "video",
      ["", "   "],
      () => ({}),
      (assets) => upsertCalls.push(assets),
      () => "unused"
    );

    expect(ids).toEqual([]);
    expect(upsertCalls).toEqual([]);
  });

  test("toRequestHistory resolves ids and drops missing assets", () => {
    const assetsById: Record<string, PromptAsset> = {
      img1: { id: "img1", type: "image", dataUrl: "data:image/one" },
      vid1: { id: "vid1", type: "video", dataUrl: "data:video/one" },
    };

    const history = [
      {
        role: "user" as const,
        text: "Do this",
        imageAssetIds: ["img1", "img-missing"],
        videoAssetIds: ["vid1", "vid-missing"],
      },
      {
        role: "assistant" as const,
        text: "<html/>",
        imageAssetIds: [],
        videoAssetIds: [],
      },
    ];

    expect(toRequestHistory(history, () => assetsById)).toEqual([
      {
        role: "user",
        text: "Do this",
        images: ["data:image/one"],
        videos: ["data:video/one"],
      },
      {
        role: "assistant",
        text: "<html/>",
        images: [],
        videos: [],
      },
    ]);
  });

  test("message builders produce expected shapes", () => {
    expect(buildUserHistoryMessage("change", ["img"], ["vid"])).toEqual({
      role: "user",
      text: "change",
      imageAssetIds: ["img"],
      videoAssetIds: ["vid"],
    });

    expect(buildAssistantHistoryMessage("<html/>")).toEqual({
      role: "assistant",
      text: "<html/>",
      imageAssetIds: [],
      videoAssetIds: [],
    });
  });

  test("preserves multi-screenshot mode in request history", () => {
    const history = [
      buildUserHistoryMessage("Match these", ["one", "two"], [], "responsive"),
    ];
    const assetsById: Record<string, PromptAsset> = {
      one: { id: "one", type: "image", dataUrl: "data:image/one" },
      two: { id: "two", type: "image", dataUrl: "data:image/two" },
    };

    expect(toRequestHistory(history, () => assetsById)[0]).toMatchObject({
      multiImageMode: "responsive",
    });
  });

  test("buildUpdateGenerationRequest reruns an edit from the selected parent option", () => {
    const parentCommit: Commit = {
      hash: "parent",
      parentHash: null,
      dateCreated: new Date(),
      isCommitted: true,
      type: "ai_create",
      inputs: { text: "Create", images: [] },
      selectedVariantIndex: 1,
      variants: [
        { code: "<html>option one</html>", history: [] },
        {
          code: "<html>option two</html>",
          history: [
            buildUserHistoryMessage("Create"),
            buildAssistantHistoryMessage("<html>option two</html>"),
          ],
        },
      ],
    };
    const assetsById: Record<string, PromptAsset> = {
      editImage: {
        id: "editImage",
        type: "image",
        dataUrl: "data:image/edit",
      },
    };

    const request = buildUpdateGenerationRequest({
      inputMode: "image",
      prompt: {
        text: "Make it red",
        fullText: "Make the selected button red",
        images: ["data:image/edit"],
        videos: [],
        selectedElementHtml: "<button>Option two</button>",
      },
      parentCommit,
      imageAssetIds: ["editImage"],
      getAssetsById: () => assetsById,
    });

    expect(request.fileState?.content).toBe("<html>option two</html>");
    expect(request.optionCodes).toEqual([
      "<html>option one</html>",
      "<html>option two</html>",
    ]);
    expect(request.variantHistory[request.variantHistory.length - 1]).toEqual(
      buildUserHistoryMessage("Make the selected button red", ["editImage"])
    );
    expect(request.history?.[request.history.length - 1]).toEqual({
      role: "user",
      text: "Make the selected button red",
      images: ["data:image/edit"],
      videos: [],
    });
  });

  test("buildUpdateGenerationRequest uses option 3 history in a larger variant set", () => {
    const parentCommit: Commit = {
      hash: "parent-many",
      parentHash: null,
      dateCreated: new Date(),
      isCommitted: true,
      type: "ai_create",
      inputs: { text: "Create", images: [] },
      selectedVariantIndex: 2,
      variants: [
        {
          code: "<html>option one</html>",
          history: [
            buildUserHistoryMessage("Create option one"),
            buildAssistantHistoryMessage("<html>option one</html>"),
          ],
          status: "complete",
        },
        {
          code: "<html>option two</html>",
          history: [
            buildUserHistoryMessage("Create option two"),
            buildAssistantHistoryMessage("<html>option two</html>"),
          ],
          status: "complete",
        },
        {
          code: "<html>option three</html>",
          history: [
            buildUserHistoryMessage("Create option three"),
            buildAssistantHistoryMessage("<html>option three</html>"),
          ],
          status: "complete",
        },
        {
          code: "<html>option four</html>",
          history: [
            buildUserHistoryMessage("Create option four"),
            buildAssistantHistoryMessage("<html>option four</html>"),
          ],
          status: "complete",
        },
      ],
    };

    const request = buildUpdateGenerationRequest({
      inputMode: "text",
      prompt: { text: "Add a footer", images: [], videos: [] },
      parentCommit,
      imageAssetIds: [],
      getAssetsById: () => ({}),
    });

    expect(request.fileState?.content).toBe("<html>option three</html>");
    expect(request.optionCodes).toEqual([
      "<html>option one</html>",
      "<html>option two</html>",
      "<html>option three</html>",
      "<html>option four</html>",
    ]);
    expect(request.history?.map((message) => message.text)).toEqual([
      "Create option three",
      "<html>option three</html>",
      "Add a footer",
    ]);
    expect(request.variantHistory.map((message) => message.text)).toEqual([
      "Create option three",
      "<html>option three</html>",
      "Add a footer",
    ]);
  });

  test("targets a multi-file project's explicit entry and keeps option sources aligned", () => {
    const parentCommit: Commit = {
      hash: "multi-file-parent",
      parentHash: null,
      dateCreated: new Date(),
      isCommitted: true,
      type: "code_create",
      inputs: null,
      selectedVariantIndex: 0,
      variants: [
        {
          code: "<div id=\"root\"></div>",
          entryPoint: "src/App.tsx",
          files: {
            "index.html": createProjectFile(
              "index.html",
              '<div id="root"></div>'
            ),
            "src/App.tsx": createProjectFile(
              "src/App.tsx",
              "export const App = () => <main>One</main>;"
            ),
          },
          history: [],
        },
        {
          code: "<div id=\"root\"></div>",
          entryPoint: "src/App.tsx",
          files: {
            "index.html": createProjectFile(
              "index.html",
              '<div id="root"></div>'
            ),
            "src/App.tsx": createProjectFile(
              "src/App.tsx",
              "export const App = () => <main>Two</main>;"
            ),
          },
          history: [],
        },
      ],
    };

    const request = buildUpdateGenerationRequest({
      inputMode: "text",
      prompt: { text: "Add a footer", images: [], videos: [] },
      parentCommit,
      imageAssetIds: [],
      getAssetsById: () => ({}),
    });

    expect(request.fileState).toEqual({
      path: "src/App.tsx",
      content: "export const App = () => <main>One</main>;",
    });
    expect(request.optionCodes).toEqual([
      "export const App = () => <main>One</main>;",
      "export const App = () => <main>Two</main>;",
    ]);
    expect(request.history).toEqual([]);
  });

  test("replays an explicit multi-file target and media history", () => {
    const parentCommit: Commit = {
      hash: "multi-file-retry-parent",
      parentHash: null,
      dateCreated: new Date(),
      isCommitted: true,
      type: "ai_create",
      inputs: { text: "Create", images: [] },
      selectedVariantIndex: 1,
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
            "styles.css": createProjectFile("styles.css", "main { color: blue; }"),
          },
          history: [buildUserHistoryMessage("Create option two")],
        },
      ],
    };
    const assetsById: Record<string, PromptAsset> = {
      image: { id: "image", type: "image", dataUrl: "data:image/retry" },
      video: { id: "video", type: "video", dataUrl: "data:video/retry" },
    };

    const request = buildUpdateGenerationRequest({
      inputMode: "image",
      prompt: {
        text: "Restyle",
        images: ["data:image/retry"],
        videos: ["data:video/retry"],
        multiImageMode: "references",
      },
      parentCommit,
      parentVariantIndex: 1,
      generationTargetPath: "styles.css",
      imageAssetIds: ["image"],
      videoAssetIds: ["video"],
      getAssetsById: () => assetsById,
    });

    expect(request.fileState).toEqual({
      path: "styles.css",
      content: "main { color: blue; }",
    });
    expect(request.optionCodes).toEqual([
      "main { color: red; }",
      "main { color: blue; }",
    ]);
    expect(request.variantHistory.at(-1)).toEqual(
      buildUserHistoryMessage("Restyle", ["image"], ["video"], "references")
    );
  });

  test("buildUpdateGenerationRequest bootstraps imported code without history", () => {
    const parentCommit: Commit = {
      hash: "import",
      parentHash: null,
      dateCreated: new Date(),
      isCommitted: true,
      type: "code_create",
      inputs: null,
      selectedVariantIndex: 0,
      variants: [{ code: "<html>imported</html>", history: [] }],
    };

    const request = buildUpdateGenerationRequest({
      inputMode: "image",
      prompt: { text: "Add a footer", images: [], videos: [] },
      parentCommit,
      imageAssetIds: [],
      getAssetsById: () => ({}),
    });

    expect(request.history).toEqual([]);
    expect(request.fileState?.content).toBe("<html>imported</html>");
  });
});
