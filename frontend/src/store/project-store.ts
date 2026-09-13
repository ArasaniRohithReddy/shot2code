import { create } from "zustand";
import {
  AgentEvent,
  Commit,
  CommitHash,
  VariantHistoryMessage,
  VariantStatus,
} from "../components/commits/types";
import { MultiScreenshotMode, PromptAsset } from "../types";
import { Stack } from "../lib/stacks";
import { useAppStore } from "./app-store";
import {
  appendToProjectFile,
  DEFAULT_PROJECT_ENTRY_POINT,
  getProjectFile,
  normalizeProjectState,
  setActiveProjectFile,
  updateProjectFileContent,
  type ProjectFileMap,
} from "../lib/project-files";

export interface ProjectRestorePayload {
  projectId: string;
  projectTitle: string;
  projectCreatedAt: Date;
  projectStack: Stack;
  inputMode: "image" | "video" | "text";
  referenceImages: string[];
  initialPrompt: string;
  multiScreenshotMode: MultiScreenshotMode;
  assetsById: Record<string, PromptAsset>;
  commits: Record<string, Commit>;
  head: CommitHash | null;
  latestCommitHash: CommitHash | null;
}

// Store for app-wide state
interface ProjectStore {
  projectId: string | null;
  projectTitle: string;
  projectCreatedAt: Date | null;
  projectStack: Stack;
  startProject: (project: {
    id: string;
    title: string;
    createdAt: Date;
    stack: Stack;
  }) => void;
  restoreProject: (project: ProjectRestorePayload) => void;
  resetProject: () => void;

  // Inputs
  inputMode: "image" | "video" | "text";
  setInputMode: (mode: "image" | "video" | "text") => void;
  referenceImages: string[];
  setReferenceImages: (images: string[]) => void;
  initialPrompt: string;
  setInitialPrompt: (prompt: string) => void;
  multiScreenshotMode: MultiScreenshotMode;
  setMultiScreenshotMode: (mode: MultiScreenshotMode) => void;
  assetsById: Record<string, PromptAsset>;
  upsertPromptAssets: (assets: PromptAsset[]) => void;
  resetPromptAssets: () => void;

  // Outputs
  commits: Record<string, Commit>;
  head: CommitHash | null;
  latestCommitHash: CommitHash | null;

  addCommit: (commit: Commit) => void;
  removeCommit: (hash: CommitHash) => void;
  resetCommits: () => void;

  appendCommitCode: (
    hash: CommitHash,
    numVariant: number,
    code: string
  ) => void;
  appendVariantThinking: (
    hash: CommitHash,
    numVariant: number,
    thinking: string
  ) => void;
  setCommitCode: (hash: CommitHash, numVariant: number, code: string) => void;
  setVariantFiles: (
    hash: CommitHash,
    numVariant: number,
    files: ProjectFileMap,
    entryPoint?: string
  ) => void;
  setVariantFileContent: (
    hash: CommitHash,
    numVariant: number,
    path: string,
    content: string
  ) => void;
  setVariantActiveFile: (
    hash: CommitHash,
    numVariant: number,
    path: string
  ) => void;
  appendVariantHistoryMessage: (
    hash: CommitHash,
    numVariant: number,
    message: VariantHistoryMessage
  ) => void;
  updateSelectedVariantIndex: (hash: CommitHash, index: number) => void;
  updateVariantStatus: (
    hash: CommitHash,
    numVariant: number,
    status: VariantStatus,
    errorMessage?: string
  ) => void;
  finalizeGeneratingVariants: (
    hash: CommitHash,
    status: Exclude<VariantStatus, "generating">,
    errorMessage?: string
  ) => void;
  resizeVariants: (hash: CommitHash, count: number) => void;
  setVariantModels: (hash: CommitHash, models: string[]) => void;

  startAgentEvent: (
    hash: CommitHash,
    numVariant: number,
    event: AgentEvent
  ) => void;
  appendAgentEventContent: (
    hash: CommitHash,
    numVariant: number,
    eventId: string,
    content: string
  ) => void;
  finishAgentEvent: (
    hash: CommitHash,
    numVariant: number,
    eventId: string,
    updates: Partial<AgentEvent>
  ) => void;

  setHead: (hash: CommitHash) => void;
  resetHead: () => void;

  executionConsoles: { [key: number]: string[] };
  appendExecutionConsole: (variantIndex: number, line: string) => void;
  resetExecutionConsoles: () => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projectId: null,
  projectTitle: "",
  projectCreatedAt: null,
  projectStack: Stack.HTML_TAILWIND,
  startProject: ({ id, title, createdAt, stack }) =>
    set({
      projectId: id,
      projectTitle: title,
      projectCreatedAt: createdAt,
      projectStack: stack,
    }),
  restoreProject: (project) => {
    useAppStore.getState().disableInSelectAndEditMode();
    const commits = Object.fromEntries(
      Object.entries(project.commits).map(([hash, commit]) => [
        hash,
        {
          ...commit,
          generationContext: commit.generationContext
            ? {
                ...commit.generationContext,
                selectedModels: [...commit.generationContext.selectedModels],
              }
            : undefined,
          variants: commit.variants.map((variant) => ({
            ...normalizeProjectState(variant),
            history: (variant.history ?? []).map((message) => ({
              ...message,
              imageAssetIds: [...message.imageAssetIds],
              videoAssetIds: [...message.videoAssetIds],
            })),
            agentEvents: [...(variant.agentEvents ?? [])],
          })),
        },
      ])
    );
    set({
      projectId: project.projectId,
      projectTitle: project.projectTitle,
      projectCreatedAt: project.projectCreatedAt,
      projectStack: project.projectStack,
      inputMode: project.inputMode,
      referenceImages: [...project.referenceImages],
      initialPrompt: project.initialPrompt,
      multiScreenshotMode: project.multiScreenshotMode,
      assetsById: { ...project.assetsById },
      commits,
      head: project.head,
      latestCommitHash: project.latestCommitHash,
      executionConsoles: {},
    });
  },
  resetProject: () => {
    useAppStore.getState().disableInSelectAndEditMode();
    set({
      projectId: null,
      projectTitle: "",
      projectCreatedAt: null,
      projectStack: Stack.HTML_TAILWIND,
      inputMode: "image",
      referenceImages: [],
      initialPrompt: "",
      multiScreenshotMode: "pages",
      assetsById: {},
      commits: {},
      head: null,
      latestCommitHash: null,
      executionConsoles: {},
    });
  },

  // Inputs and their setters
  inputMode: "image",
  setInputMode: (mode) => set({ inputMode: mode }),
  referenceImages: [],
  setReferenceImages: (images) => set({ referenceImages: images }),
  initialPrompt: "",
  setInitialPrompt: (prompt) => set({ initialPrompt: prompt }),
  multiScreenshotMode: "pages",
  setMultiScreenshotMode: (mode) => set({ multiScreenshotMode: mode }),
  assetsById: {},
  upsertPromptAssets: (assets) =>
    set((state) => {
      if (assets.length === 0) return state;
      const merged = { ...state.assetsById };
      for (const asset of assets) {
        merged[asset.id] = asset;
      }
      return { assetsById: merged };
    }),
  resetPromptAssets: () => set({ assetsById: {} }),

  // Outputs
  commits: {},
  head: null,
  latestCommitHash: null,

  addCommit: (commit: Commit) => {
    useAppStore.getState().disableInSelectAndEditMode();
    const requestStartedAt = new Date(commit.dateCreated).getTime();
    const committedAt = Date.now();
    // Initialize variant statuses as 'generating' and start thinking timer
    const commitsWithStatus = {
      ...commit,
      generationContext: commit.generationContext
        ? {
            ...commit.generationContext,
            selectedModels: [...commit.generationContext.selectedModels],
          }
        : undefined,
      variants: commit.variants.map((variant) => ({
        ...normalizeProjectState(variant),
        history: variant.history || [],
        requestStartedAt:
          variant.requestStartedAt ?? requestStartedAt,
        status: variant.status || ("generating" as VariantStatus),
        thinkingStartTime: Date.now(),
        agentEvents: [],
      })),
    };

    // When adding a new commit, make sure all existing commits are marked as committed
    set((state) => ({
      commits: {
        ...Object.fromEntries(
          Object.entries(state.commits).map(([hash, existingCommit]) => [
            hash,
            {
              ...existingCommit,
              isCommitted: true,
              variants: existingCommit.variants.map((variant) =>
                variant.status === "generating"
                  ? {
                      ...variant,
                      status: "cancelled" as VariantStatus,
                      completedAt: variant.completedAt ?? committedAt,
                    }
                  : variant
              ),
            },
          ])
        ),
        [commitsWithStatus.hash]: commitsWithStatus,
      },
      head: commitsWithStatus.hash,
      latestCommitHash: commitsWithStatus.hash,
    }));
  },
  removeCommit: (hash: CommitHash) => {
    set((state) => {
      const removedCommit = state.commits[hash];
      const newCommits = { ...state.commits };
      delete newCommits[hash];

      // If removing the latest commit, fall back to its parent
      const newLatestCommitHash =
        state.latestCommitHash === hash
          ? (removedCommit?.parentHash ?? null)
          : state.latestCommitHash;

      return { commits: newCommits, latestCommitHash: newLatestCommitHash };
    });
  },
  resetCommits: () => set({ commits: {}, latestCommitHash: null }),

  appendCommitCode: (hash: CommitHash, numVariant: number, code: string) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;

      const variant = commit.variants[numVariant];
      if (!variant) return state;

      const normalizedVariant = normalizeProjectState(variant);
      const targetPath =
        variant.generationTargetPath ?? normalizedVariant.entryPoint;
      const targetFile = getProjectFile(normalizedVariant, targetPath);
      const isFirstCode = !targetFile?.content && variant.thinkingStartTime;
      const duration = isFirstCode
        ? Math.round((Date.now() - variant.thinkingStartTime!) / 1000)
        : variant.thinkingDuration;
      const updatedVariant = appendToProjectFile(
        normalizedVariant,
        targetPath,
        code
      );

      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((currentVariant, index) =>
              index === numVariant
                ? { ...updatedVariant, thinkingDuration: duration }
                : currentVariant
            ),
          },
        },
      };
    }),
  appendVariantThinking: (
    hash: CommitHash,
    numVariant: number,
    thinking: string
  ) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit) return state;
      if (commit.isCommitted) {
        throw new Error("Attempted to append thinking to a committed commit");
      }
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((variant, index) =>
              index === numVariant
                ? {
                    ...variant,
                    thinking: (variant.thinking || "") + thinking,
                  }
                : variant
            ),
          },
        },
      };
    }),
  setCommitCode: (hash: CommitHash, numVariant: number, code: string) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;

      const variant = commit.variants[numVariant];
      if (!variant) return state;

      const normalizedVariant = normalizeProjectState(variant);
      const targetPath =
        variant.generationTargetPath ?? normalizedVariant.entryPoint;
      const updatedVariant = updateProjectFileContent(
        normalizedVariant,
        targetPath,
        code,
        { force: true }
      );

      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((currentVariant, index) =>
              index === numVariant ? updatedVariant : currentVariant
            ),
          },
        },
      };
    }),
  setVariantFiles: (hash, numVariant, files, entryPoint) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;

      const variant = commit.variants[numVariant];
      if (!variant) return state;

      const updatedVariant = normalizeProjectState({
        ...variant,
        files,
        entryPoint,
      });
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((currentVariant, index) =>
              index === numVariant ? updatedVariant : currentVariant
            ),
          },
        },
      };
    }),
  setVariantFileContent: (hash, numVariant, path, content) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;

      const variant = commit.variants[numVariant];
      if (!variant) return state;

      const updatedVariant = updateProjectFileContent(variant, path, content);
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((currentVariant, index) =>
              index === numVariant ? updatedVariant : currentVariant
            ),
          },
        },
      };
    }),
  setVariantActiveFile: (hash, numVariant, path) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit) return state;

      const variant = commit.variants[numVariant];
      if (!variant) return state;

      const updatedVariant = setActiveProjectFile(variant, path);
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((currentVariant, index) =>
              index === numVariant ? updatedVariant : currentVariant
            ),
          },
        },
      };
    }),
  appendVariantHistoryMessage: (hash, numVariant, message) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const history = variant.history || [];
        const last = history[history.length - 1];
        const isDuplicate =
          last &&
          last.role === message.role &&
          last.text === message.text &&
          last.imageAssetIds.join("|") === message.imageAssetIds.join("|") &&
          last.videoAssetIds.join("|") === message.videoAssetIds.join("|");
        if (isDuplicate) return variant;
        return { ...variant, history: [...history, message] };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),
  updateSelectedVariantIndex: (hash: CommitHash, index: number) => {
    const commit = get().commits[hash];
    if (!commit || index < 0 || index >= commit.variants.length) return;
    if (commit.selectedVariantIndex === index) return;

    // A selected DOM element belongs to the old variant's iframe document.
    useAppStore.getState().disableInSelectAndEditMode();
    set((state) => ({
      commits: {
        ...state.commits,
        [hash]: {
          ...state.commits[hash],
          selectedVariantIndex: index,
        },
      },
    }));
  },
  updateVariantStatus: (
    hash: CommitHash,
    numVariant: number,
    status: VariantStatus,
    errorMessage?: string
  ) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;

      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((variant, index) =>
              index === numVariant 
                ? {
                    ...variant,
                    status,
                    completedAt:
                      status === "generating"
                        ? undefined
                        : variant.completedAt ?? Date.now(),
                    errorMessage: status === "error" ? errorMessage : undefined,
                  }
                : variant
            ),
          },
        },
      };
    }),
  finalizeGeneratingVariants: (hash, status, errorMessage) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const completedAt = Date.now();
      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: commit.variants.map((variant) =>
              variant.status === "generating"
                ? {
                    ...variant,
                    status,
                    completedAt: variant.completedAt ?? completedAt,
                    errorMessage:
                      status === "error" ? errorMessage : undefined,
                  }
                : variant
            ),
          },
        },
      };
    }),
  resizeVariants: (hash: CommitHash, count: number) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit) return state; // No change if commit doesn't exist

      // Resize variants array to match backend count
      const currentVariants = commit.variants;
      const requestStartedAt = new Date(commit.dateCreated).getTime();
      const seedVariant = currentVariants[0];
      const seedHistory = seedVariant?.history || [];
      const seedTargetPath =
        seedVariant?.generationTargetPath ?? DEFAULT_PROJECT_ENTRY_POINT;
      const normalizedSeed = seedVariant
        ? updateProjectFileContent(
            normalizeProjectState(seedVariant),
            seedTargetPath,
            "",
            { force: true }
          )
        : normalizeProjectState({ code: "" });
      const newVariants = Array(count)
        .fill(null)
        .map((_, index) =>
          normalizeProjectState(
            currentVariants[index] || {
              code: normalizedSeed.code,
              files: normalizedSeed.files,
              entryPoint: normalizedSeed.entryPoint,
              activeFilePath: normalizedSeed.activeFilePath,
              generationTargetPath: seedTargetPath,
              history: seedHistory.map((message) => ({
                ...message,
                imageAssetIds: [...message.imageAssetIds],
                videoAssetIds: [...message.videoAssetIds],
              })),
              requestStartedAt,
              status: "generating" as VariantStatus,
              agentEvents: [],
            }
          )
        );

      return {
        commits: {
          ...state.commits,
          [hash]: {
            ...commit,
            variants: newVariants,
            selectedVariantIndex: Math.min(commit.selectedVariantIndex, count - 1),
          },
        },
      };
    }),
  setVariantModels: (hash: CommitHash, models: string[]) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => ({
        ...variant,
        model: models[index] ?? variant.model,
      }));
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  startAgentEvent: (hash, numVariant, event) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const events = variant.agentEvents || [];
        const existingIndex = events.findIndex((e) => e.id === event.id);
        if (existingIndex === -1) {
          return { ...variant, agentEvents: [...events, event] };
        }
        const updatedEvents = events.map((e) =>
          e.id === event.id
            ? {
                ...e,
                ...event,
                content: event.content ? event.content : e.content,
                startedAt: e.startedAt || event.startedAt,
              }
            : e
        );
        return { ...variant, agentEvents: updatedEvents };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  appendAgentEventContent: (hash, numVariant, eventId, content) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const events = variant.agentEvents || [];
        const updatedEvents = events.map((event) =>
          event.id === eventId
            ? { ...event, content: (event.content || "") + content }
            : event
        );
        return { ...variant, agentEvents: updatedEvents };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  finishAgentEvent: (hash, numVariant, eventId, updates) =>
    set((state) => {
      const commit = state.commits[hash];
      if (!commit || commit.isCommitted) return state;
      const variants = commit.variants.map((variant, index) => {
        if (index !== numVariant) return variant;
        const events = variant.agentEvents || [];
        const updatedEvents = events.map((event) =>
          event.id === eventId
            ? {
                ...event,
                ...updates,
                // Preserve the original terminal timestamp/status once set.
                endedAt:
                  event.endedAt !== undefined ? event.endedAt : updates.endedAt,
                status:
                  event.status !== "running" ? event.status : updates.status ?? event.status,
              }
            : event
        );
        return { ...variant, agentEvents: updatedEvents };
      });
      return {
        commits: {
          ...state.commits,
          [hash]: { ...commit, variants },
        },
      };
    }),

  setHead: (hash: CommitHash) => {
    // A target is a live element from the current preview document. It cannot
    // safely carry across versions, so every real version change exits select
    // mode before swapping the project head. All navigation entry points use
    // setHead (Previous/Next, Versions, and Back to latest).
    if (get().head === hash) return;
    useAppStore.getState().disableInSelectAndEditMode();
    set({ head: hash });
  },
  resetHead: () => set({ head: null }),

  executionConsoles: {},
  appendExecutionConsole: (variantIndex: number, line: string) =>
    set((state) => ({
      executionConsoles: {
        ...state.executionConsoles,
        [variantIndex]: [
          ...(state.executionConsoles[variantIndex] || []),
          line,
        ],
      },
    })),
  resetExecutionConsoles: () => set({ executionConsoles: {} }),
}));
