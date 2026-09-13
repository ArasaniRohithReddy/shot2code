jest.mock("../config", () => ({ HTTP_BACKEND_URL: "http://default" }));

import type { Commit } from "../components/commits/types";
import type {
  HistoryClient,
  HistoryRequestOptions,
} from "./history-client";
import { createProjectHistoryPersistence } from "./history-persistence";
import {
  buildHistoryProjectSnapshot,
  type ProjectHistorySnapshotState,
} from "./project-history";
import { Stack } from "./stacks";
import type {
  HistoryAppendVersionRequest,
  HistoryHealth,
  HistoryProject,
  HistoryProjectSnapshotRequest,
  HistorySelectionUpdateRequest,
} from "./history-types";

const createdAt = new Date("2026-09-12T20:00:00.000Z");

function draftCommit(hash = "draft"): Commit {
  return {
    hash,
    parentHash: null,
    dateCreated: createdAt,
    isCommitted: false,
    selectedVariantIndex: 0,
    type: "ai_create",
    inputs: { text: "Build it", images: [], videos: [] },
    variants: [
      {
        code: "<main>Draft</main>",
        history: [],
        status: "complete",
        completedAt: createdAt.getTime() + 1_000,
        stack: Stack.HTML_TAILWIND,
      },
    ],
  };
}

function snapshotState(title = "Project"): ProjectHistorySnapshotState {
  const draft = draftCommit();
  return {
    projectId: "project-1",
    projectTitle: title,
    projectCreatedAt: createdAt,
    projectStack: Stack.HTML_TAILWIND,
    inputMode: "text",
    referenceImages: [],
    initialPrompt: "Build it",
    multiScreenshotMode: "pages",
    assetsById: {},
    commits: { [draft.hash]: draft },
    head: draft.hash,
    latestCommitHash: draft.hash,
  };
}

function projectResponse(
  snapshot: HistoryProjectSnapshotRequest = buildHistoryProjectSnapshot(
    snapshotState()
  )
): HistoryProject {
  return {
    id: "project-1",
    title: snapshot.title,
    stack: snapshot.stack ?? null,
    inputMode: snapshot.inputMode ?? null,
    metadata: snapshot.metadata ?? {},
    createdAt,
    updatedAt: new Date(createdAt.getTime() + 1_000),
    headCommitId: null,
    selectedCommitId: null,
    selectedVariantIndex: null,
    commitCount: 0,
    variantCount: 0,
    rootCommitIds: [],
    commits: [],
  };
}

function healthResponse(): HistoryHealth {
  return {
    status: "ok",
    databasePath: "history.sqlite3",
    schemaVersion: 2,
    latestSchemaVersion: 2,
    foreignKeysEnabled: true,
    journalMode: "wal",
    migrations: [],
  };
}

function createClient() {
  let project = projectResponse();
  const client: jest.Mocked<HistoryClient> = {
    health: jest.fn(async () => healthResponse()),
    listProjects: jest.fn(async () => ({ projects: [project] })),
    getProject: jest.fn<
      Promise<HistoryProject>,
      [string, HistoryRequestOptions?]
    >(async () => project),
    upsertProject: jest.fn(async (_projectId, snapshot) => {
      project = projectResponse(snapshot);
      return project;
    }),
    appendVersion: jest.fn<
      Promise<HistoryProject>,
      [string, HistoryAppendVersionRequest, HistoryRequestOptions?]
    >(async () => project),
    selectProject: jest.fn(
      async (_projectId, selection: HistorySelectionUpdateRequest) => {
        project = {
          ...project,
          headCommitId: selection.headCommitId ?? project.headCommitId,
          selectedCommitId:
            selection.selectedCommitId === undefined
              ? project.selectedCommitId
              : selection.selectedCommitId,
          selectedVariantIndex:
            selection.selectedVariantIndex === undefined
              ? project.selectedVariantIndex
              : selection.selectedVariantIndex,
        };
        return project;
      }
    ),
    deleteProject: jest.fn<
      Promise<void>,
      [string, HistoryRequestOptions?]
    >(async () => undefined),
  };
  return client;
}

describe("project history persistence", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("debounces streaming/edit snapshots and saves only the newest state", async () => {
    jest.useFakeTimers();
    const client = createClient();
    const persistence = createProjectHistoryPersistence({
      client,
      debounceMs: 500,
    });

    persistence.scheduleSave(snapshotState("First"));
    persistence.scheduleSave(snapshotState("Second"));
    persistence.scheduleSave(snapshotState("Latest"));

    jest.advanceTimersByTime(499);
    expect(client.upsertProject).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await persistence.flush();

    expect(client.upsertProject).toHaveBeenCalledTimes(1);
    expect(client.upsertProject.mock.calls[0][1].title).toBe("Latest");
    persistence.dispose();
  });

  it("promotes a committed version once and keeps milestone saves idempotent", async () => {
    const client = createClient();
    const persistence = createProjectHistoryPersistence({ client });
    const state = snapshotState();
    const root = state.commits.draft;
    root.hash = "root";
    root.isCommitted = true;
    const draft = draftCommit("draft-2");
    draft.parentHash = "root";
    state.commits = { root, [draft.hash]: draft };
    state.head = draft.hash;
    state.latestCommitHash = draft.hash;

    await persistence.saveMilestone(state, "generation-start");
    await persistence.saveMilestone(state, "status");

    expect(client.upsertProject).toHaveBeenCalledTimes(2);
    expect(client.upsertProject.mock.calls[0][1].version?.id).toBe("root");
    expect(client.upsertProject.mock.calls[1][1].version).toBeUndefined();
  });

  it("atomically promotes a retry source while storing the new retry draft", async () => {
    const client = createClient();
    const persistence = createProjectHistoryPersistence({ client });
    const state = snapshotState();
    const source = state.commits.draft;
    source.hash = "source";
    source.isCommitted = true;
    const retry = draftCommit("retry-1");
    retry.parentHash = source.hash;
    retry.retryOfHash = source.hash;
    retry.variants[0].status = "error";
    retry.variants[0].errorMessage = "database-independent failure";
    state.commits = { [source.hash]: source, [retry.hash]: retry };
    state.head = retry.hash;
    state.latestCommitHash = retry.hash;

    await persistence.saveMilestone(state, "generation-start");

    expect(client.upsertProject).toHaveBeenCalledTimes(1);
    const snapshot = client.upsertProject.mock.calls[0][1];
    expect(snapshot.version?.id).toBe(source.hash);
    expect(snapshot.metadata).toEqual(
      expect.objectContaining({
        shot2code: expect.objectContaining({
          selected_commit_hash: retry.hash,
          latest_commit_hash: retry.hash,
          draft_commit: expect.objectContaining({
            hash: retry.hash,
            parent_hash: source.hash,
            retry_of_hash: source.hash,
          }),
        }),
      })
    );
  });

  it("promotes each completed retry once and keeps the next sibling retry as draft", async () => {
    const client = createClient();
    const persistence = createProjectHistoryPersistence({ client });
    const state = snapshotState();
    const root = state.commits.draft;
    root.hash = "root";
    root.isCommitted = true;
    const firstRetry = draftCommit("retry-1");
    firstRetry.parentHash = root.hash;
    firstRetry.retryOfHash = root.hash;
    firstRetry.isCommitted = true;
    const secondRetry = draftCommit("retry-2");
    secondRetry.parentHash = root.hash;
    secondRetry.retryOfHash = root.hash;
    state.commits = {
      [root.hash]: root,
      [firstRetry.hash]: firstRetry,
      [secondRetry.hash]: secondRetry,
    };
    state.head = secondRetry.hash;
    state.latestCommitHash = secondRetry.hash;
    persistence.registerLoadedProject({
      ...projectResponse(),
      headCommitId: root.hash,
      commits: [
        {
          id: root.hash,
          commitHash: root.hash,
          parentCommitId: null,
          retryOfCommitId: null,
          versionType: "ai_create",
          inputs: {},
          promptMetadata: {},
          metadata: {},
          createdAt,
          prompts: [],
          variants: [],
          childCommitIds: [],
        },
      ],
    });

    await persistence.saveMilestone(state, "generation-start");

    expect(client.upsertProject).toHaveBeenCalledTimes(1);
    const snapshot = client.upsertProject.mock.calls[0][1];
    expect(snapshot.version).toEqual(
      expect.objectContaining({
        id: firstRetry.hash,
        parentCommitId: root.hash,
        retryOfCommitId: root.hash,
        versionType: "retry",
      })
    );
    expect(snapshot.metadata).toEqual(
      expect.objectContaining({
        shot2code: expect.objectContaining({
          draft_commit: expect.objectContaining({
            hash: secondRetry.hash,
            parent_hash: root.hash,
            retry_of_hash: root.hash,
          }),
        }),
      })
    );
  });

  it("flushes a queued edit into an immediate milestone without duplicate writes", async () => {
    jest.useFakeTimers();
    const client = createClient();
    const persistence = createProjectHistoryPersistence({
      client,
      debounceMs: 500,
    });
    const state = snapshotState("Before");
    persistence.scheduleSave(state);

    const latest = snapshotState("After status");
    await persistence.saveMilestone(latest, "status");
    jest.advanceTimersByTime(500);
    await persistence.flush();

    expect(client.upsertProject).toHaveBeenCalledTimes(1);
    expect(client.upsertProject.mock.calls[0][1].title).toBe("After status");
  });

  it("persists selected commit and variant pointers", async () => {
    const client = createClient();
    const persistence = createProjectHistoryPersistence({ client });
    const state = snapshotState();
    const root = state.commits.draft;
    root.hash = "root";
    root.isCommitted = true;
    state.commits = { root };
    state.head = "root";
    state.latestCommitHash = "root";
    persistence.registerLoadedProject({
      ...projectResponse(buildHistoryProjectSnapshot(state)),
      commits: [
        {
          id: "root",
          commitHash: "root",
          parentCommitId: null,
          retryOfCommitId: null,
          versionType: "ai_create",
          inputs: {},
          promptMetadata: {},
          metadata: {},
          createdAt,
          prompts: [],
          variants: [],
          childCommitIds: [],
        },
      ],
    });

    await persistence.saveSelection(state);

    expect(client.selectProject).toHaveBeenCalledWith("project-1", {
      headCommitId: "root",
      selectedCommitId: "root",
      selectedVariantIndex: 0,
    });
  });

  it("restores a saved draft after a restart", async () => {
    const client = createClient();
    const state = snapshotState("Restarted project");
    client.getProject.mockResolvedValue(
      projectResponse(buildHistoryProjectSnapshot(state))
    );
    const persistence = createProjectHistoryPersistence({ client });

    const restored = await persistence.loadProject("project-1");

    expect(restored.projectTitle).toBe("Restarted project");
    expect(restored.head).toBe("draft");
    expect(restored.commits.draft.variants[0].code).toBe("<main>Draft</main>");
  });

  it("cancels a pending save before deleting the same project", async () => {
    jest.useFakeTimers();
    const client = createClient();
    const persistence = createProjectHistoryPersistence({
      client,
      debounceMs: 500,
    });
    persistence.scheduleSave(snapshotState());

    await persistence.deleteProject("project-1");
    jest.advanceTimersByTime(500);
    await persistence.flush();

    expect(client.deleteProject).toHaveBeenCalledWith("project-1");
    expect(client.upsertProject).not.toHaveBeenCalled();
  });

  it("keeps retry state available when the history API fails", async () => {
    const client = createClient();
    const failure = new Error("database unavailable");
    client.upsertProject.mockRejectedValue(failure);
    const onError = jest.fn();
    const persistence = createProjectHistoryPersistence({ client, onError });
    const state = snapshotState();
    const source = state.commits.draft;
    source.hash = "source";
    source.isCommitted = true;
    const retry = draftCommit("retry");
    retry.parentHash = source.hash;
    retry.retryOfHash = source.hash;
    state.commits = { [source.hash]: source, [retry.hash]: retry };
    state.head = retry.hash;
    state.latestCommitHash = retry.hash;
    const before = JSON.stringify(state);

    await expect(
      persistence.saveMilestone(state, "generation-start")
    ).resolves.toBe(false);

    expect(JSON.stringify(state)).toBe(before);
    expect(onError).toHaveBeenCalledWith({
      operation: "generation-start",
      error: failure,
    });
  });
});
