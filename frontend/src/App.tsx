import { useCallback, useEffect, useRef, useState } from "react";
import { generateCode } from "./generateCode";
import {
  AppState,
  AppTheme,
  EditorTheme,
  MultiScreenshotMode,
  Settings,
} from "./types";
import { NEW_DESIGN_SYSTEM_CONTENT } from "./lib/design-systems";
import { OnboardingNote } from "./components/messages/OnboardingNote";
import { usePersistedState } from "./hooks/usePersistedState";
import { USER_CLOSE_WEB_SOCKET_CODE } from "./constants";
import toast from "react-hot-toast";
import { nanoid } from "nanoid";
import { Stack } from "./lib/stacks";
import { CodeGenerationModel } from "./lib/models";
import { buildGenerationContext } from "./lib/project-context-summary";
import useBrowserTabIndicator from "./hooks/useBrowserTabIndicator";
import { LuChevronLeft } from "react-icons/lu";
import {
  buildAssistantHistoryMessage,
  buildUpdateGenerationRequest,
  buildUserHistoryMessage,
  cloneVariantHistory,
  GenerationRequest,
  registerAssetIds,
} from "./lib/prompt-history";
// import TipLink from "./components/messages/TipLink";
import { useAppStore } from "./store/app-store";
import { useProjectStore } from "./store/project-store";
import { useDesignSystems } from "./hooks/useDesignSystems";
import { useProjectHistoryPersistence } from "./hooks/useProjectHistoryPersistence";
import { buildSelectedElementInstruction } from "./components/select-and-edit/utils";
import { useEscapeToExitSelectMode } from "./components/select-and-edit/useEscapeToExitSelectMode";
import Sidebar from "./components/sidebar/Sidebar";
import IconStrip from "./components/sidebar/IconStrip";
import HistoryDisplay from "./components/history/HistoryDisplay";
import PreviewPane, {
  type PreviewTab,
} from "./components/preview/PreviewPane";
import StartPane from "./components/start-pane/StartPane";
import SettingsTab from "./components/settings/SettingsTab";
import DesignSystemsModal from "./components/settings/DesignSystemsModal";
import ShortcutHelpDialog from "./components/shortcuts/ShortcutHelpDialog";
import type { InputTab } from "./components/unified-input/UnifiedInputPane";
import {
  Commit,
  CommitGenerationContext,
} from "./components/commits/types";
import { createCommit } from "./components/commits/utils";
import {
  getSelectedVariantState,
  getVariantUpdateUnavailableMessage,
} from "./components/commits/selectors";
import {
  createProjectStateFromImport,
  type EditableProjectImportSelection,
} from "./lib/project-import";
import {
  DEFAULT_PROJECT_ENTRY_POINT,
  getProjectGenerationContent,
  normalizeProjectState,
  setActiveProjectFile,
  updateProjectFileContent,
} from "./lib/project-files";
import { deriveProjectTitle } from "./lib/project-history";
import {
  buildRetryGenerationPlan,
  shouldRetainGenerationAttempt,
} from "./lib/retry-generation";
import {
  getAppShortcutCommand,
  isEditableShortcutTarget,
} from "./lib/app-shortcuts";

interface GenerationCommitOptions {
  generationBaseHash?: string | null;
  generationBaseVariantIndex?: number | null;
  commitParentHash?: string | null;
  retryOfHash?: string | null;
  generationContext?: CommitGenerationContext;
  initialVariantModels?: Array<string | undefined>;
  selectedVariantIndex?: number;
}

function App() {
  const {
    // Inputs
    inputMode,
    setInputMode,
    setReferenceImages,
    setInitialPrompt,
    setMultiScreenshotMode,
    upsertPromptAssets,
    projectStack,

    head,
    commits,
    addCommit,
    removeCommit,
    setHead,
    appendCommitCode,
    setCommitCode,
    updateVariantStatus,
    finalizeGeneratingVariants,
    resizeVariants,
    setVariantModels,
    appendVariantHistoryMessage,
    startAgentEvent,
    appendAgentEventContent,
    finishAgentEvent,

    // Outputs
    appendExecutionConsole,
    resetExecutionConsoles,
  } = useProjectStore();

  const {
    setUpdateInstruction,
    updateImages,
    setUpdateImages,
    appState,
    setAppState,
    selectedElement,
    setSelectedElement,
  } = useAppStore();

  // Settings
  const [settings, setSettings] = usePersistedState<Settings>(
    {
      openAiApiKey: null,
      openAiBaseURL: null,
      replicateApiKey: null,
      anthropicApiKey: null,
      geminiApiKey: null,
      screenshotOneApiKey: null,
      copilotGithubToken: null,
      copilotModels: [],
      isImageGenerationEnabled: true,
      editorTheme: EditorTheme.COBALT,
      generatedCodeConfig: Stack.HTML_TAILWIND,
      codeGenerationModel: CodeGenerationModel.GEMINI_3_FLASH_PREVIEW_MINIMAL,
      selectedDesignSystemId: null,
      projectContext: null,
    },
    "setting"
  );
  const [appTheme, setAppTheme] = usePersistedState<AppTheme>(
    AppTheme.SYSTEM,
    "app-theme"
  );

  const wsRef = useRef<WebSocket>(null);
  const lastThinkingEventIdRef = useRef<Record<number, string>>({});
  const lastAssistantEventIdRef = useRef<Record<number, string>>({});
  const lastToolEventIdRef = useRef<Record<number, string>>({});
  const cancelCodeGeneration = useCallback(() => {
    wsRef.current?.close?.(USER_CLOSE_WEB_SOCKET_CODE);
  }, []);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"preview" | "chat">("preview");
  const [activeInputTab, setActiveInputTab] = useState<InputTab>("upload");
  const [activePreviewTab, setActivePreviewTab] =
    useState<PreviewTab>("desktop");
  const [isExportRequested, setIsExportRequested] = useState(false);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const handleExportRequestHandled = useCallback(
    () => setIsExportRequested(false),
    []
  );
  const [isDesignSystemsModalOpen, setIsDesignSystemsModalOpen] =
    useState(false);
  const [designSystemsModalInitialId, setDesignSystemsModalInitialId] =
    useState<string | null>(null);
  const {
    designSystems,
    isLoading: areDesignSystemsLoading,
    createDesignSystem,
    updateDesignSystem,
    deleteDesignSystem,
  } = useDesignSystems();

  const projectHistory = useProjectHistoryPersistence({
    setSettings,
    cancelCodeGeneration,
    onProjectOpened: () => {
      setIsHistoryOpen(false);
      setIsSettingsOpen(false);
      setMobilePane("preview");
    },
  });

  const setSelectedDesignSystemId = useCallback(
    (id: string | null) => {
      setSettings((prev) => ({ ...prev, selectedDesignSystemId: id }));
    },
    [setSettings]
  );

  const openDesignSystemsManager = useCallback((focusedId?: string | null) => {
    setDesignSystemsModalInitialId(focusedId ?? null);
    setIsDesignSystemsModalOpen(true);
  }, []);

  const handleAddNewDesignSystem = useCallback(async () => {
    try {
      const isFirst = designSystems.length === 0;
      const created = await createDesignSystem({
        name: `Design system ${designSystems.length + 1}`,
        content: NEW_DESIGN_SYSTEM_CONTENT,
      });
      if (isFirst) {
        setSelectedDesignSystemId(created.id);
      }
      openDesignSystemsManager(created.id);
    } catch (error) {
      console.error("Failed to create design system", error);
      toast.error("Could not create design system.");
    }
  }, [
    createDesignSystem,
    designSystems.length,
    openDesignSystemsManager,
    setSelectedDesignSystemId,
  ]);
  // Indicate coding state using the browser tab's favicon and title
  useBrowserTabIndicator(appState === AppState.CODING);

  useEscapeToExitSelectMode();

  // When the user already has the settings in local storage, newly added keys
  // do not get added to the settings so if it's falsy, we populate it with the default
  // value
  useEffect(() => {
    if (!settings.generatedCodeConfig) {
      setSettings((prev) => ({
        ...prev,
        generatedCodeConfig: Stack.HTML_TAILWIND,
      }));
    }
  }, [settings.generatedCodeConfig, setSettings]);

  useEffect(() => {
    if (!("selectedDesignSystemId" in settings)) {
      setSettings((prev) => ({
        ...prev,
        selectedDesignSystemId: null,
      }));
    }
  }, [settings, setSettings]);


  useEffect(() => {
    if (
      settings.selectedDesignSystemId &&
      !areDesignSystemsLoading &&
      !designSystems.some(
        (designSystem) => designSystem.id === settings.selectedDesignSystemId
      )
    ) {
      setSettings((prev) => ({
        ...prev,
        selectedDesignSystemId: null,
      }));
    }
  }, [
    areDesignSystemsLoading,
    designSystems,
    settings.selectedDesignSystemId,
    setSettings,
  ]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const isDark =
        appTheme === AppTheme.DARK ||
        (appTheme === AppTheme.SYSTEM && mediaQuery.matches);
      document.documentElement.classList.toggle("dark", isDark);
      document.body.classList.toggle("dark", isDark);
    };

    applyTheme();

    if (appTheme !== AppTheme.SYSTEM) {
      return;
    }

    const onChange = () => applyTheme();
    mediaQuery.addEventListener("change", onChange);

    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, [appTheme]);

  const getAssetsById = () => useProjectStore.getState().assetsById;

  // Functions
  const reset = () => {
    projectHistory.clearForNewProject();
  };

  const regenerate = () => {
    if (head === null) {
      toast.error(
        "No current version set. Please contact support via chat or Github."
      );
      throw new Error("Regenerate called with no head");
    }

    const currentCommit = commits[head];
    if (!currentCommit) {
      toast.error("The selected version could not be found.");
      return;
    }

    const selectedDesignSystem = designSystems.find(
      (designSystem) => designSystem.id === settings.selectedDesignSystemId
    );

    try {
      const retryPlan = buildRetryGenerationPlan({
        sourceCommit: currentCommit,
        commits: useProjectStore.getState().commits,
        fallbackInputMode: inputMode,
        fallbackStack: projectStack,
        fallbackDesignSystem: buildGenerationContext(
          selectedDesignSystem?.content,
          settings.projectContext
        ),
        registerAssets: (type, dataUrls) =>
          registerAssetIds(
            type,
            dataUrls,
            getAssetsById,
            upsertPromptAssets,
            nanoid
          ),
        getAssetsById,
      });
      doGenerateCode(retryPlan.request, {
        generationBaseHash: retryPlan.generationBaseHash,
        generationBaseVariantIndex: retryPlan.generationBaseVariantIndex,
        commitParentHash: retryPlan.commitParentHash,
        retryOfHash: retryPlan.retryOfHash,
        generationContext: retryPlan.generationContext,
        initialVariantModels: retryPlan.initialVariantModels,
        selectedVariantIndex: retryPlan.selectedVariantIndex,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "This version could not be retried.";
      toast.error(message);
    }
  };

  // Used for user-initiated cancellation and failed edit rollbacks
  const cancelCodeGenerationAndReset = (commit: Commit) => {
    // When the current commit is the first version, reset the entire app state
    if (commit.type === "ai_create") {
      reset();
    } else {
      // Otherwise, remove current commit from commits
      removeCommit(commit.hash);

      // Revert to parent commit
      const parentCommitHash = commit.parentHash;
      if (parentCommitHash) {
        setHead(parentCommitHash);
      } else {
        throw new Error("Parent commit not found");
      }

      setAppState(AppState.CODE_READY);
    }
  };

  function doGenerateCode(
    params: GenerationRequest,
    options: GenerationCommitOptions = {}
  ) {
    // Reset the execution console
    resetExecutionConsoles();

    // Set the app state to coding during generation
    setAppState(AppState.CODING);

    const { variantHistory, ...requestParams } = params;

    const generationBaseHash =
      options.generationBaseHash !== undefined
        ? options.generationBaseHash
        : head;
    const generationParent = generationBaseHash
      ? useProjectStore.getState().commits[generationBaseHash]
      : undefined;
    const generationBaseVariantIndex = generationParent
      ? options.generationBaseVariantIndex ?? generationParent.selectedVariantIndex
      : null;
    const parentVariant =
      generationParent && generationBaseVariantIndex !== null
        ? generationParent.variants[generationBaseVariantIndex]
        : undefined;
    const selectedDesignSystem = designSystems.find(
      (designSystem) => designSystem.id === settings.selectedDesignSystemId
    );
    const defaultDesignContext = buildGenerationContext(
      selectedDesignSystem?.content,
      settings.projectContext
    );
    const generationContext: CommitGenerationContext = options.generationContext
      ? {
          ...options.generationContext,
          selectedModels: [...options.generationContext.selectedModels],
        }
      : {
          inputMode: requestParams.inputMode,
          stack: settings.generatedCodeConfig,
          selectedModels: [...(settings.copilotModels ?? [])],
          ...(requestParams.isAssetExtractionEnabled === undefined
            ? {}
            : {
                isAssetExtractionEnabled:
                  requestParams.isAssetExtractionEnabled,
              }),
          designSystem: defaultDesignContext ?? null,
          baseCommitHash:
            requestParams.generationType === "update"
              ? generationBaseHash
              : null,
          baseVariantIndex:
            requestParams.generationType === "update"
              ? generationBaseVariantIndex
              : null,
        };

    const updatedParams = {
      ...settings,
      ...requestParams,
      inputMode: generationContext.inputMode,
      generatedCodeConfig: generationContext.stack,
      copilotModels: [...generationContext.selectedModels],
      ...(generationContext.isAssetExtractionEnabled === undefined
        ? {}
        : {
            isAssetExtractionEnabled:
              generationContext.isAssetExtractionEnabled,
          }),
      designSystem: generationContext.designSystem ?? undefined,
    };

    // Seed the same option count/models on retries until the backend confirms
    // its selection, avoiding a transient reshuffle of the source options.
    const initialVariantModels = options.initialVariantModels ?? [];
    const initialVariantCount =
      initialVariantModels.length > 0
        ? initialVariantModels.length
        : requestParams.generationType === "create"
          ? 4
          : 2;
    const generationTargetPath =
      requestParams.fileState?.path ?? DEFAULT_PROJECT_ENTRY_POINT;

    const createGenerationVariant = (index: number) => {
      const history = cloneVariantHistory(variantHistory);
      if (requestParams.generationType !== "update" || !parentVariant) {
        return {
          code: "",
          generationTargetPath,
          history,
          stack: generationContext.stack,
          ...(initialVariantModels[index]
            ? { model: initialVariantModels[index] }
            : {}),
        };
      }

      const parentProject = normalizeProjectState(parentVariant);
      const clearedProject = updateProjectFileContent(
        parentProject,
        generationTargetPath,
        "",
        { force: true }
      );
      const activeProject = setActiveProjectFile(
        clearedProject,
        generationTargetPath
      );
      return {
        code: activeProject.code,
        files: activeProject.files,
        entryPoint: activeProject.entryPoint,
        activeFilePath: activeProject.activeFilePath,
        generationTargetPath,
        history,
        stack: parentVariant.stack ?? generationContext.stack,
        ...(initialVariantModels[index]
          ? { model: initialVariantModels[index] }
          : {}),
      };
    };

    const baseCommitObject = {
      variants: Array(initialVariantCount)
        .fill(null)
        .map((_, index) => createGenerationVariant(index)),
    };

    const commitParentHash =
      options.commitParentHash !== undefined
        ? options.commitParentHash
        : requestParams.generationType === "create"
          ? null
          : generationBaseHash;
    const commitInputObject = {
      ...baseCommitObject,
      parentHash: commitParentHash,
      retryOfHash: options.retryOfHash ?? null,
      generationContext,
      selectedVariantIndex: Math.min(
        options.selectedVariantIndex ?? 0,
        Math.max(0, initialVariantCount - 1)
      ),
      inputs: {
        ...requestParams.prompt,
        images: [...requestParams.prompt.images],
        videos: [...(requestParams.prompt.videos ?? [])],
      },
    };

    const commit = createCommit(
      requestParams.generationType === "create"
        ? { ...commitInputObject, type: "ai_create" as const }
        : { ...commitInputObject, type: "ai_edit" as const }
    );
    addCommit(commit);
    void projectHistory.persistMilestone("generation-start");

    lastThinkingEventIdRef.current = {};
    lastAssistantEventIdRef.current = {};
    lastToolEventIdRef.current = {};

    const finishThinkingEvent = (variantIndex: number, status: "complete" | "error") => {
      const eventId = lastThinkingEventIdRef.current[variantIndex];
      if (!eventId) return;
      finishAgentEvent(commit.hash, variantIndex, eventId, {
        status,
        endedAt: Date.now(),
      });
      delete lastThinkingEventIdRef.current[variantIndex];
    };

    const finishAssistantEvent = (variantIndex: number, status: "complete" | "error") => {
      const eventId = lastAssistantEventIdRef.current[variantIndex];
      if (!eventId) return;
      finishAgentEvent(commit.hash, variantIndex, eventId, {
        status,
        endedAt: Date.now(),
      });
      delete lastAssistantEventIdRef.current[variantIndex];
    };

    const finishToolEvent = (variantIndex: number, status: "complete" | "error") => {
      const eventId = lastToolEventIdRef.current[variantIndex];
      if (!eventId) return;
      finishAgentEvent(commit.hash, variantIndex, eventId, {
        status,
        endedAt: Date.now(),
      });
      delete lastToolEventIdRef.current[variantIndex];
    };

    const finishInFlightEvents = (status: "complete" | "error") => {
      Object.keys(lastThinkingEventIdRef.current).forEach((key) => {
        finishThinkingEvent(Number(key), status);
      });
      Object.keys(lastAssistantEventIdRef.current).forEach((key) => {
        finishAssistantEvent(Number(key), status);
      });
      Object.keys(lastToolEventIdRef.current).forEach((key) => {
        finishToolEvent(Number(key), status);
      });
    };

    generateCode(wsRef, updatedParams, {
      onChange: (token, variantIndex) => {
        appendCommitCode(commit.hash, variantIndex, token);
      },
      onSetCode: (code, variantIndex) => {
        setCommitCode(commit.hash, variantIndex, code);
      },
      onStatusUpdate: (line, variantIndex) =>
        appendExecutionConsole(variantIndex, line),
      onVariantComplete: (variantIndex) => {
        console.log(`Variant ${variantIndex} complete event received`);
        updateVariantStatus(commit.hash, variantIndex, "complete");
        const completedVariant =
          useProjectStore.getState().commits[commit.hash]?.variants[variantIndex];
        const currentCode = completedVariant
          ? getProjectGenerationContent(completedVariant)
          : "";
        if (currentCode.trim().length > 0) {
          appendVariantHistoryMessage(
            commit.hash,
            variantIndex,
            buildAssistantHistoryMessage(currentCode)
          );
        }
        finishThinkingEvent(variantIndex, "complete");
        finishAssistantEvent(variantIndex, "complete");
        finishToolEvent(variantIndex, "complete");
        if (commit.type === "ai_edit") {
          const {
            updateInstruction: currentInstruction,
            updateImages: currentImages,
          } = useAppStore.getState();
          const instructionUnchanged =
            currentInstruction === commit.inputs.text;
          const imagesUnchanged =
            currentImages.length === commit.inputs.images.length &&
            currentImages.every(
              (image, index) => image === commit.inputs.images[index]
            );

          // This conditional clear handles three UX scenarios:
          // 1) All variants fail: no completion event, so keep prompt/images for retry.
          // 2) A variant completes and user has typed/changed images: do not clear.
          // 3) A variant completes and user has not changed draft: clear for next edit.
          if (instructionUnchanged && imagesUnchanged) {
            setUpdateInstruction("");
            setUpdateImages([]);
          }
        }
        void projectHistory.persistMilestone("status");
      },
      onVariantError: (variantIndex, error) => {
        console.error(`Error in variant ${variantIndex}:`, error);
        updateVariantStatus(commit.hash, variantIndex, "error", error);
        finishThinkingEvent(variantIndex, "error");
        finishAssistantEvent(variantIndex, "error");
        finishToolEvent(variantIndex, "error");
        void projectHistory.persistMilestone("status");
      },
      onVariantCount: (count) => {
        console.log(`Backend is using ${count} variants`);
        resizeVariants(commit.hash, count);
      },
      onVariantModels: (models) => {
        setVariantModels(commit.hash, models);
      },
      onThinking: (content, variantIndex, eventId) => {
        if (!eventId) return;
        lastThinkingEventIdRef.current[variantIndex] = eventId;
        startAgentEvent(commit.hash, variantIndex, {
          id: eventId,
          type: "thinking",
          status: "running",
          startedAt: Date.now(),
        });
        appendAgentEventContent(commit.hash, variantIndex, eventId, content);
      },
      onAssistant: (content, variantIndex, eventId) => {
        if (!eventId) return;
        lastAssistantEventIdRef.current[variantIndex] = eventId;
        startAgentEvent(commit.hash, variantIndex, {
          id: eventId,
          type: "assistant",
          status: "running",
          startedAt: Date.now(),
        });
        appendAgentEventContent(commit.hash, variantIndex, eventId, content);
      },
      onToolStart: (data, variantIndex, eventId) => {
        if (!eventId) return;
        const lastThinking = lastThinkingEventIdRef.current[variantIndex];
        if (lastThinking && lastThinking !== eventId) {
          finishThinkingEvent(variantIndex, "complete");
        }
        const lastAssistant = lastAssistantEventIdRef.current[variantIndex];
        if (lastAssistant && lastAssistant !== eventId) {
          finishAssistantEvent(variantIndex, "complete");
        }
        startAgentEvent(commit.hash, variantIndex, {
          id: eventId,
          type: "tool",
          status: "running",
          toolName: data?.name,
          input: data?.input,
          startedAt: Date.now(),
        });
        lastToolEventIdRef.current[variantIndex] = eventId;
      },
      onToolResult: (data, variantIndex, eventId) => {
        if (!eventId) return;
        finishAgentEvent(commit.hash, variantIndex, eventId, {
          status: data?.ok === false ? "error" : "complete",
          output: data?.output,
          endedAt: Date.now(),
        });
        if (lastToolEventIdRef.current[variantIndex] === eventId) {
          delete lastToolEventIdRef.current[variantIndex];
        }
      },
      onCancel: (reason, errorMessage) => {
        // The project may have been reset while this generation was still in
        // flight — a stale cancellation must not mutate app state.
        if (!useProjectStore.getState().commits[commit.hash]) return;

        // Close any running agent events when the socket ends without per-event
        // terminal messages, otherwise they remain stuck in "running" state.
        finishInFlightEvents(
          reason === "user_cancelled" ? "complete" : "error"
        );

        if (shouldRetainGenerationAttempt(commit, reason)) {
          finalizeGeneratingVariants(
            commit.hash,
            reason === "user_cancelled" ? "cancelled" : "error",
            reason === "user_cancelled"
              ? undefined
              : errorMessage || "Generation failed. Please retry."
          );
          setAppState(AppState.CODE_READY);
          void projectHistory.persistMilestone("final");
          return;
        }

        cancelCodeGenerationAndReset(commit);
      },
      onComplete: () => {
        // Same guard as onCancel: a generation finishing after its project
        // was reset must not pull the app back into the editor.
        if (!useProjectStore.getState().commits[commit.hash]) return;
        finishInFlightEvents("complete");
        setAppState(AppState.CODE_READY);
        void projectHistory.persistMilestone("final");
      },
    });
  }

  // Initial version creation
  function doCreate(
    referenceImages: string[],
    inputMode: "image" | "video",
    textPrompt: string = "",
    isAssetExtractionEnabled = true,
    multiScreenshotMode?: MultiScreenshotMode
  ) {
    // Reset any existing state
    reset();

    // Set the input states
    setReferenceImages(referenceImages);
    setInputMode(inputMode);
    setInitialPrompt(textPrompt);
    setMultiScreenshotMode(multiScreenshotMode ?? "pages");

    // Kick off the code generation
    if (referenceImages.length > 0) {
      const media =
        inputMode === "video" ? [referenceImages[0]] : referenceImages;
      projectHistory.startProject({
        title: deriveProjectTitle({
          prompt: textPrompt,
          inputMode,
          referenceCount: media.length,
        }),
        stack: settings.generatedCodeConfig,
      });
      const imageAssetIds =
        inputMode === "image"
          ? registerAssetIds(
              "image",
              media,
              getAssetsById,
              upsertPromptAssets,
              nanoid
            )
          : [];
      const videoAssetIds =
        inputMode === "video"
          ? registerAssetIds(
              "video",
              media,
              getAssetsById,
              upsertPromptAssets,
              nanoid
            )
          : [];
      const effectiveMultiScreenshotMode =
        inputMode === "image" && media.length > 1
          ? multiScreenshotMode ?? "pages"
          : undefined;
      const variantHistory = [
        buildUserHistoryMessage(
          textPrompt,
          imageAssetIds,
          videoAssetIds,
          effectiveMultiScreenshotMode
        ),
      ];
      doGenerateCode({
        generationType: "create",
        inputMode,
        prompt: {
          text: textPrompt,
          images: inputMode === "image" ? media : [],
          videos: inputMode === "video" ? media : [],
          multiImageMode: effectiveMultiScreenshotMode,
        },
        // Asset extraction operates on still screenshots. Video data uses the
        // same transport shape for Gemini, so explicitly disable extraction
        // instead of letting the agent try to crop a video payload.
        isAssetExtractionEnabled:
          inputMode === "image" && isAssetExtractionEnabled,
        variantHistory,
      });
    }
  }

  function doCreateFromText(text: string) {
    // Reset any existing state
    reset();

    setInputMode("text");
    setInitialPrompt(text);
    projectHistory.startProject({
      title: deriveProjectTitle({ prompt: text, inputMode: "text" }),
      stack: settings.generatedCodeConfig,
    });
    doGenerateCode({
      generationType: "create",
      inputMode: "text",
      prompt: { text, images: [], videos: [] },
      variantHistory: [buildUserHistoryMessage(text)],
    });
  }

  // Subsequent updates
  async function doUpdate(updateInstruction: string) {
    if (updateInstruction.trim() === "") {
      toast.error("Please include some instructions for AI on what to update.");
      return;
    }

    if (head === null) {
      toast.error(
        "No current version set. Contact support or open a Github issue."
      );
      throw new Error("Update called with no head");
    }

    const currentCommit = useProjectStore.getState().commits[head];
    if (!currentCommit) {
      toast.error("The selected version could not be found.");
      return;
    }

    const selectedVariantState = getSelectedVariantState(currentCommit);
    if (!selectedVariantState.variant) {
      toast.error("The selected option could not be found.");
      return;
    }
    if (!selectedVariantState.canUpdate) {
      toast.error(
        getVariantUpdateUnavailableMessage(selectedVariantState.status)
      );
      return;
    }

    let modifiedUpdateInstruction = updateInstruction;
    let selectedElementHtml: string | undefined;

    // Send in a reference to the selected element if it exists. Selection
    // visuals are overlays, so the element's outerHTML is already clean.
    if (selectedElement) {
      selectedElementHtml = selectedElement.outerHTML;
      modifiedUpdateInstruction = buildSelectedElementInstruction(
        updateInstruction,
        selectedElement.outerHTML,
        selectedElement.context || undefined
      );
      setSelectedElement(null);
    }

    const updateImageAssetIds = registerAssetIds(
      "image",
      updateImages,
      getAssetsById,
      upsertPromptAssets,
      nanoid
    );

    doGenerateCode(
      buildUpdateGenerationRequest({
        inputMode,
        prompt: {
          text: updateInstruction,
          fullText: modifiedUpdateInstruction,
          images: updateImages,
          videos: [],
          selectedElementHtml,
        },
        parentCommit: currentCommit,
        imageAssetIds: updateImageAssetIds,
        getAssetsById,
      })
    );
  }

  function setStack(stack: Stack) {
    setSettings((prev) => ({
      ...prev,
      generatedCodeConfig: stack,
    }));
  }

  function importFromCode(code: string, stack: Stack) {
    reset();
    setStack(stack);
    setInputMode("text");
    projectHistory.startProject({
      title: deriveProjectTitle({ inputMode: "import" }),
      stack,
    });

    const commit = createCommit({
      type: "code_create",
      parentHash: null,
      variants: [
        {
          code,
          history: [],
          status: "complete",
          completedAt: Date.now(),
          stack,
        },
      ],
      inputs: null,
    });
    addCommit(commit);
    setAppState(AppState.CODE_READY);
  }

  function importProject({
    project,
    stack,
  }: EditableProjectImportSelection) {
    reset();
    setStack(stack);
    setInputMode("text");
    projectHistory.startProject({
      title: deriveProjectTitle({
        inputMode: "import",
        importedName: project.name,
      }),
      stack,
    });

    const normalizedProject = createProjectStateFromImport(project);
    const commit = createCommit({
      type: "code_create",
      parentHash: null,
      variants: [
        {
          ...normalizedProject,
          history: [],
          status: "complete",
          completedAt: Date.now(),
          stack,
        },
      ],
      inputs: null,
    });

    addCommit(commit);
    setAppState(AppState.CODE_READY);
    toast.success(
      `Opened ${project.name} with ${project.files.length} editable files.`
    );
  }

  const openStartPane = (tab: InputTab) => {
    setActiveInputTab(tab);
    reset();
    setIsHistoryOpen(false);
    setIsSettingsOpen(false);
    setMobilePane("preview");
  };
  const openStartPaneRef = useRef(openStartPane);
  const regenerateRef = useRef(regenerate);
  openStartPaneRef.current = openStartPane;
  regenerateRef.current = regenerate;

  const isCodingOrReady =
    appState === AppState.CODING || appState === AppState.CODE_READY;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const command = getAppShortcutCommand(event);
      if (!command) return;

      const openDialog = document.querySelector(
        '[role="dialog"][data-state="open"]'
      );
      if (
        openDialog ||
        (isEditableShortcutTarget(event.target) &&
          command !== "export-project")
      ) {
        return;
      }

      event.preventDefault();

      const requireProject = () => {
        if (isCodingOrReady) return true;
        toast("Open or create a project to use this shortcut.");
        return false;
      };

      switch (command) {
        case "new-project":
          openStartPaneRef.current("upload");
          break;
        case "open-import":
          openStartPaneRef.current("import");
          break;
        case "open-upload":
          openStartPaneRef.current("upload");
          break;
        case "show-preview":
          if (!requireProject()) break;
          setIsSettingsOpen(false);
          setIsHistoryOpen(false);
          setMobilePane("preview");
          setActivePreviewTab("desktop");
          break;
        case "show-code":
          if (!requireProject()) break;
          setIsSettingsOpen(false);
          setIsHistoryOpen(false);
          setMobilePane("preview");
          setActivePreviewTab("code");
          break;
        case "show-chat":
          if (!requireProject()) break;
          setIsSettingsOpen(false);
          setIsHistoryOpen(false);
          setMobilePane("chat");
          window.setTimeout(() => {
            document
              .querySelector<HTMLTextAreaElement>(
                '[data-testid="update-input"]'
              )
              ?.focus();
          }, 0);
          break;
        case "show-versions":
          if (!requireProject()) break;
          setIsSettingsOpen(false);
          setIsHistoryOpen(true);
          setMobilePane("chat");
          break;
        case "show-settings":
          setIsSettingsOpen(true);
          setIsHistoryOpen(false);
          break;
        case "export-project":
          if (!requireProject()) break;
          if (
            appState !== AppState.CODE_READY &&
            (!head ||
              getSelectedVariantState(commits[head]).status !== "complete")
          ) {
            toast("Wait for an option to finish before exporting.");
            break;
          }
          setIsSettingsOpen(false);
          setIsExportRequested(true);
          break;
        case "retry-generation": {
          if (!requireProject()) break;
          if (appState !== AppState.CODE_READY) {
            toast("Wait for generation to finish before retrying.");
            break;
          }
          const commit = head ? commits[head] : undefined;
          if (commit?.type !== "ai_create" && commit?.type !== "ai_edit") {
            toast("Retry is available for AI-generated versions.");
            break;
          }
          regenerateRef.current();
          break;
        }
        case "show-shortcuts":
          setIsShortcutHelpOpen(true);
          break;
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [appState, commits, head, isCodingOrReady]);

  const showContentPanel =
    appState === AppState.CODING ||
    appState === AppState.CODE_READY ||
    isHistoryOpen;
  const showMobileChatPane = showContentPanel && mobilePane === "chat";

  return (
    <div
      className={`dark:bg-black dark:text-white ${
        appState === AppState.CODING || appState === AppState.CODE_READY
          ? "flex h-dvh flex-col overflow-hidden xl:block xl:h-screen"
          : "min-h-screen"
      }`}
    >
      {/* Icon strip - always visible */}
      <div
        className="sticky top-0 z-50 xl:fixed xl:inset-y-0 xl:z-50 xl:flex xl:w-16 xl:flex-col"
      >
        <IconStrip
          isHistoryOpen={isHistoryOpen}
          isEditorOpen={!isHistoryOpen && !isSettingsOpen}
          isSettingsOpen={isSettingsOpen}
          showHistory={isCodingOrReady}
          showEditor={isCodingOrReady}
          onToggleHistory={() => {
            setIsHistoryOpen((prev) => !prev);
            setIsSettingsOpen(false);
            setMobilePane("chat");
          }}
          onToggleEditor={() => {
            setIsHistoryOpen(false);
            setIsSettingsOpen(false);
            setMobilePane("preview");
          }}
          onLogoClick={() => {
            setIsHistoryOpen(false);
            setIsSettingsOpen(false);
            setMobilePane("preview");
          }}
          onNewProject={() => {
            openStartPane("upload");
          }}
          onOpenShortcuts={() => setIsShortcutHelpOpen(true)}
          onOpenSettings={() => {
            setIsSettingsOpen(true);
            setIsHistoryOpen(false);
          }}
        />
      </div>

      {isCodingOrReady && !isSettingsOpen && (
        <div className="border-b border-gray-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950 xl:hidden">
          <div className="grid grid-cols-2 rounded-xl bg-gray-100 p-1 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => {
                setIsHistoryOpen(false);
                setMobilePane("preview");
              }}
              aria-pressed={mobilePane === "preview" && !isHistoryOpen}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mobilePane === "preview"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-gray-500 dark:text-zinc-400"
              }`}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setMobilePane("chat")}
              aria-pressed={mobilePane === "chat"}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mobilePane === "chat"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-gray-500 dark:text-zinc-400"
              }`}
            >
              Chat
            </button>
          </div>
        </div>
      )}

      {/* Content panel - shows sidebar, history, or editor */}
      {showContentPanel && !isSettingsOpen && (
        <div
          className={`min-h-0 border-b border-gray-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 dark:text-white xl:fixed xl:inset-y-0 xl:left-16 xl:z-40 xl:flex xl:w-80 xl:flex-col xl:border-b-0 xl:border-r ${
            showMobileChatPane
              ? "flex flex-1 flex-col overflow-hidden"
              : "hidden xl:flex"
          }`}
        >
            {isHistoryOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto sidebar-scrollbar-stable px-4">
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Versions</h2>
                    <button
                      onClick={() => setIsHistoryOpen(false)}
                      className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      <LuChevronLeft className="w-3.5 h-3.5" />
                      Back to editor
                    </button>
                  </div>
                  <HistoryDisplay />
                </div>
              </div>
            ) : (
              <>
                {!settings.openAiApiKey &&
                  !settings.anthropicApiKey &&
                  !settings.geminiApiKey && (
                    <div className="px-6 mt-4">
                      <OnboardingNote />
                    </div>
                  )}

                {(appState === AppState.CODING ||
                  appState === AppState.CODE_READY) && (
                  <Sidebar
                    doUpdate={doUpdate}
                    regenerate={regenerate}
                    cancelCodeGeneration={cancelCodeGeneration}
                    designSystem={{
                      designSystems,
                      selectedDesignSystemId: settings.selectedDesignSystemId,
                      setSelectedDesignSystemId,
                      onAddNew: handleAddNewDesignSystem,
                      onManage: () => openDesignSystemsManager(),
                    }}
                    modelSelector={{
                      selectedModels: settings.copilotModels ?? [],
                      setSelectedModels: (models) =>
                        setSettings((s) => ({ ...s, copilotModels: models })),
                      githubToken: settings.copilotGithubToken,
                    }}
                    historyError={projectHistory.historyError}
                    onOpenVersions={() => {
                      setIsHistoryOpen(true);
                      setMobilePane("chat");
                    }}
                  />
                )}
              </>
            )}
        </div>
      )}

      <main
        className={`${
          isSettingsOpen
            ? "flex flex-1 min-h-0 flex-col xl:h-full xl:pl-16"
            : showContentPanel
              ? "flex flex-1 min-h-0 flex-col xl:h-full xl:pl-96"
              : "xl:pl-16"
        } ${isCodingOrReady && !isSettingsOpen && mobilePane === "chat" ? "hidden xl:flex" : ""}`}
      >
        {isSettingsOpen ? (
          <SettingsTab
            settings={settings}
            setSettings={setSettings}
            appTheme={appTheme}
            setAppTheme={setAppTheme}
          />
        ) : (
          <>
            {appState === AppState.INITIAL && (
              <StartPane
                activeInputTab={activeInputTab}
                onActiveInputTabChange={setActiveInputTab}
                doCreate={doCreate}
                doCreateFromText={doCreateFromText}
                importFromCode={importFromCode}
                importProject={importProject}
                settings={settings}
                setSettings={setSettings}
                designSystems={designSystems}
                onAddNewDesignSystem={handleAddNewDesignSystem}
                onManageDesignSystems={() => openDesignSystemsManager()}
                recentProjects={projectHistory.recentProjects}
                isLoadingRecentProjects={
                  projectHistory.isLoadingRecentProjects
                }
                historyError={projectHistory.historyError}
                busyProjectId={projectHistory.busyProjectId}
                onOpenProject={projectHistory.openProject}
                onDeleteProject={projectHistory.deleteProject}
                onNewProject={() => openStartPane("upload")}
              />
            )}

            {isCodingOrReady && (
              <PreviewPane
                settings={settings}
                activeTab={activePreviewTab}
                onActiveTabChange={setActivePreviewTab}
                exportRequested={isExportRequested}
                onExportRequestHandled={handleExportRequestHandled}
                onOpenVersions={() => {
                  setIsHistoryOpen(true);
                  setMobilePane("chat");
                }}
              />
            )}
          </>
        )}
      </main>

      <DesignSystemsModal
        open={isDesignSystemsModalOpen}
        onOpenChange={setIsDesignSystemsModalOpen}
        designSystems={designSystems}
        selectedDesignSystemId={settings.selectedDesignSystemId}
        setSelectedDesignSystemId={setSelectedDesignSystemId}
        initialEditingId={designSystemsModalInitialId}
        createDesignSystem={createDesignSystem}
        updateDesignSystem={updateDesignSystem}
        deleteDesignSystem={deleteDesignSystem}
      />
      <ShortcutHelpDialog
        open={isShortcutHelpOpen}
        onOpenChange={setIsShortcutHelpOpen}
      />
    </div>
  );
}

export default App;
