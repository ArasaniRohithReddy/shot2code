import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import {
  FaDesktop,
  FaMobile,
  FaCode,
} from "react-icons/fa";
import {
  LuChevronLeft,
  LuChevronRight,
  LuExternalLink,
  LuRefreshCw,
  LuDownload,
  LuFileCode2,
  LuAlertTriangle,
  LuHistory,
  LuListChecks,
} from "react-icons/lu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import toast from "react-hot-toast";
import { AppState, Settings } from "../../types";
import CodeTab from "./CodeTab";
import { Button } from "../ui/button";
import { useAppStore } from "../../store/app-store";
import { useProjectStore } from "../../store/project-store";
import { extractHtml } from "./extractHtml";
import PreviewComponent from "./PreviewComponent";
import {
  downloadCode,
  loadExportPreview,
  type ExportPreview,
} from "./download";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { SelectAndEditToolbarButton } from "../select-and-edit/SelectAndEditControls";
import { normalizeBabelCdn } from "../../lib/babelCdn";
import {
  createSandboxedPreviewDocument,
  PREVIEW_SANDBOX,
} from "../../lib/preview-bridge";
import ImageScanningPreview from "./ImageScanningPreview";
import useMediaQuery, { SM_MEDIA_QUERY } from "../../hooks/useMediaQuery";
import {
  createProjectPreviewArtifact,
  getProjectExportState,
  normalizeProjectState,
  type ProjectPreviewArtifact,
} from "../../lib/project-files";
import ReviewWorkspace from "./ReviewWorkspace";
import { hashReviewProjectFiles } from "../../lib/review";
import type { ReviewBinding } from "../../lib/review";
import {
  createExportRuntimePreview,
  type ExportRuntimePreview,
} from "../../lib/export-runtime-preview";

function escapeSrcDocAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function createPreviewWindowDocument(code: string) {
  const preview = createSandboxedPreviewDocument(
    normalizeBabelCdn(code),
    nanoid(32)
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>shot2code preview</title>
  <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#fff}body{overflow:hidden}</style>
</head>
<body>
  <iframe title="shot2code preview" sandbox="${PREVIEW_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${escapeSrcDocAttribute(preview.html)}"></iframe>
</body>
</html>`;
}

function openInNewTab(code: string) {
  const blob = new Blob([createPreviewWindowDocument(code)], {
    type: "text/html",
  });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

interface Props {
  settings: Settings;
  onOpenHistory: () => void;
  activeTab: PreviewTab;
  onActiveTabChange: (tab: PreviewTab) => void;
  exportRequested: boolean;
  onExportRequestHandled: () => void;
  onFixReviewFindings: (
    instruction: string,
    binding: ReviewBinding
  ) => void;
}

export type PreviewTab = "desktop" | "mobile" | "review" | "code";
type PreviewSource = "html" | "stack";

function PreviewArtifactNotice({
  artifact,
  fileCount,
}: {
  artifact: ProjectPreviewArtifact;
  fileCount: number;
}) {
  const isFallback = artifact.kind !== "html-entry";
  const omittedCount = artifact.omittedFilePaths.length;
  const resolvedAssetCount = artifact.resolvedAssetPaths.length;
  let detail = "Standalone HTML preview";

  if (artifact.kind === "html-fallback") {
    detail = `Static HTML fallback for ${artifact.projectEntryPoint}`;
  } else if (artifact.kind === "source-fallback") {
    detail = `${artifact.projectEntryPoint} requires its application runtime; all ${fileCount} files remain in Code`;
  } else if (artifact.inlinedFilePaths.length > 0) {
    detail = `${artifact.inlinedFilePaths.length} local CSS/JS ${
      artifact.inlinedFilePaths.length === 1 ? "file" : "files"
    } inlined`;
  }

  if (resolvedAssetCount > 0) {
    detail += `; ${resolvedAssetCount} local ${
      resolvedAssetCount === 1 ? "asset" : "assets"
    } embedded`;
  }

  if (omittedCount > 0) {
    detail += `; unsupported: ${artifact.omittedFilePaths.join(", ")}`;
  }

  return (
    <div
      role="status"
      title={
        artifact.diagnostics.length > 0
          ? artifact.diagnostics.map((diagnostic) => diagnostic.message).join(" ")
          : detail
      }
      className={`flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs ${
        isFallback || omittedCount > 0
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
          : "border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
      }`}
    >
      {isFallback || omittedCount > 0 ? (
        <LuAlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <LuFileCode2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words">
        <span className="font-semibold">Preview artifact:</span>{" "}
        <code className="font-mono">
          {artifact.sourcePath ?? "safe fallback.html"}
        </code>{" "}
        <span aria-hidden="true">-</span> {detail}
      </span>
    </div>
  );
}

function StackPreviewNotice({
  preview,
  runtime,
}: {
  preview: ExportPreview;
  runtime: ExportRuntimePreview;
}) {
  const isReady = runtime.status === "ready";
  return (
    <div
      role="status"
      className={`flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs ${
        isReady
          ? "border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
      }`}
    >
      {isReady ? (
        <LuFileCode2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <LuAlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words">
        <span className="font-semibold">Stack project:</span>{" "}
        <code className="font-mono">{preview.projectKind}</code>{" "}
        <span aria-hidden="true">-</span> {runtime.detail}. Rendered from{" "}
        {Object.keys(preview.files).length} export text files inside the
        existing browser sandbox; no package scripts or project configuration
        were executed.
      </span>
    </div>
  );
}

function PreviewPane({
  settings,
  onOpenHistory,
  activeTab,
  onActiveTabChange,
  exportRequested,
  onExportRequestHandled,
  onFixReviewFindings,
}: Props) {
  const { appState, disableInSelectAndEditMode } = useAppStore();
  const {
    inputMode,
    head,
    commits,
    setHead,
    setVariantActiveFile,
    setVariantFileContent,
  } = useProjectStore();
  const [desktopScale, setDesktopScale] = useState(1);
  const [desktopViewMode, setDesktopViewMode] = useState<"fit" | "actual">("fit");
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);
  const [previewSource, setPreviewSource] = useState<PreviewSource>("html");
  // Below `sm` the 1366px canvas at 100% is unusable, so the choice is hidden
  // and the preview stays scaled instead of stranding the user at 100%.
  const canChooseDesktopZoom = useMediaQuery(SM_MEDIA_QUERY);
  const effectiveDesktopViewMode = canChooseDesktopZoom
    ? desktopViewMode
    : "fit";

  // Sorted commit list for version navigation
  const sortedCommits = useMemo(() =>
    Object.values(commits).sort(
      (a, b) => new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
    ), [commits]);

  const currentVersionIndex = sortedCommits.findIndex(c => c.hash === head);
  const totalVersions = sortedCommits.length;
  const canGoPrev = currentVersionIndex > 0;
  const canGoNext = currentVersionIndex < totalVersions - 1;
  const isLatestVersion = currentVersionIndex === totalVersions - 1;

  const currentCommit = head ? commits[head] : undefined;
  const selectedVariantIndex = currentCommit?.selectedVariantIndex ?? 0;
  const selectedVariant = currentCommit?.variants[selectedVariantIndex];
  const isSelectedVariantComplete = selectedVariant?.status === "complete";
  const project = useMemo(
    () => normalizeProjectState(selectedVariant ?? { code: "" }),
    [selectedVariant]
  );
  const activeStack = selectedVariant?.stack ?? settings.generatedCodeConfig;
  const projectExportState = useMemo(
    () => getProjectExportState(project),
    [project]
  );
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);
  const [exportPreviewError, setExportPreviewError] = useState<string | null>(
    null
  );
  const [isExportPreviewLoading, setIsExportPreviewLoading] = useState(false);
  const exportPreviewRequestRef = useRef<{
    controller: AbortController;
    promise: Promise<ExportPreview | null>;
  } | null>(null);

  useEffect(() => {
    exportPreviewRequestRef.current?.controller.abort();
    exportPreviewRequestRef.current = null;
    setExportPreview(null);
    setExportPreviewError(null);
    setIsExportPreviewLoading(false);
    setPreviewSource("html");
    return () => {
      exportPreviewRequestRef.current?.controller.abort();
    };
  }, [activeStack, projectExportState]);

  const ensureExportPreview = useCallback((): Promise<ExportPreview | null> => {
    if (exportPreview) return Promise.resolve(exportPreview);
    if (exportPreviewRequestRef.current) {
      return exportPreviewRequestRef.current.promise;
    }

    const controller = new AbortController();
    setIsExportPreviewLoading(true);
    setExportPreviewError(null);
    const promise = loadExportPreview(project.code, {
      stack: activeStack,
      project: projectExportState,
      signal: controller.signal,
    })
      .then((nextPreview) => {
        if (exportPreviewRequestRef.current?.controller !== controller) {
          return null;
        }
        setExportPreview(nextPreview);
        return nextPreview;
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return null;
        const message =
          caught instanceof Error
            ? caught.message
            : "Could not prepare the stack project preview.";
        setExportPreviewError(message);
        toast.error(message);
        return null;
      })
      .finally(() => {
        if (exportPreviewRequestRef.current?.controller === controller) {
          exportPreviewRequestRef.current = null;
          setIsExportPreviewLoading(false);
        }
      });
    exportPreviewRequestRef.current = { controller, promise };
    return promise;
  }, [activeStack, exportPreview, project.code, projectExportState]);

  const exportRuntimePreview = useMemo(
    () => (exportPreview ? createExportRuntimePreview(exportPreview) : null),
    [exportPreview]
  );
  const showStackPreview = useCallback(async () => {
    const nextPreview = exportPreview ?? (await ensureExportPreview());
    if (nextPreview) setPreviewSource("stack");
  }, [ensureExportPreview, exportPreview]);

  const previewArtifact = useMemo(
    () => createProjectPreviewArtifact(project),
    [project]
  );
  const composedPreviewCode = previewArtifact.html;
  const reviewCodeHash = useMemo(
    () => hashReviewProjectFiles(project.files),
    [project.files]
  );
  const previewCode =
    inputMode === "video" && appState === AppState.CODING
      ? extractHtml(composedPreviewCode)
      : composedPreviewCode;
  const activePreviewCode =
    previewSource === "stack" && exportRuntimePreview
      ? exportRuntimePreview.artifact.html
      : previewCode;
  const sourceImage =
    currentCommit && currentCommit.type !== "code_create"
      ? currentCommit.inputs.images[0]
      : undefined;
  const showImageScanningPreview =
    appState === AppState.CODING &&
    currentCommit?.type === "ai_create" &&
    inputMode === "image" &&
    !previewCode.trim() &&
    !!sourceImage;

  const canSelectAndEdit =
    previewSource === "html" &&
    previewArtifact.supportsSelectAndEdit &&
    (appState === AppState.CODE_READY || !!isSelectedVariantComplete);

  useEffect(() => {
    if (
      previewSource !== "html" ||
      !previewArtifact.supportsSelectAndEdit
    ) {
      disableInSelectAndEditMode();
    }
  }, [
    disableInSelectAndEditMode,
    previewArtifact.supportsSelectAndEdit,
    previewSource,
  ]);

  const downloadPreviewArtifact = async () => {
    try {
      const result = await downloadCode(activePreviewCode);
      toast.success(`Downloaded preview artifact: ${result.filename}`);
    } catch (error) {
      console.error("Failed to download preview artifact", error);
      toast.error("Could not download the preview artifact.");
    }
  };

  const downloadProject = useCallback(async () => {
    try {
      const result = await downloadCode(project.code, {
        splitFiles: true,
        stack: activeStack,
        project: getProjectExportState(project),
      });
      if (result.kind === "project-backup") {
        toast(
          `Export service unavailable. Downloaded all files in ${result.filename}.`
        );
        return;
      }
      toast.success(`Downloaded project: ${result.filename}`);
    } catch (error) {
      console.error("Failed to download project", error);
      toast.error("Could not export the project.");
    }
  }, [activeStack, project]);

  useEffect(() => {
    if (!exportRequested) return;
    void downloadProject().finally(onExportRequestHandled);
  }, [downloadProject, exportRequested, onExportRequestHandled]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          onActiveTabChange(value as PreviewTab);
          disableInSelectAndEditMode();
        }}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="relative flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-200 bg-white px-2 py-2 dark:border-zinc-800 dark:bg-zinc-950 sm:px-3">
          {/* View controls: what is being previewed, and at what size */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TabsList aria-label="Preview workspace views">
              <TabsTrigger
                value="desktop"
                title="Desktop"
                aria-label="Desktop preview"
                data-testid="tab-desktop"
                className="text-gray-700 dark:text-zinc-300"
              >
                <FaDesktop aria-hidden="true" />
              </TabsTrigger>
              <TabsTrigger
                value="mobile"
                title="Mobile"
                aria-label="Mobile preview"
                data-testid="tab-mobile"
                className="text-gray-700 dark:text-zinc-300"
              >
                <FaMobile aria-hidden="true" />
              </TabsTrigger>
              <TabsTrigger
                value="review"
                title="Compare responsive widths and audit source"
                aria-label="Review responsive layouts and source accessibility"
                data-testid="tab-review"
                className="gap-2 text-gray-700 dark:text-zinc-300"
              >
                <LuListChecks aria-hidden="true" />
                Review
              </TabsTrigger>
              <TabsTrigger
                value="code"
                title="Code"
                data-testid="tab-code"
                className="gap-2 text-gray-700 dark:text-zinc-300"
              >
                <FaCode aria-hidden="true" />
                Code
              </TabsTrigger>
            </TabsList>
            {(activeTab === "desktop" || activeTab === "mobile") && (
              <div className="inline-flex items-center gap-2">
                <div
                  role="group"
                  aria-label="Preview source"
                  className="inline-flex items-center rounded-lg bg-gray-100 p-0.5 dark:bg-zinc-800"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewSource("html")}
                    aria-pressed={previewSource === "html"}
                    className={`min-h-11 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                      previewSource === "html"
                        ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                        : "text-gray-600 hover:text-gray-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                    }`}
                  >
                    HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => void showStackPreview()}
                    aria-pressed={previewSource === "stack"}
                    disabled={
                      isExportPreviewLoading ||
                      !(
                        appState === AppState.CODE_READY ||
                        isSelectedVariantComplete
                      )
                    }
                    title={
                      appState === AppState.CODE_READY ||
                      isSelectedVariantComplete
                        ? "Render the generated stack project files in the sandbox"
                        : "Stack preview is available after generation completes"
                    }
                    className={`min-h-11 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 ${
                      previewSource === "stack"
                        ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                        : "text-gray-600 hover:text-gray-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                    }`}
                  >
                    {isExportPreviewLoading ? "Loading stack…" : "Stack"}
                  </button>
                </div>
                {activeTab === "desktop" && canChooseDesktopZoom && (
                  <div
                    role="group"
                    aria-label="Desktop preview size"
                    className="inline-flex items-center rounded-lg bg-gray-100 p-0.5 dark:bg-zinc-800"
                  >
                    <button
                      type="button"
                      onClick={() => setDesktopViewMode("fit")}
                      title="Scale the 1366px canvas down to fit the window"
                      aria-pressed={desktopViewMode === "fit"}
                      aria-label={
                        desktopScale < 1
                          ? `Fit the preview to the window, currently ${Math.round(
                              desktopScale * 100
                            )} percent`
                          : "Fit the preview to the window"
                      }
                      className={`min-h-11 rounded-md px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                        desktopViewMode === "fit"
                          ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                          : "text-gray-600 hover:text-gray-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                      }`}
                    >
                      Fit
                      {desktopScale < 1 && (
                        <span className="ml-1 font-semibold tabular-nums text-violet-700 dark:text-violet-200">
                          {Math.round(desktopScale * 100)}%
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDesktopViewMode("actual")}
                      title="Show the 1366px canvas at its original size"
                      aria-pressed={desktopViewMode === "actual"}
                      aria-label="Show the preview at 100 percent"
                      className={`min-h-11 rounded-md px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                        desktopViewMode === "actual"
                          ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                          : "text-gray-600 hover:text-gray-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                      }`}
                    >
                      100%
                    </button>
                  </div>
                )}
                <Button
                  onClick={() => openInNewTab(activePreviewCode)}
                  variant="ghost"
                  size="icon"
                  title="Open preview artifact in new tab"
                  aria-label="Open preview artifact in new tab"
                  className="h-11 w-11"
                >
                  <LuExternalLink />
                </Button>
              </div>
            )}
          </div>

          {/* History navigation and artifact actions */}
          <div className="flex flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {totalVersions > 0 && (
              <div
                role="group"
                aria-label="Project history"
                className="flex shrink-0 items-center gap-0.5 rounded-full border border-gray-200 bg-gray-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <Button
                  onClick={() => canGoPrev && setHead(sortedCommits[currentVersionIndex - 1].hash)}
                  variant="ghost"
                  size="icon"
                  title="Previous version"
                  aria-label="Go to the previous version"
                  className={`hidden h-11 w-11 rounded-full hover:bg-white dark:hover:bg-zinc-700 lg:inline-flex ${!canGoPrev ? "cursor-not-allowed opacity-40" : ""}`}
                  disabled={!canGoPrev}
                >
                  <LuChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <button
                  type="button"
                  onClick={onOpenHistory}
                  data-testid="open-history"
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-gray-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-200 dark:hover:bg-zinc-700"
                  title="Open History (Ctrl+4)"
                  aria-label={`Open History, version ${currentVersionIndex + 1} of ${totalVersions}`}
                >
                  <LuHistory className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="text-xs font-semibold leading-none">
                    History
                  </span>
                  <span
                    className={`flex h-5 items-center rounded-full px-1.5 text-[10px] font-semibold leading-none tabular-nums ${
                      isLatestVersion
                        ? "bg-gray-200 text-gray-700 dark:bg-zinc-700 dark:text-zinc-100"
                        : "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200"
                    }`}
                  >
                    {currentVersionIndex + 1}/{totalVersions}
                  </span>
                </button>
                <Button
                  onClick={() => canGoNext && setHead(sortedCommits[currentVersionIndex + 1].hash)}
                  variant="ghost"
                  size="icon"
                  title="Next version"
                  aria-label="Go to the next version"
                  className={`hidden h-11 w-11 rounded-full hover:bg-white dark:hover:bg-zinc-700 lg:inline-flex ${!canGoNext ? "cursor-not-allowed opacity-40" : ""}`}
                  disabled={!canGoNext}
                >
                  <LuChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}

            <div className="flex shrink-0 items-center gap-1">
              {canSelectAndEdit &&
                (activeTab === "desktop" || activeTab === "mobile") && (
                  <SelectAndEditToolbarButton />
                )}
              {(appState === AppState.CODE_READY || isSelectedVariantComplete) && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Download preview artifact or full project"
                      aria-label="Download preview artifact or full project"
                      className="h-11 w-11"
                      data-testid="download-code"
                    >
                      <LuDownload />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 p-2">
                    <button
                      type="button"
                      onClick={() => void downloadPreviewArtifact()}
                      aria-label="Download the composed preview HTML artifact"
                      className="w-full cursor-pointer rounded px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-zinc-800"
                    >
                      <span className="block font-medium">Preview HTML</span>
                      <span className="block text-xs text-gray-600 dark:text-zinc-300">
                        The composed, self-contained preview entry
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadProject()}
                      aria-label={`Download the full project with ${Object.keys(project.files).length} files`}
                      data-testid="download-project"
                      className="w-full cursor-pointer rounded px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-zinc-800"
                    >
                      <span className="block font-medium">Project folder</span>
                      <span className="block text-xs text-gray-600 dark:text-zinc-300">
                        ZIP of all {Object.keys(project.files).length} files; complete JSON backup if export is unavailable
                      </span>
                    </button>
                  </PopoverContent>
                </Popover>
              )}
              <Button
                onClick={() => setPreviewRefreshToken((value) => value + 1)}
                variant="ghost"
                size="icon"
                title="Refresh preview artifact"
                aria-label="Refresh preview artifact"
                className="h-11 w-11"
              >
                <LuRefreshCw />
              </Button>
            </div>
          </div>
        </div>
        <TabsContent value="desktop" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          {showImageScanningPreview ? (
            <ImageScanningPreview imageUrl={sourceImage} />
          ) : (
            <>
              {previewSource === "stack" &&
              exportPreview &&
              exportRuntimePreview ? (
                <StackPreviewNotice
                  preview={exportPreview}
                  runtime={exportRuntimePreview}
                />
              ) : (
                <PreviewArtifactNotice
                  artifact={previewArtifact}
                  fileCount={Object.keys(project.files).length}
                />
              )}
              <PreviewComponent
                code={activePreviewCode}
                device="desktop"
                onScaleChange={setDesktopScale}
                viewMode={effectiveDesktopViewMode}
                refreshToken={previewRefreshToken}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="mobile" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          {showImageScanningPreview ? (
            <ImageScanningPreview imageUrl={sourceImage} />
          ) : (
            <>
              {previewSource === "stack" &&
              exportPreview &&
              exportRuntimePreview ? (
                <StackPreviewNotice
                  preview={exportPreview}
                  runtime={exportRuntimePreview}
                />
              ) : (
                <PreviewArtifactNotice
                  artifact={previewArtifact}
                  fileCount={Object.keys(project.files).length}
                />
              )}
              <PreviewComponent
                code={activePreviewCode}
                device="mobile"
                viewMode="fit"
                refreshToken={previewRefreshToken}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="code" className="flex-1 min-h-0 mt-0 overflow-hidden">
          <CodeTab
            files={project.files}
            activeFilePath={project.activeFilePath}
            entryPoint={project.entryPoint}
            previewSourcePath={previewArtifact.sourcePath}
            previewArtifact={previewArtifact}
            stack={activeStack}
            settings={settings}
            readOnly={Boolean(currentCommit?.isCommitted)}
            exportPreview={exportPreview}
            exportPreviewError={exportPreviewError}
            isExportPreviewLoading={isExportPreviewLoading}
            onLoadExportPreview={ensureExportPreview}
            onSelectFile={(path) => {
              if (head && currentCommit) {
                setVariantActiveFile(head, selectedVariantIndex, path);
              }
            }}
            onFileChange={(path, content) => {
              if (head && currentCommit) {
                setVariantFileContent(
                  head,
                  selectedVariantIndex,
                  path,
                  content
                );
              }
            }}
          />
        </TabsContent>
        <TabsContent
          forceMount
          value="review"
          className="mt-0 min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <ReviewWorkspace
            active={activeTab === "review"}
            html={previewCode}
            codeHash={reviewCodeHash}
            sourcePath={previewArtifact.sourcePath}
            commitHash={head}
            variantIndex={selectedVariantIndex}
            refreshToken={previewRefreshToken}
            modelId={selectedVariant?.model}
            settings={settings}
            onFixSelectedFindings={onFixReviewFindings}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PreviewPane;
