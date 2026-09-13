import { useCallback, useEffect, useMemo, useRef } from "react";
import { FaCodepen } from "react-icons/fa";
import { LuCopy, LuDownload, LuLock, LuWand2 } from "react-icons/lu";
import copy from "copy-to-clipboard";
import toast from "react-hot-toast";
import CodeMirror from "./CodeMirror";
import ProjectFileExplorer from "./ProjectFileExplorer";
import { Button } from "../ui/button";
import { Settings } from "../../types";
import type { Stack } from "../../lib/stacks";
import type {
  ProjectFileMap,
  ProjectPreviewArtifact,
} from "../../lib/project-files";
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

function fileName(path: string) {
  return path.split("/").pop() ?? path;
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

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-zinc-400">
        No project files are available.
      </div>
    );
  }

  const editorIsReadOnly = readOnly || Boolean(activeFile.readonly);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-zinc-950">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex h-44 min-h-0 shrink-0 flex-col overflow-hidden border-b border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900 md:h-full md:w-56 md:border-b-0 md:border-r">
          <div className="flex min-h-11 items-center justify-between px-3">
            <span className="text-sm font-semibold text-gray-800 dark:text-zinc-100">
              Files
            </span>
            <span className="rounded-md bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-zinc-800 dark:text-zinc-300">
              {filePaths.length}
            </span>
          </div>
          <ProjectFileExplorer
            files={files}
            activeFilePath={activeFile.path}
            onSelectFile={onSelectFile}
          />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                  className={`flex min-h-11 max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-gray-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset dark:border-zinc-800 ${
                    isActive
                      ? "bg-white font-medium text-gray-950 dark:bg-zinc-950 dark:text-white"
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

          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-2 py-1 dark:border-zinc-800 sm:px-3">
            <div className="min-w-0 flex-1 basis-44">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-900 dark:text-zinc-100">
                  {activeFile.path}
                </span>
                {activeFile.path === entryPoint && (
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-zinc-800 dark:text-zinc-300">
                    Project entry
                  </span>
                )}
                {activeFile.path === previewSourcePath && (
                  <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                    Preview source
                  </span>
                )}
                {activeFile.generated && (
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-zinc-400 sm:inline-flex">
                    <LuWand2 className="h-3.5 w-3.5" />
                    Generated
                  </span>
                )}
              </div>
              {editorIsReadOnly && (
                <span className="text-xs text-gray-500 dark:text-zinc-400">
                  Read-only version
                </span>
              )}
              <span
                id="project-editor-keyboard-help"
                className="hidden text-xs text-gray-500 dark:text-zinc-400 sm:block"
              >
                Tab moves focus outside the editor; Ctrl+] indents.
              </span>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                onClick={copyCurrentFile}
                className="h-11 w-11 gap-2 p-0 sm:w-auto sm:px-3"
                title={`Copy file: ${activeFile.path}`}
                aria-label={`Copy file: ${activeFile.path}`}
                data-testid="copy-code"
              >
                <LuCopy className="h-4 w-4" />
                <span className="hidden sm:inline">Copy file</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={downloadCurrentFile}
                className="h-11 w-11 gap-2 p-0 lg:w-auto lg:px-3"
                title={`Download file: ${activeFile.path}`}
                aria-label={`Download file: ${activeFile.path}`}
              >
                <LuDownload className="h-4 w-4" />
                <span className="hidden lg:inline">Download file</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={doOpenInCodepenio}
                disabled={codePenShareResult.kind === "unsupported"}
                className="h-11 w-11 gap-2 p-0 lg:w-auto lg:px-3"
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
                <FaCodepen className="h-4 w-4" />
                <span className="hidden lg:inline">
                  {codePenShareResult.kind === "unsupported"
                    ? "CodePen unavailable"
                    : "Share to CodePen"}
                </span>
              </Button>
            </div>
          </div>

          {codePenShareResult.kind === "unsupported" && (
            <div
              id="codepen-unavailable-reason"
              role="status"
              className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
            >
              {codePenShareResult.message}
            </div>
          )}

          <div
            id="project-editor-panel"
            role="tabpanel"
            aria-labelledby={`project-file-tab-${activeTabIndex}`}
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
        </section>
      </div>
    </div>
  );
}

export default CodeTab;