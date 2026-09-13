import {
  HISTORY_PROJECT_DATA_METADATA_KEY,
  HistoryPayloadError,
  parseHistoryProject,
  parseHistoryProjectData,
  serializeHistoryAppendVersionRequest,
  serializeHistoryProjectData,
  serializeHistoryProjectSnapshotRequest,
  serializeHistorySelectionUpdateRequest,
  serializeHistoryVariantInput,
  serializeHistoryVersionInput,
} from "./history-serialization";
import type {
  HistoryProjectData,
  HistoryProjectSnapshotRequest,
} from "./history-types";

const timestamp = "2026-09-12T20:00:00.000Z";

function projectData(): HistoryProjectData {
  return {
    entryPoint: "src/App.tsx",
    activeFilePath: "src/styles.css",
    generationTargetPath: "src/App.tsx",
    files: {
      "src/App.tsx": {
        path: "src/App.tsx",
        content: "export const App = () => <main>Hello</main>;",
        language: "tsx",
        type: "script",
        generated: true,
        metadata: { framework: "react" },
      },
      "src/styles.css": {
        path: "src/styles.css",
        content: "main { color: rebeccapurple; }",
        language: "css",
        type: "style",
      },
    },
  };
}

function projectResponse() {
  const encodedProject = serializeHistoryProjectData(projectData());
  return {
    id: "project-1",
    title: "Landing page",
    stack: "react_tailwind",
    input_mode: "image",
    metadata: {
      assets_by_id: {
        "asset-1": {
          id: "asset-1",
          type: "image",
          data_url: "data:image/png;base64,AAAA",
        },
      },
    },
    created_at: timestamp,
    updated_at: "2026-09-12T20:02:00+00:00",
    head_commit_id: "retry-1",
    selected_commit_id: "root",
    selected_variant_index: 0,
    commit_count: 2,
    variant_count: 2,
    root_commit_ids: ["root"],
    commits: [
      {
        id: "root",
        commit_hash: "hash-root",
        parent_commit_id: null,
        retry_of_commit_id: null,
        version_type: "create",
        inputs: { asset_ids: ["asset-1"] },
        prompt_metadata: { temperature: 0.2 },
        metadata: { source: "generation" },
        created_at: timestamp,
        prompts: [
          {
            id: "prompt-root",
            position: 0,
            role: "user",
            kind: "generation",
            content: { text: "Build it", asset_ids: ["asset-1"] },
            metadata: { sequence: 1 },
            created_at: timestamp,
          },
        ],
        variants: [
          {
            index: 0,
            model: "gpt-test",
            status: "completed",
            code: "<main>Hello</main>",
            current_content: "<main>Hello</main>",
            created_at: timestamp,
            started_at: timestamp,
            completed_at: "2026-09-12T20:00:01Z",
            duration_ms: 1000,
            error: null,
            metadata: {
              quality: "selected",
              [HISTORY_PROJECT_DATA_METADATA_KEY]: encodedProject,
            },
            messages: [
              {
                id: "message-root",
                position: 0,
                role: "user",
                content: "Refine it",
                media: [{ asset_id: "asset-1", type: "image" }],
                metadata: { turn: 1 },
                created_at: timestamp,
              },
            ],
          },
        ],
        child_commit_ids: ["retry-1"],
      },
      {
        id: "retry-1",
        commit_hash: null,
        parent_commit_id: "root",
        retry_of_commit_id: "root",
        version_type: "retry",
        inputs: {},
        prompt_metadata: {},
        metadata: {},
        created_at: "2026-09-12T20:02:00Z",
        prompts: [],
        variants: [
          {
            index: 1,
            model: null,
            status: "failed",
            code: null,
            current_content: null,
            created_at: "2026-09-12T20:02:00Z",
            started_at: null,
            completed_at: null,
            duration_ms: null,
            error: "boom",
            metadata: {},
            messages: [],
          },
        ],
        child_commit_ids: [],
      },
    ],
  };
}

describe("history request serialization", () => {
  it("maps a complete snapshot to the backend snake_case contract", () => {
    const imageDataUrl = "data:image/png;base64,AAAA";
    const variantMetadata = { quality: "selected" };
    const request: HistoryProjectSnapshotRequest = {
      title: "Landing page",
      stack: "react_tailwind",
      inputMode: "image",
      metadata: {
        assets_by_id: {
          "asset-1": {
            id: "asset-1",
            type: "image",
            data_url: imageDataUrl,
          },
        },
      },
      createdAt: new Date(timestamp),
      selectedVariantIndex: 2,
      version: {
        id: " retry-2 ",
        commitHash: "hash-retry-2",
        parentCommitId: "root",
        retryOfCommitId: "root",
        versionType: "RETRY",
        inputs: { prompt_asset_ids: ["asset-1"] },
        promptMetadata: { temperature: 0.2 },
        metadata: { source: "retry" },
        prompts: [
          {
            id: "prompt-2",
            content: { text: "Try again", asset_ids: ["asset-1"] },
          },
        ],
        variants: [
          {
            index: 2,
            model: "gpt-test",
            code: "<main>Hello</main>",
            currentContent: "<main>Hello</main>",
            durationMs: 25,
            metadata: variantMetadata,
            projectData: projectData(),
            messages: [
              {
                id: "message-2",
                role: "user",
                content: "Try again",
                media: [{ asset_id: "asset-1", type: "image" }],
              },
            ],
          },
        ],
      },
    };

    const payload = serializeHistoryProjectSnapshotRequest(request);

    expect(payload).toEqual(
      expect.objectContaining({
        title: "Landing page",
        input_mode: "image",
        created_at: timestamp,
        set_as_head: true,
        select_commit: true,
        selected_variant_index: 2,
      })
    );
    expect(payload.version).toEqual(
      expect.objectContaining({
        id: "retry-2",
        commit_hash: "hash-retry-2",
        parent_commit_id: "root",
        retry_of_commit_id: "root",
        version_type: "retry",
        prompt_metadata: { temperature: 0.2 },
      })
    );
    expect(payload.version?.prompts[0]).toEqual(
      expect.objectContaining({ role: "user", kind: "generation" })
    );
    expect(payload.version?.variants[0]).toEqual(
      expect.objectContaining({
        index: 2,
        status: "completed",
        current_content: "<main>Hello</main>",
        duration_ms: 25,
      })
    );
    expect(
      payload.version?.variants[0].metadata[HISTORY_PROJECT_DATA_METADATA_KEY]
    ).toEqual(
      expect.objectContaining({
        entry_point: "src/App.tsx",
        active_file_path: "src/styles.css",
        generation_target_path: "src/App.tsx",
      })
    );
    expect(variantMetadata).toEqual({ quality: "selected" });
    expect(JSON.stringify(payload).split(imageDataUrl)).toHaveLength(2);
  });

  it("keeps selection nulls while omitting fields that were not updated", () => {
    expect(
      serializeHistorySelectionUpdateRequest({
        selectedCommitId: null,
        selectedVariantIndex: null,
      })
    ).toEqual({
      selected_commit_id: null,
      selected_variant_index: null,
    });
  });

  it("serializes append flags and retry ancestry", () => {
    expect(
      serializeHistoryAppendVersionRequest({
        version: {
          id: "retry",
          parentCommitId: "root",
          retryOfCommitId: "root",
          versionType: "retry",
        },
        setAsHead: false,
        selectCommit: false,
      })
    ).toEqual({
      version: expect.objectContaining({
        id: "retry",
        parent_commit_id: "root",
        retry_of_commit_id: "root",
        version_type: "retry",
      }),
      set_as_head: false,
      select_commit: false,
    });
  });
});

describe("history response mapping", () => {
  it("maps projects, commits, retry links, selections, prompts, and messages", () => {
    const project = parseHistoryProject(projectResponse());

    expect(project.createdAt).toEqual(new Date(timestamp));
    expect(project.inputMode).toBe("image");
    expect(project.headCommitId).toBe("retry-1");
    expect(project.selectedCommitId).toBe("root");
    expect(project.selectedVariantIndex).toBe(0);
    expect(project.rootCommitIds).toEqual(["root"]);

    const [root, retry] = project.commits;
    expect(root.childCommitIds).toEqual(["retry-1"]);
    expect(root.prompts[0]).toEqual(
      expect.objectContaining({
        id: "prompt-root",
        position: 0,
        content: { text: "Build it", asset_ids: ["asset-1"] },
      })
    );
    expect(root.variants[0].messages[0]).toEqual(
      expect.objectContaining({
        id: "message-root",
        media: [{ asset_id: "asset-1", type: "image" }],
      })
    );
    expect(root.variants[0].metadata).toEqual({
      quality: "selected",
      [HISTORY_PROJECT_DATA_METADATA_KEY]: serializeHistoryProjectData(
        projectData()
      ),
    });
    expect(root.variants[0].projectData).toEqual(projectData());
    expect(retry.parentCommitId).toBe("root");
    expect(retry.retryOfCommitId).toBe("root");
    expect(retry.versionType).toBe("retry");
  });

  it("round-trips every multi-file field without flattening file content", () => {
    const original = projectData();
    const wire = serializeHistoryProjectData(original);
    const restored = parseHistoryProjectData(wire);

    expect(wire).toEqual(
      expect.objectContaining({
        entry_point: original.entryPoint,
        active_file_path: original.activeFilePath,
        generation_target_path: original.generationTargetPath,
      })
    );
    expect(restored).toEqual(original);
    expect(restored.files["src/App.tsx"].content).toBe(
      "export const App = () => <main>Hello</main>;"
    );
  });
});

describe("history payload validation", () => {
  it("rejects retry versions without retry ancestry", () => {
    expect(() =>
      serializeHistoryVersionInput({ id: "retry", versionType: "retry" })
    ).toThrow("version.retryOfCommitId: is required for retry versions");
  });

  it("rejects duplicate nested identifiers and variant indexes", () => {
    expect(() =>
      serializeHistoryVersionInput({
        id: "root",
        prompts: [
          { id: "same", content: "one" },
          { id: "same", content: "two" },
        ],
      })
    ).toThrow("prompt ids must be unique");

    expect(() =>
      serializeHistoryVersionInput({
        id: "root",
        variants: [{ index: 0 }, { index: 0 }],
      })
    ).toThrow("variant indexes must be unique");

    expect(() =>
      serializeHistoryVariantInput({
        index: 0,
        messages: [
          { id: "same", role: "user" },
          { id: "same", role: "assistant" },
        ],
      })
    ).toThrow("message ids must be unique");
  });

  it("rejects invalid selection combinations and empty updates", () => {
    expect(() => serializeHistorySelectionUpdateRequest({})).toThrow(
      "must include at least one selection field"
    );
    expect(() =>
      serializeHistoryAppendVersionRequest({
        version: { id: "root" },
        selectCommit: false,
        selectedVariantIndex: 0,
      })
    ).toThrow("requires selectCommit to be true");
    expect(() =>
      serializeHistoryProjectSnapshotRequest({
        title: "No version",
        selectedVariantIndex: 0,
      })
    ).toThrow("requires a version");
  });

  it("rejects non-JSON metadata and malformed multi-file payloads", () => {
    expect(() =>
      serializeHistoryVersionInput({
        id: "root",
        metadata: { invalid: Number.NaN },
      })
    ).toThrow(HistoryPayloadError);

    expect(() =>
      parseHistoryProjectData({
        entry_point: "missing.tsx",
        active_file_path: "src/App.tsx",
        files: serializeHistoryProjectData(projectData()).files,
      })
    ).toThrow("must identify a file");
  });

  it("rejects malformed API timestamps and response shapes", () => {
    const malformedDate = projectResponse();
    malformedDate.created_at = "2026-09-12T20:00:00";
    expect(() => parseHistoryProject(malformedDate)).toThrow(
      "historyProject.created_at: must include a timezone"
    );

    const missingCommits = projectResponse() as Record<string, unknown>;
    delete missingCommits.commits;
    expect(() => parseHistoryProject(missingCommits)).toThrow(
      "historyProject.commits: must be an array"
    );
  });
});