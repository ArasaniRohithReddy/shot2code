import { useCallback, useEffect, useMemo, useRef } from "react";
import { FaCodepen } from "react-icons/fa";
import {
  LuAlignLeft,
  LuCopy,
  LuDownload,
  LuLock,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuWand2,
} from "react-icons/lu";
import copy from "copy-to-clipboard";
import toast from "react-hot-toast";
import CodeMirror from "./CodeMirror";
import ProjectFileExplorer from "./ProjectFileExplorer";
import PaneResizer from "../workspace/PaneResizer";
import { usePersistedState } from "../../hooks/usePersistedState";
import useMediaQuery, { XL_MEDIA_QUERY } from "../../hooks/useMediaQuery";
import { useElementWidth } from "../../hooks/useElementWidth";
import {
  clampFileExplorerWidth,
  FILE_EXPLORER_WIDTH,
  FILE_EXPLORER_WIDTH_STORAGE_KEY,
  getFileExplorerBounds,
  resolvePaneWidth,
} from "../../lib/pane-sizing";
import { Settings } from "../../types";
import type { Stack } from "../../lib/stacks";
import type {
  ProjectFileLanguage,
  ProjectFileMap,
  ProjectPreviewArtifact,
} from "../../lib/project-files";
import {
  canFormatLanguage,
  describeUnsupportedLanguage,
  formatSource,
} from "../../lib/format-source";
import { downloadProjectFile } from "./download";
import { createCodePenShareResult, submitCodePenPayload } from "./codepen";

interface Props {
  files: ProjectFileMap;
  activeFilePath: string;
  entryPoint: string;
  previewSourcePath: string | null;
  previewArtifact: ProjectPreviewArtifact;
  stack: Stack;
  settings: Settings;
  readOnly?: boolean;
  onSelectFile: (path: string) => void;
  onFileChange: (path: string, content: string) => void;
}

type ExplorerPreference = "auto" | "open" | "closed";

const LANGUAGE_LABELS: Record<ProjectFileLanguage, string> = {
  html: "HTML",
  css: "CSS",
  javascript: "JavaScript",
  jsx: "JSX",
  typescript: "TypeScript",
  tsx: "TSX",
  json: "JSON",
  markdown: "Markdown",
  vue: "Vue",
  xml: "XML",
  yaml: "YAML",
  text: "Plain text",
};

const TOOLBAR_BUTTON =
  "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-0 text-sm text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 2xl:px-3";

const BADGE =
  "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight";

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function directoryName(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index + 1);
}

function CodeTab({
  files,
  activeFilePath,
  entryPoint,
  previewSourcePath,
  previewArtifact,
  stack,
  settings,
  readOnly = false,
  onSelectFile,
  onFileChange,
}: Props) {
  const filePaths = useMemo(
    () => Object.keys(files).sort((a, b) => a.localeCompare(b)),
    [files]
  );
  const activeFile = files[activeFilePath] ?? files[filePaths[0]];
  const activeTabIndex = activeFile
    ? Math.max(0, filePaths.indexOf(activeFile.path))
    : 0;
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // A one-file project should not pay a permanent 224px for a tree with a
  // single leaf, so "auto" tracks the file count until the user decides.
  const [explorerPreference, setExplorerPreference] =
    usePersistedState<ExplorerPreference>("auto", "workspace-file-explorer");
  const isExplorerOpen =
    explorerPreference === "auto"
      ? filePaths.length > 1
      : explorerPreference === "open";
  const hasFileTabs = filePaths.length > 1;

  // Width is a separate, UI-only preference: it survives version switches and
  // restarts, and never becomes part of the project it is displaying.
  const [storedExplorerWidth, setStoredExplorerWidth] =
    usePersistedState<number>(
      FILE_EXPLORER_WIDTH.default,
      FILE_EXPLORER_WIDTH_STORAGE_KEY
    );
  const workspaceRowRef = useRef<HTMLDivElement>(null);
  // Measured rather than derived from the viewport: how much room the tree can
  // take depends on how wide the chat column next to it currently is.
  const workspaceRowWidth = useElementWidth(workspaceRowRef);
  const isDesktopLayout = useMediaQuery(XL_MEDIA_QUERY);
  const explorerBounds = useMemo(
    () => getFileExplorerBounds(workspaceRowWidth),
    [workspaceRowWidth]
  );
  const explorerWidth = clampFileExplorerWidth(
    resolvePaneWidth(storedExplorerWidth, FILE_EXPLORER_WIDTH.default),
    workspaceRowWidth
  );
  // Below xl the tree is a horizontal strip above the editor, so there is no
  // vertical edge to drag.
  const isExplorerResizable = isDesktopLayout && isExplorerOpen;

  useEffect(() => {
    tabRefs.current[activeFile?.path ?? ""]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeFile?.path]);

  const copyCurrentFile = useCallback(() => {
    if (!activeFile) return;
    copy(activeFile.content);
    toast.success(`Copied file: ${activeFile.path}`);
  }, [activeFile]);

  const downloadCurrentFile = useCallback(() => {
    if (!activeFile) return;
    const filename = downloadProjectFile(activeFile);
    toast.success(`Downloaded ${activeFile.path} as ${filename}`);
  }, [activeFile]);

  // Formatting is never automatic: the stored file - and therefore every
  // export - keeps its original bytes until this runs.
  const formatCurrentFile = useCallback(() => {
    if (!activeFile) return;
    const result = formatSource(activeFile.content, activeFile.language);
    if (result.status === "formatted") {
      onFileChange(activeFile.path, result.content);
      toast.success(`Formatted ${activeFile.path}`);
      return;
    }
    toast(result.reason ?? "Nothing to format in this file.");
  }, [activeFile, onFileChange]);

  const codePenShareResult = useMemo(
    () =>
      createCodePenShareResult({
        stack,
        artifact: previewArtifact,
      }),
    [previewArtifact, stack]
  );

  const doOpenInCodepenio = useCallback(() => {
    if (codePenShareResult.kind === "unsupported") {
      toast.error(codePenShareResult.message);
      return;
    }

    if (!window.confirm(codePenShareResult.warnings.join("\n\n"))) return;
    submitCodePenPayload(codePenShareResult.payload);
  }, [codePenShareResult]);

  const focusTab = (path: string) => {
    onSelectFile(path);
    window.requestAnimationFrame(() => tabRefs.current[path]?.focus());
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % filePaths.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + filePaths.length) % filePaths.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = filePaths.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    focusTab(filePaths[nextIndex]);
  };

  const lineCount = useMemo(
    () => (activeFile ? activeFile.content.split("\n").length : 0),
    [activeFile]
  );

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-zinc-400">
        No project files are available.
      </div>
    );
  }

  const editorIsReadOnly = readOnly || Boolean(activeFile.readonly);
  const isFormattable = canFormatLanguage(activeFile.language);
  const canFormat = isFormattable && !editorIsReadOnly;
  const formatTitle = editorIsReadOnly
    ? "This version is read-only, so it cannot be reformatted."
    : isFormattable
      ? `Format ${activeFile.path} (whitespace only, applied to this file)`
      : describeUnsupportedLanguage(activeFile.language);

  const explorerToggleLabel = isExplorerOpen
    ? "Hide project files"
    : `Show project files (${filePaths.length})`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-zinc-950">
      <div
        ref={workspaceRowRef}
        className="flex min-h-0 flex-1 flex-col md:flex-row"
      >
        {isExplorerOpen && (
          <aside
            id="project-file-explorer"
            aria-label="Project files"
            style={
              isDesktopLayout ? { width: `${explorerWidth}px` } : undefined
            }
            className="flex h-40 min-h-0 shrink-0 flex-col overflow-hidden border-b border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900 md:h-full md:w-56 md:border-b-0 md:border-r"
          >
            <div className="flex min-h-11 items-center justify-between gap-2 px-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-gray-800 dark:text-zinc-100">
                  Files
                </span>
                <span className="shrink-0 rounded-md bg-gray-200 px-1.5 py-0.5 text-xs tabular-nums text-gray-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {filePaths.length}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setExplorerPreference("closed")}
                title="Hide project files"
                aria-label="Hide project files"
                aria-controls="project-file-explorer"
                aria-expanded
                className="-mr-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 transition-colors duration-200 hover:bg-gray-200/70 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <LuPanelLeftClose className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ProjectFileExplorer
              files={files}
              activeFilePath={activeFile.path}
              onSelectFile={onSelectFile}
            />
          </aside>
        )}

        {isExplorerResizable && (
          <PaneResizer
            label="Project files width"
            controls="project-file-explorer"
            testId="file-explorer-resizer"
            width={explorerWidth}
            min={explorerBounds.min}
            max={explorerBounds.max}
            defaultWidth={FILE_EXPLORER_WIDTH.default}
            onWidthChange={setStoredExplorerWidth}
            className="hidden shrink-0 self-stretch xl:flex"
          />
        )}

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {hasFileTabs && (
            <div
              role="tablist"
              aria-label="Project file tabs"
              aria-orientation="horizontal"
              className="flex min-h-11 shrink-0 overflow-x-auto border-b border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900"
            >
              {filePaths.map((path, index) => {
                const file = files[path];
                const isActive = path === activeFile.path;
                return (
                  <button
                    key={path}
                    ref={(element) => {
                      tabRefs.current[path] = element;
                    }}
                    id={`project-file-tab-${index}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="project-editor-panel"
                    aria-label={`${path}${file.readonly ? ", read only" : ""}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => onSelectFile(path)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    title={path}
                    className={`relative flex min-h-11 max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-gray-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset dark:border-zinc-800 ${
                      isActive
                        ? "bg-white font-medium text-gray-950 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-violet-500 dark:bg-zinc-950 dark:text-white"
                        : "text-gray-600 hover:bg-white hover:text-gray-950 dark:text-zinc-400 dark:hover:bg-zinc-950 dark:hover:text-zinc-100"
                    }`}
                  >
                    <span className="truncate">{fileName(path)}</span>
                    {file.readonly && (
                      <LuLock
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex min-h-11 shrink-0 items-center gap-1 border-b border-gray-200 px-1.5 dark:border-zinc-800 sm:px-2">
            <button
              type="button"
              onClick={() =>
                setExplorerPreference(isExplorerOpen ? "closed" : "open")
              }
              title={explorerToggleLabel}
              aria-label={explorerToggleLabel}
              aria-controls="project-file-explorer"
              aria-expanded={isExplorerOpen}
              data-testid="toggle-file-explorer"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              {isExplorerOpen ? (
                <LuPanelLeftClose className="h-4 w-4" aria-hidden="true" />
              ) : (
                <LuPanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <h2 className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className="min-w-0 truncate text-sm"
                title={activeFile.path}
                data-testid="active-file-path"
              >
                <span className="text-gray-400 dark:text-zinc-500">
                  {directoryName(activeFile.path)}
                </span>
                <span className="font-semibold text-gray-900 dark:text-zinc-100">
                  {fileName(activeFile.path)}
                </span>
              </span>
              {activeFile.path === entryPoint && (
                <span
                  className={`${BADGE} bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300`}
                  title="The file the project starts from"
                >
                  Entry
                </span>
              )}
              {activeFile.path === previewSourcePath && (
                <span
                  className={`${BADGE} bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200`}
                  title="The file the live preview is rendered from"
                >
                  Preview
                </span>
              )}
              {editorIsReadOnly && (
                <span
                  className={`${BADGE} inline-flex items-center gap-1 bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200`}
                  title="Saved versions cannot be edited"
                >
                  <LuLock className="h-3 w-3" aria-hidden="true" />
                  Read-only
                </span>
              )}
              {activeFile.generated && !editorIsReadOnly && (
                <span
                  className={`${BADGE} hidden items-center gap-1 bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400 lg:inline-flex`}
                  title="Written by the model in this version"
                >
                  <LuWand2 className="h-3 w-3" aria-hidden="true" />
                  Generated
                </span>
              )}
            </h2>

            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={formatCurrentFile}
                disabled={!canFormat}
                className={TOOLBAR_BUTTON}
                title={formatTitle}
                aria-label={formatTitle}
                data-testid="format-code"
              >
                <LuAlignLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden 2xl:inline">Format</span>
              </button>
              <button
                type="button"
                onClick={copyCurrentFile}
                className={TOOLBAR_BUTTON}
                title={`Copy file: ${activeFile.path}`}
                aria-label={`Copy file: ${activeFile.path}`}
                data-testid="copy-code"
              >
                <LuCopy className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden 2xl:inline">Copy</span>
              </button>
              <button
                type="button"
                onClick={downloadCurrentFile}
                className={TOOLBAR_BUTTON}
                title={`Download file: ${activeFile.path}`}
                aria-label={`Download file: ${activeFile.path}`}
              >
                <LuDownload className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden 2xl:inline">Download</span>
              </button>
              <button
                type="button"
                onClick={doOpenInCodepenio}
                disabled={codePenShareResult.kind === "unsupported"}
                className={TOOLBAR_BUTTON}
                title={
                  codePenShareResult.kind === "unsupported"
                    ? codePenShareResult.message
                    : "Send this browser-ready preview to CodePen"
                }
                aria-label={
                  codePenShareResult.kind === "unsupported"
                    ? `CodePen unavailable: ${codePenShareResult.message}`
                    : "Send this browser-ready preview to CodePen"
                }
                aria-describedby={
                  codePenShareResult.kind === "unsupported"
                    ? "codepen-unavailable-reason"
                    : undefined
                }
                data-testid="open-codepen"
              >
                <FaCodepen className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden 2xl:inline">CodePen</span>
              </button>
            </div>
          </div>

          <div
            id="project-editor-panel"
            role="tabpanel"
            aria-labelledby={
              hasFileTabs ? `project-file-tab-${activeTabIndex}` : undefined
            }
            aria-label={hasFileTabs ? undefined : `Editor for ${activeFile.path}`}
            tabIndex={0}
            className="min-h-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset"
          >
            <CodeMirror
              code={activeFile.content}
              editorTheme={settings.editorTheme}
              language={activeFile.language}
              filePath={activeFile.path}
              readOnly={editorIsReadOnly}
              onCodeChange={(content) => onFileChange(activeFile.path, content)}
            />
          </div>

          <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-gray-200 bg-gray-50 px-3 py-1 text-[11px] text-gray-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <span className="shrink-0 tabular-nums">
              {LANGUAGE_LABELS[activeFile.language]}
              <span aria-hidden="true"> · </span>
              {lineCount} {lineCount === 1 ? "line" : "lines"}
            </span>
            {codePenShareResult.kind === "unsupported" && (
              <span
                id="codepen-unavailable-reason"
                role="status"
                title={codePenShareResult.message}
                className="min-w-0 flex-1 truncate text-amber-700 dark:text-amber-300"
              >
                {codePenShareResult.message}
              </span>
            )}
            <span
              id="project-editor-keyboard-help"
              className="sr-only ml-auto shrink-0 lg:not-sr-only"
            >
              Tab moves focus outside the editor; Ctrl+] indents.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

export default CodeTab;
