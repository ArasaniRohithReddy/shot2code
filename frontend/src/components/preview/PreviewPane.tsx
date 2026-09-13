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
} from "react-icons/lu";
import { useCallback, useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import toast from "react-hot-toast";
import { AppState, Settings } from "../../types";
import CodeTab from "./CodeTab";
import { Button } from "../ui/button";
import { useAppStore } from "../../store/app-store";
import { useProjectStore } from "../../store/project-store";
import { extractHtml } from "./extractHtml";
import PreviewComponent from "./PreviewComponent";
import { downloadCode } from "./download";
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
import {
  createProjectPreviewArtifact,
  getProjectExportState,
  normalizeProjectState,
  type ProjectPreviewArtifact,
} from "../../lib/project-files";

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
  onOpenVersions: () => void;
  activeTab: PreviewTab;
  onActiveTabChange: (tab: PreviewTab) => void;
  exportRequested: boolean;
  onExportRequestHandled: () => void;
}

export type PreviewTab = "desktop" | "mobile" | "code";

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

function PreviewPane({
  settings,
  onOpenVersions,
  activeTab,
  onActiveTabChange,
  exportRequested,
  onExportRequestHandled,
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

  // Sorted commit list for version navigation
  const sortedCommits = useMemo(() =>
    Object.values(commits).sort(
      (a, b) => new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
    ), [commits]);

  const currentVersionIndex = sortedCommits.findIndex(c => c.hash === head);
  const totalVersions = sortedCommits.length;
  const canGoPrev = currentVersionIndex > 0;
  const canGoNext = currentVersionIndex < totalVersions - 1;

  const currentCommit = head ? commits[head] : undefined;
  const selectedVariantIndex = currentCommit?.selectedVariantIndex ?? 0;
  const selectedVariant = currentCommit?.variants[selectedVariantIndex];
  const project = useMemo(
    () => normalizeProjectState(selectedVariant ?? { code: "" }),
    [selectedVariant]
  );

  const isSelectedVariantComplete = selectedVariant?.status === "complete";
  const previewArtifact = useMemo(
    () => createProjectPreviewArtifact(project),
    [project]
  );
  const composedPreviewCode = previewArtifact.html;
  const previewCode =
    inputMode === "video" && appState === AppState.CODING
      ? extractHtml(composedPreviewCode)
      : composedPreviewCode;
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
    previewArtifact.supportsSelectAndEdit &&
    (appState === AppState.CODE_READY || !!isSelectedVariantComplete);

  useEffect(() => {
    if (!previewArtifact.supportsSelectAndEdit) {
      disableInSelectAndEditMode();
    }
  }, [disableInSelectAndEditMode, previewArtifact.supportsSelectAndEdit]);

  const downloadPreviewArtifact = async () => {
    try {
      const result = await downloadCode(previewCode);
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
        stack: settings.generatedCodeConfig,
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
  }, [project, settings.generatedCodeConfig]);

  useEffect(() => {
    if (!exportRequested) return;
    void downloadProject().finally(onExportRequestHandled);
  }, [downloadProject, exportRequested, onExportRequestHandled]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          onActiveTabChange(value as PreviewTab);
          disableInSelectAndEditMode();
        }}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-2 py-2 dark:border-zinc-800 dark:bg-zinc-950 sm:px-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <TabsList>
              <TabsTrigger value="desktop" title="Desktop" data-testid="tab-desktop">
                <FaDesktop />
              </TabsTrigger>
              <TabsTrigger value="mobile" title="Mobile" data-testid="tab-mobile">
                <FaMobile />
              </TabsTrigger>
              <TabsTrigger value="code" title="Code" data-testid="tab-code" className="gap-2">
                <FaCode />
                Code
              </TabsTrigger>
            </TabsList>
            {(activeTab === "desktop" || activeTab === "mobile") && (
              <div className="inline-flex items-center gap-2">
                {activeTab === "desktop" && (
                  <div className="inline-flex items-center rounded-lg bg-gray-100 p-1 dark:bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => setDesktopViewMode("fit")}
                      title="Scale down to fit the screen"
                      className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        desktopViewMode === "fit"
                          ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                          : "text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      Scale
                      {desktopScale < 1 && (
                        <span className="ml-1 text-violet-600 dark:text-violet-300 font-bold">
                          ({Math.round(desktopScale * 100)}%)
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDesktopViewMode("actual")}
                      title="View at original size (100%)"
                      className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                        desktopViewMode === "actual"
                          ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-100"
                          : "text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      100%
                    </button>
                  </div>
                )}
                <Button
                  onClick={() => openInNewTab(previewCode)}
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

          {/* Version navigation */}
          {totalVersions > 0 && (
            <div className="order-3 flex w-full shrink-0 items-center justify-center gap-1 rounded-full border border-gray-200/50 bg-gray-100/50 p-1 backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-800/50 md:order-none md:w-auto">
              <Button
                onClick={() => canGoPrev && setHead(sortedCommits[currentVersionIndex - 1].hash)}
                variant="ghost"
                size="icon"
                title="Previous version"
                className={`h-11 w-11 rounded-full hover:bg-white dark:hover:bg-zinc-700 ${!canGoPrev ? "cursor-not-allowed opacity-30" : ""}`}
                disabled={!canGoPrev}
              >
                <LuChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <button
                type="button"
                onClick={onOpenVersions}
                className="flex min-h-11 w-32 cursor-pointer items-center justify-center gap-2 rounded-full px-1 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                title="View all versions"
              >
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 leading-none">
                  Version {currentVersionIndex + 1}
                </span>
                {currentVersionIndex === totalVersions - 1 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300 leading-none flex items-center h-4">
                    Latest
                  </span>
                )}
              </button>
              <Button
                onClick={() => canGoNext && setHead(sortedCommits[currentVersionIndex + 1].hash)}
                variant="ghost"
                size="icon"
                title="Next version"
                className={`h-11 w-11 rounded-full hover:bg-white dark:hover:bg-zinc-700 ${!canGoNext ? "cursor-not-allowed opacity-30" : ""}`}
                disabled={!canGoNext}
              >
                <LuChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          <div className="ml-auto flex shrink-0 self-start items-center gap-1">
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
                    <span className="block text-xs text-gray-500 dark:text-zinc-400">
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
                    <span className="block text-xs text-gray-500 dark:text-zinc-400">
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
        <TabsContent value="desktop" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          {showImageScanningPreview ? (
            <ImageScanningPreview imageUrl={sourceImage} />
          ) : (
            <>
              <PreviewArtifactNotice
                artifact={previewArtifact}
                fileCount={Object.keys(project.files).length}
              />
              <PreviewComponent
                code={previewCode}
                device="desktop"
                onScaleChange={setDesktopScale}
                viewMode={desktopViewMode}
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
              <PreviewArtifactNotice
                artifact={previewArtifact}
                fileCount={Object.keys(project.files).length}
              />
              <PreviewComponent
                code={previewCode}
                device="mobile"
                viewMode="actual"
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
            stack={selectedVariant?.stack ?? settings.generatedCodeConfig}
            settings={settings}
            readOnly={Boolean(currentCommit?.isCommitted)}
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
      </Tabs>
    </div>
  );
}

export default PreviewPane;
