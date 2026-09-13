import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import toast from "react-hot-toast";
import { AppState, type Settings } from "../types";
import { useAppStore } from "../store/app-store";
import { useProjectStore } from "../store/project-store";
import {
  createProjectHistoryPersistence,
  type HistoryPersistenceFailure,
  type HistorySaveReason,
  type ProjectHistoryPersistence,
} from "../lib/history-persistence";
import type {
  ProjectHistorySnapshotState,
  RecentHistoryProject,
} from "../lib/project-history";
import type { Stack } from "../lib/stacks";

export const ACTIVE_HISTORY_PROJECT_KEY = "shot2code-active-history-project";
export const NEW_HISTORY_PROJECT_VALUE = "__new__";
const HISTORY_TOAST_ID = "project-history-status";

interface UseProjectHistoryPersistenceOptions {
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  cancelCodeGeneration: () => void;
  onProjectOpened?: () => void;
}

interface OpenProjectOptions {
  announce?: boolean;
}

function historyFailureMessage(failure: HistoryPersistenceFailure): string {
  switch (failure.operation) {
    case "delete":
      return "Could not delete the saved project. It remains in project history.";
    case "open":
      return "Could not open that saved project. Your current work was not changed.";
    case "list":
      return "Recent projects are unavailable. You can keep working in memory.";
    default:
      return "Project history could not be saved. Your work remains available in this window.";
  }
}

export function projectSelectionKey(
  state: Pick<
    ReturnType<typeof useProjectStore.getState>,
    "head" | "commits"
  >
): string {
  if (!state.head) return "";
  const commit = state.commits[state.head];
  if (!commit) return state.head;
  const variant = commit.variants[commit.selectedVariantIndex];
  return [
    state.head,
    commit.selectedVariantIndex,
    variant?.activeFilePath ?? variant?.entryPoint ?? "",
  ].join("|");
}

export function captureProjectHistoryState(): ProjectHistorySnapshotState | null {
  const state = useProjectStore.getState();
  if (!state.projectId || !state.projectCreatedAt) return null;
  return {
    projectId: state.projectId,
    projectTitle: state.projectTitle,
    projectCreatedAt: state.projectCreatedAt,
    projectStack: state.projectStack,
    inputMode: state.inputMode,
    referenceImages: state.referenceImages,
    initialPrompt: state.initialPrompt,
    multiScreenshotMode: state.multiScreenshotMode,
    assetsById: state.assetsById,
    commits: state.commits,
    head: state.head,
    latestCommitHash: state.latestCommitHash,
  };
}

function rememberActiveProject(projectId: string): void {
  window.localStorage.setItem(ACTIVE_HISTORY_PROJECT_KEY, projectId);
}

function rememberNewProjectFlow(): void {
  window.localStorage.setItem(
    ACTIVE_HISTORY_PROJECT_KEY,
    NEW_HISTORY_PROJECT_VALUE
  );
}

export function useProjectHistoryPersistence({
  setSettings,
  cancelCodeGeneration,
  onProjectOpened,
}: UseProjectHistoryPersistenceOptions) {
  const [recentProjects, setRecentProjects] = useState<RecentHistoryProject[]>([]);
  const [isLoadingRecentProjects, setIsLoadingRecentProjects] = useState(true);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const cancelCodeGenerationRef = useRef(cancelCodeGeneration);
  const onProjectOpenedRef = useRef(onProjectOpened);
  cancelCodeGenerationRef.current = cancelCodeGeneration;
  onProjectOpenedRef.current = onProjectOpened;

  const persistenceRef = useRef<ProjectHistoryPersistence | null>(null);
  if (!persistenceRef.current) {
    persistenceRef.current = createProjectHistoryPersistence({
      onError: (failure) => {
        console.error(`Project history ${failure.operation} failed`, failure.error);
        const message = historyFailureMessage(failure);
        setHistoryError(message);
        toast.error(message, { id: HISTORY_TOAST_ID });
      },
      onRecovered: () => {
        setHistoryError(null);
        toast.dismiss(HISTORY_TOAST_ID);
      },
      onSaved: (project) => {
        setRecentProjects((current) =>
          [project, ...current.filter((item) => item.id !== project.id)].sort(
            (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
          )
        );
      },
    });
  }
  const persistence = persistenceRef.current;

  const persistMilestone = useCallback(
    (reason: HistorySaveReason = "status") => {
      const snapshot = captureProjectHistoryState();
      return snapshot ? persistence.saveMilestone(snapshot, reason) : Promise.resolve(true);
    },
    [persistence]
  );

  const clearForNewProject = useCallback(() => {
    const snapshot = captureProjectHistoryState();
    if (snapshot) void persistence.saveMilestone(snapshot, "final");
    cancelCodeGenerationRef.current();
    useProjectStore.getState().resetProject();
    useAppStore.setState({
      appState: AppState.INITIAL,
      updateInstruction: "",
      updateImages: [],
      inSelectAndEditMode: false,
      selectedElement: null,
    });
    rememberNewProjectFlow();
  }, [persistence]);

  const startProject = useCallback(
    ({ title, stack }: { title: string; stack: Stack }): string => {
      const id = nanoid();
      useProjectStore.getState().startProject({
        id,
        title,
        createdAt: new Date(),
        stack,
      });
      rememberActiveProject(id);
      return id;
    },
    []
  );

  const openProject = useCallback(
    async (
      projectId: string,
      { announce = true }: OpenProjectOptions = {}
    ): Promise<boolean> => {
      setBusyProjectId(projectId);
      try {
        const restored = await persistence.loadProject(projectId);
        cancelCodeGenerationRef.current();
        useProjectStore.getState().restoreProject(restored);
        useAppStore.setState({
          appState:
            Object.keys(restored.commits).length > 0
              ? AppState.CODE_READY
              : AppState.INITIAL,
          updateInstruction: "",
          updateImages: [],
          inSelectAndEditMode: false,
          selectedElement: null,
        });
        setSettings((current) => ({
          ...current,
          generatedCodeConfig: restored.projectStack,
        }));
        rememberActiveProject(projectId);
        onProjectOpenedRef.current?.();
        if (restored.interruptedGeneration) {
          const snapshot = captureProjectHistoryState();
          if (snapshot) void persistence.saveMilestone(snapshot, "status");
        }
        if (announce) toast.success(`Opened ${restored.projectTitle}.`);
        return true;
      } catch {
        return false;
      } finally {
        setBusyProjectId(null);
      }
    },
    [persistence, setSettings]
  );

  const deleteProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      setBusyProjectId(projectId);
      try {
        await persistence.deleteProject(projectId);
        setRecentProjects((current) =>
          current.filter((project) => project.id !== projectId)
        );
        if (useProjectStore.getState().projectId === projectId) {
          cancelCodeGenerationRef.current();
          useProjectStore.getState().resetProject();
          useAppStore.setState({
            appState: AppState.INITIAL,
            updateInstruction: "",
            updateImages: [],
            inSelectAndEditMode: false,
            selectedElement: null,
          });
          rememberNewProjectFlow();
        }
        toast.success("Project deleted.");
        return true;
      } catch {
        return false;
      } finally {
        setBusyProjectId(null);
      }
    },
    [persistence]
  );

  const refreshRecentProjects = useCallback(async (): Promise<boolean> => {
    setIsLoadingRecentProjects(true);
    try {
      setRecentProjects(await persistence.listRecent());
      return true;
    } catch {
      return false;
    } finally {
      setIsLoadingRecentProjects(false);
    }
  }, [persistence]);

  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (!state.projectId || !state.projectCreatedAt) return;
      if (state.projectId !== previous.projectId) return;

      const selectionChanged =
        projectSelectionKey(state) !== projectSelectionKey(previous);
      const projectChanged =
        state.projectTitle !== previous.projectTitle ||
        state.projectStack !== previous.projectStack ||
        state.inputMode !== previous.inputMode ||
        state.referenceImages !== previous.referenceImages ||
        state.initialPrompt !== previous.initialPrompt ||
        state.multiScreenshotMode !== previous.multiScreenshotMode ||
        state.assetsById !== previous.assetsById ||
        state.commits !== previous.commits ||
        state.latestCommitHash !== previous.latestCommitHash;
      const snapshot = captureProjectHistoryState();
      if (!snapshot) return;

      const generationStarted =
        state.latestCommitHash !== previous.latestCommitHash;
      if (selectionChanged && !generationStarted) {
        void persistence.saveSelection(snapshot);
      } else if (projectChanged) {
        persistence.scheduleSave(snapshot, "edit");
      }
    });
    return unsubscribe;
  }, [persistence]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      setIsLoadingRecentProjects(true);
      try {
        const projects = await persistence.listRecent();
        if (cancelled) return;
        setRecentProjects(projects);
        if (useProjectStore.getState().projectId) return;
        const remembered = window.localStorage.getItem(
          ACTIVE_HISTORY_PROJECT_KEY
        );
        if (remembered === NEW_HISTORY_PROJECT_VALUE) return;
        const rememberedProject = projects.find(
          (project) => project.id === remembered
        );
        const projectToRestore =
          rememberedProject ??
          (window.__SHOT2CODE_APP__ ? projects[0] : undefined);
        if (projectToRestore) {
          await openProject(projectToRestore.id, { announce: false });
        }
      } catch {
        // The persistence layer already reports a visible, non-blocking error.
      } finally {
        if (!cancelled) setIsLoadingRecentProjects(false);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [openProject, persistence]);

  useEffect(() => {
    const flushVisibleWork = () => {
      if (document.visibilityState !== "hidden") return;
      const snapshot = captureProjectHistoryState();
      if (snapshot) void persistence.saveMilestone(snapshot, "final");
    };
    document.addEventListener("visibilitychange", flushVisibleWork);
    return () => {
      document.removeEventListener("visibilitychange", flushVisibleWork);
      persistence.dispose();
    };
  }, [persistence]);

  return {
    recentProjects,
    isLoadingRecentProjects,
    busyProjectId,
    historyError,
    clearForNewProject,
    startProject,
    persistMilestone,
    openProject,
    deleteProject,
    refreshRecentProjects,
  };
}
