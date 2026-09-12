import { useState, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import OutputSettingsSection from "../../settings/OutputSettingsSection";
import toast from "react-hot-toast";
import { Stack } from "../../../lib/stacks";
import { ProjectContext } from "../../../types";
import {
  scanProjectFiles,
  scanProjectZip,
} from "../../../lib/project-context";
import {
  LuCheckCircle2,
  LuFileArchive,
  LuFiles,
  LuFolderOpen,
  LuLoader2,
  LuTrash2,
} from "react-icons/lu";

interface Props {
  importFromCode: (code: string, stack: Stack) => void;
  projectContext: ProjectContext | null;
  setProjectContext: (context: ProjectContext | null) => void;
}

function ImportTab({
  importFromCode,
  projectContext,
  setProjectContext,
}: Props) {
  const [code, setCode] = useState("");
  const [stack, setStack] = useState<Stack | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isScanningProject, setIsScanningProject] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const doImport = () => {
    if (code === "") {
      toast.error("Please paste in some code");
      return;
    }

    if (stack === undefined) {
      toast.error("Please select your stack");
      return;
    }

    importFromCode(code, stack);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doImport();
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      "text/html": [".html", ".htm"],
    },
    maxFiles: 1,
    noClick: true,
    noKeyboard: true,
    onDragEnter: () => setIsDraggingFile(true),
    onDragLeave: () => setIsDraggingFile(false),
    onDrop: async (acceptedFiles) => {
      setIsDraggingFile(false);
      const file = acceptedFiles[0];
      if (!file) return;
      const contents = await file.text();
      setCode(contents);
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
  });

  const analyseFiles = async (files: File[]) => {
    setIsScanningProject(true);
    setScanError(null);
    try {
      const context = await scanProjectFiles(files);
      setProjectContext(context);
      toast.success(
        `Analysed ${context.analyzed_file_count} source files from ${context.name}`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not analyse the project";
      setScanError(message);
      toast.error(message);
    } finally {
      setIsScanningProject(false);
    }
  };

  const analyseZip = async (file: File) => {
    setIsScanningProject(true);
    setScanError(null);
    try {
      const context = await scanProjectZip(file);
      setProjectContext(context);
      toast.success(
        `Analysed ${context.analyzed_file_count} source files from ${context.name}`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not analyse the ZIP";
      setScanError(message);
      toast.error(message);
    } finally {
      setIsScanningProject(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-6 p-8 border border-gray-200 dark:border-zinc-700 rounded-xl bg-gray-50/50 dark:bg-zinc-900/50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-400 dark:text-zinc-500"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>

            <div className="text-center">
              <h3 className="text-gray-700 dark:text-zinc-200 font-medium">Import Existing Code</h3>
            </div>
          </div>

          <div className="space-y-4">
            <section
              aria-labelledby="project-context-title"
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4
                    id="project-context-title"
                    className="text-sm font-semibold text-gray-800 dark:text-zinc-100"
                  >
                    Existing project context
                  </h4>
                  <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-400">
                    Add a folder, ZIP or a few source files. shot2code reads
                    component names, props, dependencies and design tokens
                    without executing the project.
                  </p>
                </div>
                {projectContext && (
                  <button
                    type="button"
                    onClick={() => {
                      setProjectContext(null);
                      setScanError(null);
                    }}
                    aria-label="Clear imported project context"
                    title="Clear project context"
                    className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                  >
                    <LuTrash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length) void analyseFiles(files);
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
                accept=".html,.htm,.css,.scss,.less,.js,.jsx,.mjs,.ts,.tsx,.vue,.json,.md,.yaml,.yml"
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length) void analyseFiles(files);
                }}
              />

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={isScanningProject}
                  onClick={() => folderInputRef.current?.click()}
                  className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
                >
                  <LuFolderOpen className="h-4 w-4" />
                  Folder
                </button>
                <button
                  type="button"
                  disabled={isScanningProject}
                  onClick={() => zipInputRef.current?.click()}
                  className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
                >
                  <LuFileArchive className="h-4 w-4" />
                  ZIP
                </button>
                <button
                  type="button"
                  disabled={isScanningProject}
                  onClick={() => filesInputRef.current?.click()}
                  className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
                >
                  <LuFiles className="h-4 w-4" />
                  Source files
                </button>
              </div>

              {isScanningProject && (
                <div
                  role="status"
                  className="mt-3 flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-400"
                >
                  <LuLoader2 className="h-4 w-4 animate-spin" />
                  Analysing source files…
                </div>
              )}

              {scanError && (
                <p
                  role="alert"
                  className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
                >
                  {scanError}
                </p>
              )}

              {projectContext && !isScanningProject && (
                <div className="mt-4 rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/20">
                  <div className="flex items-center gap-2">
                    <LuCheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <p className="truncate text-sm font-medium text-emerald-900 dark:text-emerald-100">
                      {projectContext.name}
                    </p>
                  </div>
                  <p className="mt-1 pl-6 text-xs text-emerald-800 dark:text-emerald-300">
                    {projectContext.analyzed_file_count} source files ·{" "}
                    {projectContext.component_count} components ·{" "}
                    {projectContext.tokens.length} tokens/classes
                  </p>
                  {projectContext.framework_hints.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 pl-6">
                      {projectContext.framework_hints.map((hint) => (
                        <span
                          key={hint}
                          className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                        >
                          {hint}
                        </span>
                      ))}
                    </div>
                  )}
                  {projectContext.components.length > 0 && (
                    <p className="mt-2 truncate pl-6 text-xs text-emerald-800 dark:text-emerald-300">
                      {projectContext.components
                        .slice(0, 5)
                        .map((component) => component.name)
                        .join(" · ")}
                      {projectContext.components.length > 5 ? " · …" : ""}
                    </p>
                  )}
                </div>
              )}
            </section>

            <div className="flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-gray-200 dark:bg-zinc-700" />
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-zinc-500">
                Import a page
              </span>
              <div className="h-px flex-1 bg-gray-200 dark:bg-zinc-700" />
            </div>

            <div
              {...getRootProps({
                className: `rounded-lg ${
                  isDraggingFile ? "ring-2 ring-blue-300 dark:ring-blue-700 ring-offset-2 dark:ring-offset-zinc-900" : ""
                }`,
              })}
            >
              <input {...getInputProps()} />
              <Textarea
                ref={textareaRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full h-48 font-mono text-sm resize-none"
                placeholder="Paste your HTML code here or drag/drop a .html file..."
                data-testid="import-input"
              />
            </div>

            <OutputSettingsSection
              stack={stack}
              setStack={(config: Stack) => setStack(config)}
              label="Stack:"
              shouldDisableUpdates={false}
            />

            <Button
              onClick={doImport}
              className="w-full"
              size="lg"
              data-testid="import-submit"
            >
              Import Code
            </Button>

            <p className="text-xs text-gray-400 dark:text-zinc-500 text-center">
              Press Cmd/Ctrl + Enter to import
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImportTab;
