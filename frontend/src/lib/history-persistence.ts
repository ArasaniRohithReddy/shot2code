import {
  buildHistoryProjectSnapshot,
  buildHistorySelectionUpdate,
  getUnpersistedCommittedCommits,
  restoreHistoryProject,
  toRecentHistoryProject,
  type ProjectHistorySnapshotState,
  type RecentHistoryProject,
  type RestoredProjectHistoryState,
} from "./project-history";
import {
  defaultHistoryClient,
  type HistoryClient,
} from "./history-client";
import type { HistoryProject } from "./history-types";

export const DEFAULT_HISTORY_DEBOUNCE_MS = 750;

export type HistorySaveReason =
  | "project-created"
  | "generation-start"
  | "status"
  | "final"
  | "edit"
  | "selection";

export type HistoryPersistenceOperation =
  | HistorySaveReason
  | "list"
  | "open"
  | "delete";

export interface HistoryPersistenceFailure {
  operation: HistoryPersistenceOperation;
  error: unknown;
}

export interface HistoryPersistenceOptions {
  client?: HistoryClient;
  debounceMs?: number;
  onError?: (failure: HistoryPersistenceFailure) => void;
  onRecovered?: () => void;
  onSaved?: (project: RecentHistoryProject) => void;
}

interface PendingSave {
  state: ProjectHistorySnapshotState;
  reason: HistorySaveReason;
  updateSelection: boolean;
}

export interface ProjectHistoryPersistence {
  scheduleSave(
    state: ProjectHistorySnapshotState,
    reason?: HistorySaveReason
  ): void;
  saveMilestone(
    state: ProjectHistorySnapshotState,
    reason?: HistorySaveReason
  ): Promise<boolean>;
  saveSelection(state: ProjectHistorySnapshotState): Promise<boolean>;
  flush(): Promise<boolean>;
  listRecent(): Promise<RecentHistoryProject[]>;
  loadProject(projectId: string): Promise<RestoredProjectHistoryState>;
  deleteProject(projectId: string): Promise<void>;
  registerLoadedProject(project: HistoryProject): void;
  dispose(): void;
}

export function createProjectHistoryPersistence({
  client = defaultHistoryClient,
  debounceMs = DEFAULT_HISTORY_DEBOUNCE_MS,
  onError,
  onRecovered,
  onSaved,
}: HistoryPersistenceOptions = {}): ProjectHistoryPersistence {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PendingSave | null = null;
  let queue: Promise<void> = Promise.resolve();
  const persistedCommitIdsByProject = new Map<string, Set<string>>();

  const reportError = (
    operation: HistoryPersistenceOperation,
    error: unknown
  ): void => {
    onError?.({ operation, error });
  };

  const markRecovered = (): void => {
    onRecovered?.();
  };

  const registerLoadedProject = (project: HistoryProject): void => {
    const persisted =
      persistedCommitIdsByProject.get(project.id) ?? new Set<string>();
    project.commits.forEach((commit) => {
      persisted.add(commit.id);
    });
    persistedCommitIdsByProject.set(project.id, persisted);
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const writeState = async ({
    state,
    reason,
    updateSelection,
  }: PendingSave): Promise<boolean> => {
    try {
      const persistedCommitIds =
        persistedCommitIdsByProject.get(state.projectId) ?? new Set<string>();
      persistedCommitIdsByProject.set(state.projectId, persistedCommitIds);
      const commitsToPersist = getUnpersistedCommittedCommits(
        state,
        persistedCommitIds
      );
      let savedProject: HistoryProject | null = null;

      if (commitsToPersist.length === 0) {
        savedProject = await client.upsertProject(
          state.projectId,
          buildHistoryProjectSnapshot(state)
        );
      } else {
        for (const commit of commitsToPersist) {
          savedProject = await client.upsertProject(
            state.projectId,
            buildHistoryProjectSnapshot(state, commit)
          );
          persistedCommitIds.add(commit.hash);
          savedProject.commits.forEach((savedCommit) => {
            persistedCommitIds.add(savedCommit.id);
          });
        }
      }

      if (updateSelection && savedProject) {
        const selection = buildHistorySelectionUpdate(
          state,
          persistedCommitIds
        );
        const selectionChanged =
          savedProject.headCommitId !== selection.headCommitId ||
          savedProject.selectedCommitId !== selection.selectedCommitId ||
          savedProject.selectedVariantIndex !== selection.selectedVariantIndex;
        if (selectionChanged) {
          savedProject = await client.selectProject(
            state.projectId,
            selection
          );
        }
      }

      if (!savedProject) {
        throw new Error("History save completed without a project response");
      }
      registerLoadedProject(savedProject);
      onSaved?.(toRecentHistoryProject(savedProject));
      markRecovered();
      return true;
    } catch (error) {
      reportError(reason, error);
      return false;
    }
  };

  const enqueueSave = (save: PendingSave): Promise<boolean> =>
    enqueue(() => writeState(save));

  const takePending = (): PendingSave | null => {
    clearTimer();
    const next = pending;
    pending = null;
    return next;
  };

  const scheduleSave = (
    state: ProjectHistorySnapshotState,
    reason: HistorySaveReason = "edit"
  ): void => {
    pending = { state, reason, updateSelection: false };
    clearTimer();
    timer = setTimeout(() => {
      const next = takePending();
      if (next) void enqueueSave(next);
    }, debounceMs);
  };

  const saveMilestone = async (
    state: ProjectHistorySnapshotState,
    reason: HistorySaveReason = "status"
  ): Promise<boolean> => {
    const scheduled = takePending();
    if (scheduled && scheduled.state.projectId !== state.projectId) {
      await enqueueSave(scheduled);
    }
    return enqueueSave({ state, reason, updateSelection: false });
  };

  const saveSelection = async (
    state: ProjectHistorySnapshotState
  ): Promise<boolean> => {
    const scheduled = takePending();
    if (scheduled && scheduled.state.projectId !== state.projectId) {
      await enqueueSave(scheduled);
    }
    return enqueueSave({
      state,
      reason: "selection",
      updateSelection: true,
    });
  };

  const flush = async (): Promise<boolean> => {
    const scheduled = takePending();
    if (scheduled) return enqueueSave(scheduled);
    await queue;
    return true;
  };

  const listRecent = async (): Promise<RecentHistoryProject[]> =>
    enqueue(async () => {
      try {
        const result = await client.listProjects({ limit: 12 });
        markRecovered();
        return result.projects.map(toRecentHistoryProject);
      } catch (error) {
        reportError("list", error);
        throw error;
      }
    });

  const loadProject = async (
    projectId: string
  ): Promise<RestoredProjectHistoryState> => {
    await flush();
    return enqueue(async () => {
      try {
        const project = await client.getProject(projectId);
        registerLoadedProject(project);
        markRecovered();
        return restoreHistoryProject(project);
      } catch (error) {
        reportError("open", error);
        throw error;
      }
    });
  };

  const deleteProject = async (projectId: string): Promise<void> => {
    if (pending?.state.projectId === projectId) {
      takePending();
    }
    await enqueue(async () => {
      try {
        await client.deleteProject(projectId);
        persistedCommitIdsByProject.delete(projectId);
        markRecovered();
      } catch (error) {
        reportError("delete", error);
        throw error;
      }
    });
  };

  const dispose = (): void => {
    clearTimer();
    pending = null;
  };

  return {
    scheduleSave,
    saveMilestone,
    saveSelection,
    flush,
    listRecent,
    loadProject,
    deleteProject,
    registerLoadedProject,
    dispose,
  };
}
