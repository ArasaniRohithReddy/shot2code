import { useAppStore } from "../../store/app-store";
import { useProjectStore } from "../../store/project-store";
import { AppState } from "../../types";
import { Button } from "../ui/button";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  LuMousePointerClick,
  LuRefreshCw,
  LuArrowUp,
  LuX,
  LuHistory,
} from "react-icons/lu";
import { toast } from "react-hot-toast";

import Variants from "../variants/Variants";
import ConversationEmptyState from "./ConversationEmptyState";
import UpdateImageUpload, { UpdateImagePreview } from "../UpdateImageUpload";
import AgentActivity from "../agent/AgentActivity";
import { formatCompletedGenerationDuration } from "../agent/generation-time";
import WorkingPulse from "../core/WorkingPulse";
import ImageLightbox from "../ImageLightbox";
import {
  getCancelledVariantRecoveryMessage,
  getSelectedVariantState,
} from "../commits/selectors";
import { CodeGenerationModel } from "../../lib/models";
import DesignSystemSelector, {
  DesignSystemSelectorProps,
} from "../settings/DesignSystemSelector";
import ModelSelector, {
  ModelSelectorProps,
} from "../settings/ModelSelector";
import ConversationThread from "./ConversationThread";
import {
  appendUpdateImageFiles,
  clipboardImageFiles,
  MAX_UPDATE_IMAGES,
  UPDATE_IMAGE_TYPES,
} from "../../lib/update-images";

interface SidebarProps {
  doUpdate: (instruction: string) => void;
  regenerate: () => void;
  cancelCodeGeneration: () => void;
  onOpenHistory: () => void;
  onOpenCode: () => void;
  designSystem: DesignSystemSelectorProps;
  modelSelector: ModelSelectorProps;
  historyError?: string | null;
}

function isSlowModel(model?: string): boolean {
  return (
    model === CodeGenerationModel.GEMINI_3_1_PRO_PREVIEW_HIGH ||
    model === CodeGenerationModel.GEMINI_3_1_PRO_PREVIEW_MEDIUM ||
    model === CodeGenerationModel.GPT_5_6_SOL_MAX
  );
}

function Sidebar({
  doUpdate,
  regenerate,
  cancelCodeGeneration,
  onOpenHistory,
  onOpenCode,
  designSystem,
  modelSelector,
  historyError,
}: SidebarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const middlePaneRef = useRef<HTMLDivElement>(null);
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const {
    appState,
    updateInstruction,
    setUpdateInstruction,
    updateImages,
    setUpdateImages,
    inSelectAndEditMode,
    toggleInSelectAndEditMode,
    selectedElement,
    setSelectedElement,
  } = useAppStore();

  const addUpdateImageFiles = useCallback(
    async (files: File[], source: "drop" | "paste") => {
      if (files.length === 0) return;
      try {
        const result = await appendUpdateImageFiles(updateImages, files);
        if (result.truncated > 0 || updateImages.length >= MAX_UPDATE_IMAGES) {
          toast.error(
            `You can attach at most ${MAX_UPDATE_IMAGES} reference images.`
          );
        }
        if (result.rejected > 0) {
          toast.error(
            "Some images were skipped. Use PNG, JPEG, or WebP files up to 10 MB."
          );
        }
        if (result.duplicates > 0) {
          toast("Duplicate screenshots were not added again.");
        }
        if (result.added > 0 && source === "paste") {
          toast.success(
            `Pasted ${result.added} screenshot${result.added === 1 ? "" : "s"}.`
          );
        }
        setUpdateImages(result.images);
      } catch (error) {
        toast.error("Could not read the image from the clipboard.");
        console.error("Error reading image files:", error);
      }
    },
    [updateImages, setUpdateImages]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files).filter(
        (file) => UPDATE_IMAGE_TYPES.has(file.type.toLowerCase())
      );
      await addUpdateImageFiles(files, "drop");
    },
    [addUpdateImageFiles]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length > 0) {
        void addUpdateImageFiles(files, "paste");
      }
    },
    [addUpdateImageFiles]
  );

  const { head, commits, latestCommitHash, setHead } = useProjectStore();

  const currentCommit = head ? commits[head] : null;
  const selectedVariantIndex = currentCommit?.selectedVariantIndex ?? 0;
  const selectedVariantState = getSelectedVariantState(currentCommit);
  const selectedVariant = selectedVariantState.variant;
  const selectedVariantEvents = selectedVariant?.agentEvents ?? [];
  const showWorkingIndicator =
    selectedVariantState.isGenerating &&
    selectedVariantEvents.length === 0 &&
    head === latestCommitHash;
  const requestStartMs =
    selectedVariant?.requestStartedAt ??
    (currentCommit?.dateCreated
      ? new Date(currentCommit.dateCreated).getTime()
      : undefined);
  const elapsedSeconds = requestStartMs
    ? Math.max(1, Math.round((nowMs - requestStartMs) / 1000))
    : undefined;
  const totalGenerationTime = formatCompletedGenerationDuration(
    selectedVariant?.status,
    requestStartMs,
    selectedVariant?.completedAt
  );

  const canRegenerate =
    currentCommit?.type === "ai_create" || currentCommit?.type === "ai_edit";
  const isViewingOlderVersion = head !== null && head !== latestCommitHash;

  // Compute version number for the current head
  const totalVersions = Object.keys(commits).length;
  const currentVersionNumber = (() => {
    if (!head) return null;
    const sorted = Object.values(commits).sort(
      (a, b) => new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
    );
    const index = sorted.findIndex((c) => c.hash === head);
    return index !== -1 ? index + 1 : null;
  })();

  const canUpdateSelectedVariant = selectedVariantState.canUpdate;
  const isSelectedVariantError = selectedVariantState.isError;
  const isSelectedVariantCancelled = selectedVariantState.isCancelled;
  const selectedVariantErrorMessage = selectedVariant?.errorMessage;
  const hasMultipleOptions = (currentCommit?.variants.length ?? 0) > 1;
  // Nothing has been asked yet: one version, no agent trace to read. Replace
  // the empty column with openers instead of dead space.
  const showConversationEmptyState =
    canUpdateSelectedVariant &&
    !isViewingOlderVersion &&
    totalVersions === 1 &&
    selectedVariantEvents.length === 0;

  // Auto-resize textarea to fit content
  const autoResize = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, []);

  // Starters land in the composer rather than sending straight away, so the
  // suggestion stays editable.
  const applyStarter = useCallback(
    (instruction: string) => {
      setUpdateInstruction(instruction);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length
        );
      });
    },
    [setUpdateInstruction]
  );

  // Focus the composer whenever a completed option becomes selected.
  useEffect(() => {
    if (canUpdateSelectedVariant && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [canUpdateSelectedVariant, head, selectedVariantIndex]);

  // Focus the textarea when an element is selected in the preview
  useEffect(() => {
    if (selectedElement && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selectedElement]);

  // Reset textarea height when instruction changes externally (e.g., cleared after submit)
  useEffect(() => {
    autoResize();
  }, [updateInstruction, autoResize]);

  // Reset error expanded state when variant changes
  useEffect(() => {
    setIsErrorExpanded(false);
  }, [head, selectedVariantIndex]);

  useEffect(() => {
    if (!middlePaneRef.current) return;
    requestAnimationFrame(() => {
      if (!middlePaneRef.current) return;
      middlePaneRef.current.scrollTop = middlePaneRef.current.scrollHeight;
    });
  }, [head, selectedVariantIndex]);

  useEffect(() => {
    if (!selectedVariantState.isGenerating) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [selectedVariantState.isGenerating]);

  return (
    <div
      id="selected-variant-panel"
      role="region"
      aria-label={`Option ${selectedVariantIndex + 1} details`}
      className="flex h-full min-h-0 flex-col"
    >
      {hasMultipleOptions && (
        <div className="shrink-0 border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-2">
          <Variants />
        </div>
      )}

      {historyError && (
        <div
          role="alert"
          className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
        >
          {historyError}
        </div>
      )}

      {/* Prominent banner when viewing an older version */}
      {isViewingOlderVersion && currentVersionNumber !== null && (
        <div className="shrink-0 border-b border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 px-4 py-2.5">
          {/* Wraps rather than squeezing: at the narrowest panel width the two
              actions drop below the label instead of truncating to icons. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <LuHistory className="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-violet-900 dark:text-violet-200 truncate">
                  Viewing v{currentVersionNumber} of {totalVersions}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={onOpenHistory}
                aria-label={`Open History, currently viewing version ${currentVersionNumber} of ${totalVersions}`}
                className="min-h-11 rounded-lg border border-violet-400 dark:border-violet-600 px-3 py-1.5 text-xs font-semibold text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                Open History
              </button>
              <button
                onClick={() => latestCommitHash && setHead(latestCommitHash)}
                className="min-h-11 rounded-lg bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400 px-3 py-1.5 text-xs font-semibold text-white dark:text-violet-950 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                Back to latest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={middlePaneRef}
        className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto sidebar-scrollbar-stable px-4 pt-4"
      >
        <ConversationThread
          commits={commits}
          head={head}
          onOpenImage={setLightboxImage}
        />

        {showWorkingIndicator && (
          <div className="working-indicator-bg mb-3 rounded-xl border border-violet-200 dark:border-violet-800 px-3 py-2 transition-all duration-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <WorkingPulse />
                <span>Working...</span>
              </div>
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                Time so far {elapsedSeconds ? `${elapsedSeconds}s` : "--"}
              </div>
            </div>
          </div>
        )}

        {currentCommit?.type === "ai_create" &&
          selectedVariantState.isGenerating &&
          head === latestCommitHash &&
          isSlowModel(selectedVariant?.model) && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Slow, high quality model. May take 5-10 mins on some images/videos.
          </div>
        )}

        {!isViewingOlderVersion && <AgentActivity />}

        {showConversationEmptyState && (
          <ConversationEmptyState
            variant={
              currentCommit?.type === "code_create" ? "imported" : "generated"
            }
            onUseStarter={applyStarter}
            onOpenCode={onOpenCode}
          />
        )}

        {/* Retry any AI-generated version. The retry is a new descendant of
            the selected source while replaying its original request context. */}
        {canRegenerate && appState === AppState.CODE_READY && (
          <div className="mb-3 flex items-center justify-end gap-2">
            {totalGenerationTime && (
              <span
                className="text-[11px] font-medium tabular-nums text-gray-400 dark:text-gray-500"
                data-testid="total-generation-time"
              >
                {totalGenerationTime}
              </span>
            )}
            <button
              onClick={regenerate}
              className="regenerate-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <LuRefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        )}

        {/* Show cancel button when coding */}
        {appState === AppState.CODING && !canUpdateSelectedVariant && (
          <div className="flex w-full">
            <Button
              onClick={cancelCodeGeneration}
              className="w-full dark:text-white dark:bg-gray-700"
            >
              Cancel All Generations
            </Button>
          </div>
        )}

        {/* Show error message when selected option has an error */}
        {isSelectedVariantError && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3 mb-2">
            <div className="text-red-800 dark:text-red-200 text-sm">
              <div className="font-medium mb-1">
                This option failed to generate because
              </div>
              {selectedVariantErrorMessage && (
                <div className="mb-2">
                  <div className="text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded px-2 py-1 text-xs font-mono break-words">
                    {selectedVariantErrorMessage.length > 200 && !isErrorExpanded
                      ? `${selectedVariantErrorMessage.slice(0, 200)}...`
                      : selectedVariantErrorMessage}
                  </div>
                  {selectedVariantErrorMessage.length > 200 && (
                    <button
                      onClick={() => setIsErrorExpanded(!isErrorExpanded)}
                      className="text-red-600 dark:text-red-400 text-xs underline mt-1 hover:text-red-800 dark:hover:text-red-300"
                    >
                      {isErrorExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              )}
              <div>
                {canRegenerate
                  ? "Click Retry to run this version's request again."
                  : "Switch to another option above to make updates."}
              </div>
            </div>
          </div>
        )}

        {isSelectedVariantCancelled && (
          <div
            className="mb-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            role="status"
          >
            {getCancelledVariantRecoveryMessage(currentCommit)}
          </div>
        )}
      </div>

      {/* Pinned bottom: prompt box + option selector */}
      {canUpdateSelectedVariant && (
        <div
            className="shrink-0 border-t border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900 px-3 py-3"
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDragging(false);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {/* Branching notice when editing an older version */}
            {isViewingOlderVersion && currentVersionNumber !== null && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 px-3 py-2">
                <LuHistory className="w-3.5 h-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                <span className="text-xs text-violet-800 dark:text-violet-200">
                  You're editing <span className="font-semibold">v{currentVersionNumber}</span> — updates will create a new version branching from it.
                </span>
              </div>
            )}

            {/* Select and edit indicator */}
            {inSelectAndEditMode && (
              <div className="mb-2">
                {selectedElement ? (
                  <div className="flex items-center justify-between rounded-xl border border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/20 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <LuMousePointerClick className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                      <span className="text-sm text-violet-700 dark:text-violet-300 truncate">
                        Selected: <code className="font-mono text-xs bg-violet-100 dark:bg-violet-800/50 px-1.5 py-0.5 rounded">&lt;{selectedElement.tagName.toLowerCase()}&gt;</code>
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedElement(null)}
                      className="shrink-0 ml-3 p-0.5 text-violet-400 hover:text-violet-700 dark:hover:text-violet-200 transition-colors"
                      title="Clear selection"
                    >
                      <LuX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <LuMousePointerClick className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400 shrink-0" />
                      <span className="text-sm font-medium text-violet-700 dark:text-violet-300">Click an element to edit it</span>
                    </div>
                    <button
                      onClick={toggleInSelectAndEditMode}
                      className="shrink-0 ml-3 text-sm text-violet-500 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-200 transition-colors"
                    >
                      Exit
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="relative w-full overflow-hidden rounded-2xl border-2 border-violet-300 bg-white transition-all focus-within:border-violet-500 dark:border-violet-500/50 dark:bg-zinc-900 dark:focus-within:border-violet-400">
              <UpdateImagePreview
                updateImages={updateImages}
                setUpdateImages={setUpdateImages}
              />
              <textarea
                ref={textareaRef}
                placeholder={
                  inSelectAndEditMode && selectedElement
                    ? `Describe changes for the selected <${selectedElement.tagName.toLowerCase()}> element...`
                    : "Tell the AI what to change..."
                }
                onChange={(e) => {
                  setUpdateInstruction(e.target.value);
                  autoResize();
                }}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    doUpdate(updateInstruction);
                  }
                }}
                value={updateInstruction}
                aria-label={`Update option ${selectedVariantIndex + 1}`}
                data-testid="update-input"
                rows={1}
                className="max-h-40 w-full resize-none border-0 bg-transparent px-3.5 pt-3.5 pb-5 text-[15px] leading-6 text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <p className="sr-only" aria-live="polite">
                Paste screenshots with Control V or Command V. Up to five PNG,
                JPEG, or WebP images can be attached.
              </p>
              {/* The controls wrap under the composer when the panel is narrow;
                  Send is never part of that wrap, so it stays reachable. */}
              <div className="flex items-end justify-between gap-2 px-2.5 pb-2.5">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  <UpdateImageUpload
                    updateImages={updateImages}
                    setUpdateImages={setUpdateImages}
                  />
                  <button
                    onClick={toggleInSelectAndEditMode}
                    aria-pressed={inSelectAndEditMode}
                    data-testid="select-edit-toggle-prompt"
                    className={`flex h-11 w-11 items-center justify-center rounded-lg p-2 transition-colors ${
                      inSelectAndEditMode
                        ? "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
                        : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    }`}
                    title={inSelectAndEditMode ? "Exit selection mode" : "Select an element in the preview to target your edit"}
                  >
                    <LuMousePointerClick className="w-[18px] h-[18px]" />
                  </button>
                  <DesignSystemSelector {...designSystem} compact />
                  <ModelSelector {...modelSelector} />
                </div>
                <button
                  onClick={() => doUpdate(updateInstruction)}
                  aria-label={`Send update for option ${selectedVariantIndex + 1}`}
                  disabled={!updateInstruction.trim()}
                  className={`update-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-2 transition-colors ${
                    updateInstruction.trim()
                      ? "bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
                      : "cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-zinc-700 dark:text-zinc-500"
                  }`}
                  title="Send"
                >
                  <LuArrowUp className="w-[18px] h-[18px]" strokeWidth={2.5} />
                </button>
              </div>

              {isDragging && (
                <div className="absolute inset-0 bg-blue-50/90 dark:bg-gray-800/90 border-2 border-dashed border-blue-400 dark:border-blue-600 rounded-xl flex items-center justify-center pointer-events-none z-10">
                  <p className="text-blue-600 dark:text-blue-400 font-medium">Drop images here</p>
                </div>
              )}
            </div>
        </div>
      )}

      <ImageLightbox
        image={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </div>
  );
}

export default Sidebar;
