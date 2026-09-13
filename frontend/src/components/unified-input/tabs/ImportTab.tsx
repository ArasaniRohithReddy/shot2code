import { useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import toast from "react-hot-toast";
import {
  LuCheckCircle2,
  LuCode2,
  LuFileArchive,
  LuFiles,
  LuFolderOpen,
  LuLoader2,
  LuTrash2,
} from "react-icons/lu";
import { Button } from "../../ui/button";
import { Progress } from "../../ui/progress";
import { Textarea } from "../../ui/textarea";
import StackLabel from "../../core/StackLabel";
import OutputSettingsSection from "../../settings/OutputSettingsSection";
import { Stack, STACK_DESCRIPTIONS } from "../../../lib/stacks";
import type { ProjectContext } from "../../../types";
import {
  inspectProjectFiles,
  inspectProjectZip,
  type ProjectImportProgress,
} from "../../../lib/project-context";
import {
  MAX_PROJECT_FILE_BYTES,
  PROJECT_SOURCE_ACCEPT,
  detectStackFromSource,
  getLegacyEditableFile,
  type EditableProjectImportHandler,
  type ProjectImportAnalysis,
  type ProjectImportSourceKind,
} from "../../../lib/project-import";

export interface ImportTabProps {
  importFromCode: (code: string, stack: Stack) => void;
  importProject?: EditableProjectImportHandler;
  projectContext: ProjectContext | null;
  setProjectContext: (context: ProjectContext | null) => void;
}

type ImportMode = "page" | "project";

function stackName(stack: Stack) {
  return STACK_DESCRIPTIONS[stack].components.join(" + ");
}

function ImportTab({
  importFromCode,
  importProject,
  projectContext,
  setProjectContext,
}: ImportTabProps) {
  const [mode, setMode] = useState<ImportMode>("page");
  const [code, setCode] = useState("");
  const [stack, setStack] = useState<Stack | undefined>();
  const [projectStack, setProjectStack] = useState<Stack | undefined>();
  const [analysis, setAnalysis] = useState<ProjectImportAnalysis | null>(null);
  const [isScanningProject, setIsScanningProject] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProjectImportProgress | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const lastAutomaticStack = useRef<Stack | null>(null);

  const sourceDetection = useMemo(
    () => detectStackFromSource(code, "index.html"),
    [code]
  );

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (mode === "page") textareaRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (!code.trim()) {
      if (stack === lastAutomaticStack.current) setStack(undefined);
      lastAutomaticStack.current = null;
      return;
    }
    if (
      sourceDetection.stack &&
      (stack === undefined || stack === lastAutomaticStack.current)
    ) {
      setStack(sourceDetection.stack);
      lastAutomaticStack.current = sourceDetection.stack;
    }
  }, [code, sourceDetection.stack, stack]);

  const clearPage = () => {
    setCode("");
    if (stack === lastAutomaticStack.current) setStack(undefined);
    lastAutomaticStack.current = null;
    textareaRef.current?.focus();
  };

  const doImport = () => {
    if (!code.trim()) {
      toast.error("Paste HTML or source code before importing.");
      return;
    }
    const selectedStack = stack ?? sourceDetection.stack;
    if (!selectedStack) {
      toast.error("Select the stack this code should use.");
      return;
    }
    importFromCode(code, selectedStack);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      doImport();
    }
  };

  const readDroppedHtml = async (file: File) => {
    if (file.size > MAX_PROJECT_FILE_BYTES) {
      throw new Error(
        `HTML file is too large. Choose a file under ${MAX_PROJECT_FILE_BYTES.toLocaleString()} bytes.`
      );
    }
    let contents: string;
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer()
      );
    } catch {
      throw new Error("The dropped HTML file is not valid UTF-8 text.");
    }
    if (contents.includes("\0")) {
      throw new Error("The dropped HTML file appears to contain binary data.");
    }
    setCode(contents);
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "text/html": [".html", ".htm"] },
    maxFiles: 1,
    maxSize: MAX_PROJECT_FILE_BYTES,
    noClick: true,
    noKeyboard: true,
    onDrop: (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (!file) return;
      void readDroppedHtml(file).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Could not read the HTML file.";
        toast.error(message);
      });
    },
    onDropRejected: (rejections) => {
      const message = rejections.some((rejection) =>
        rejection.errors.some((error) => error.code === "file-too-large")
      )
        ? `HTML file is too large. Choose a file under ${MAX_PROJECT_FILE_BYTES.toLocaleString()} bytes.`
        : "Drop one .html or .htm file.";
      toast.error(message);
    },
  });

  const resetProjectAnalysis = () => {
    setAnalysis(null);
    setProjectStack(undefined);
    setScanError(null);
    setProgress(null);
  };

  const setAnalysisResult = (result: ProjectImportAnalysis) => {
    setAnalysis(result);
    setProjectStack(result.project.detected_stack ?? undefined);
    toast.success(
      `Analysed ${result.context.analyzed_file_count} source files from ${result.context.name}`
    );
  };

  const analyseFiles = async (
    files: File[],
    sourceKind: Exclude<ProjectImportSourceKind, "zip">
  ) => {
    setIsScanningProject(true);
    setScanError(null);
    setAnalysis(null);
    setProjectStack(undefined);
    try {
      setAnalysisResult(
        await inspectProjectFiles(files, sourceKind, setProgress)
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not analyse the project.";
      setScanError(message);
      setProgress(null);
      toast.error(message);
    } finally {
      setIsScanningProject(false);
    }
  };

  const analyseZip = async (file: File) => {
    setIsScanningProject(true);
    setScanError(null);
    setAnalysis(null);
    setProjectStack(undefined);
    try {
      setAnalysisResult(await inspectProjectZip(file, setProgress));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not analyse the ZIP.";
      setScanError(message);
      setProgress(null);
      toast.error(message);
    } finally {
      setIsScanningProject(false);
    }
  };

  const useAsContext = () => {
    if (!analysis) return;
    setProjectContext(analysis.context);
    toast.success(`${analysis.context.name} is now used as design context.`);
  };

  const legacyEditableFile = analysis
    ? getLegacyEditableFile(analysis.project)
    : null;
  const canOpenEditableProject = Boolean(
    analysis && (importProject || legacyEditableFile)
  );

  const openEditableProject = () => {
    if (!analysis) return;
    if (!projectStack) {
      toast.error("Select a stack before opening the project.");
      return;
    }
    if (importProject) {
      importProject({ project: analysis.project, stack: projectStack });
      return;
    }
    if (!legacyEditableFile) {
      toast.error(
        "This project needs the multi-file editor. You can still use it as design context."
      );
      return;
    }
    importFromCode(legacyEditableFile.content, projectStack);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-gray-600 ring-1 ring-gray-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700">
            <LuCode2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-zinc-100">
              Import existing code
            </h3>
            <p className="mt-1 text-sm leading-5 text-gray-600 dark:text-zinc-400">
              Open a page directly, or inspect a project before choosing how to use it.
            </p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Import type"
          className="mt-5 grid grid-cols-2 rounded-lg bg-gray-100 p-1 dark:bg-zinc-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "page"}
            onClick={() => setMode("page")}
            className={`min-h-11 rounded-md px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              mode === "page"
                ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Paste or drop HTML
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "project"}
            onClick={() => setMode("project")}
            className={`min-h-11 rounded-md px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              mode === "project"
                ? "bg-white text-gray-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Folder, ZIP or source files
          </button>
        </div>

        {mode === "page" ? (
          <section className="mt-5 space-y-4" aria-label="Import a page">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-gray-800 dark:text-zinc-100">
                  Page source
                </h4>
                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  Existing HTML import remains a single editable history entry.
                </p>
              </div>
              {code && (
                <button
                  type="button"
                  onClick={clearPage}
                  className="min-h-11 rounded-md px-3 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  Clear
                </button>
              )}
            </div>

            <div
              {...getRootProps({
                className: `rounded-lg transition-shadow duration-200 ${
                  isDragActive
                    ? "ring-2 ring-violet-400 ring-offset-2 dark:ring-violet-600 dark:ring-offset-zinc-900"
                    : ""
                }`,
              })}
            >
              <input {...getInputProps()} />
              <Textarea
                ref={textareaRef}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={handleKeyDown}
                className="h-52 w-full resize-none font-mono text-sm"
                placeholder="Paste HTML here, or drag and drop one .html file..."
                data-testid="import-input"
              />
            </div>

            {sourceDetection.stack && code.trim() && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/30 dark:text-violet-200">
                <span className="font-medium">Detected</span>
                <span className="rounded bg-white px-2 py-0.5 dark:bg-zinc-900">
                  {stackName(sourceDetection.stack)}
                </span>
                <span className="text-violet-600 dark:text-violet-300">
                  {sourceDetection.reasons[0]}
                </span>
              </div>
            )}

            <OutputSettingsSection
              stack={stack}
              setStack={(selectedStack) => {
                lastAutomaticStack.current = null;
                setStack(selectedStack);
              }}
              label="Stack:"
              shouldDisableUpdates={false}
            />

            <Button
              onClick={doImport}
              className="min-h-11 w-full"
              size="lg"
              data-testid="import-submit"
            >
              Import code
            </Button>
            <p className="text-center text-xs text-gray-400 dark:text-zinc-500">
              Press Cmd/Ctrl + Enter to import
            </p>
          </section>
        ) : (
          <section className="mt-5 space-y-4" aria-label="Import a project">
            <div>
              <h4 className="text-sm font-semibold text-gray-800 dark:text-zinc-100">
                Inspect project source safely
              </h4>
              <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-400">
                Files are size-limited, normalized and analysed as text. Configuration and application code are never executed.
              </p>
            </div>

            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length) void analyseFiles(files, "folder");
              }}
            />
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void analyseZip(file);
              }}
            />
            <input
              ref={filesInputRef}
              type="file"
              multiple
              accept={PROJECT_SOURCE_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length) void analyseFiles(files, "files");
              }}
            />

            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={isScanningProject}
                onClick={() => folderInputRef.current?.click()}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
              >
                <LuFolderOpen className="h-4 w-4" />
                Folder
              </button>
              <button
                type="button"
                disabled={isScanningProject}
                onClick={() => zipInputRef.current?.click()}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
              >
                <LuFileArchive className="h-4 w-4" />
                ZIP archive
              </button>
              <button
                type="button"
                disabled={isScanningProject}
                onClick={() => filesInputRef.current?.click()}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
              >
                <LuFiles className="h-4 w-4" />
                Source files
              </button>
            </div>

            {progress && isScanningProject && (
              <div role="status" className="space-y-2 rounded-md bg-gray-100 px-3 py-3 dark:bg-zinc-800">
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-300">
                  <LuLoader2 className="h-4 w-4 animate-spin" />
                  {progress.message}
                </div>
                <Progress value={progress.percent} aria-label="Project import progress" />
              </div>
            )}

            {scanError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                {scanError}
              </p>
            )}

            {analysis && !isScanningProject && (
              <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <LuCheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <p className="truncate text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                        {analysis.project.name}
                      </p>
                    </div>
                    <p className="mt-1 pl-6 text-xs text-emerald-800 dark:text-emerald-300">
                      {analysis.context.analyzed_file_count} of {analysis.context.file_count} files analysed · {analysis.context.component_count} components · {analysis.project.ignored_file_count} ignored
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetProjectAnalysis}
                    aria-label="Clear analysed project"
                    title="Clear analysed project"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-emerald-700 transition-colors duration-200 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                  >
                    <LuTrash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-900 dark:text-emerald-100">
                  <span className="font-medium">Detected stack</span>
                  {analysis.project.detected_stack ? (
                    <span className="rounded-md bg-white px-2 py-1 dark:bg-zinc-900">
                      <StackLabel stack={analysis.project.detected_stack} />
                    </span>
                  ) : (
                    <span>Not identified</span>
                  )}
                  {analysis.project.confidence > 0 && (
                    <span className="text-emerald-700 dark:text-emerald-300">
                      {Math.round(analysis.project.confidence * 100)}% confidence
                    </span>
                  )}
                </div>

                {analysis.project.framework_hints.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.project.framework_hints.map((hint) => (
                      <span key={hint} className="rounded-full bg-white/90 px-2 py-1 text-[11px] text-emerald-800 dark:bg-zinc-900 dark:text-emerald-200">
                        {hint}
                      </span>
                    ))}
                  </div>
                )}

                {analysis.project.reasons[0] && (
                  <p className="text-xs leading-5 text-emerald-800 dark:text-emerald-300">
                    {analysis.project.reasons[0]}
                  </p>
                )}

                {analysis.project.warnings.map((warning) => (
                  <p key={warning} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    {warning}
                  </p>
                ))}

                <OutputSettingsSection
                  stack={projectStack}
                  setStack={setProjectStack}
                  label="Open as:"
                  shouldDisableUpdates={false}
                />

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 bg-white dark:bg-zinc-900"
                    onClick={useAsContext}
                  >
                    Use as design context
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={!canOpenEditableProject || !projectStack}
                    onClick={openEditableProject}
                  >
                    Open editable project
                  </Button>
                </div>

                {!canOpenEditableProject && (
                  <p className="text-xs leading-5 text-emerald-800 dark:text-emerald-300">
                    This selection contains multiple dependent files. It is ready for the multi-file editor callback; this build can still use its safe summary as design context.
                  </p>
                )}
              </div>
            )}

            {projectContext && !analysis && !isScanningProject && (
              <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100">
                <LuFolderOpen className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">Using {projectContext.name}</p>
                  <p className="text-xs text-violet-700 dark:text-violet-300">
                    {projectContext.analyzed_file_count} files · {projectContext.component_count} components
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProjectContext(null);
                    setScanError(null);
                  }}
                  aria-label="Clear imported project context"
                  title="Clear project context"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-violet-500 transition-colors duration-200 hover:bg-violet-100 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-violet-900/50 dark:hover:text-violet-100"
                >
                  <LuTrash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default ImportTab;