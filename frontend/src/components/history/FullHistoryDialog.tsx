import { useEffect, useMemo, useState } from "react";
import {
  LuClock3,
  LuFolderOpen,
  LuHistory,
  LuSearch,
} from "react-icons/lu";
import { getHistoryProject } from "../../lib/history-client";
import type {
  HistoryCommit,
  HistoryJsonValue,
  HistoryProject,
  HistoryProjectSummary,
  HistoryVariant,
} from "../../lib/history-types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  chooseHistoryProjectId,
  loadAllHistoryProjectSummaries,
} from "./full-history-loader";

interface FullHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenProject: (projectId: string) => Promise<boolean>;
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function readableJson(value: HistoryJsonValue): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const text = value.text ?? value.full_text;
    if (typeof text === "string") return text;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function versionLabel(commit: HistoryCommit): string {
  if (commit.versionType === "retry") return "Retry";
  if (commit.versionType === "code_create") return "Imported";
  if (commit.versionType.endsWith("_edit")) return "Edit";
  return "Create";
}

function optionLabel(variant: HistoryVariant): string {
  return `Option ${variant.index + 1}`;
}

function VersionDetails({
  commit,
  version,
  versionById,
}: {
  commit: HistoryCommit;
  version: number;
  versionById: Map<string, number>;
}) {
  return (
    <details className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <summary className="cursor-pointer list-none px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">
            {version}
          </span>
          <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {versionLabel(commit)}
          </span>
          <span className="text-xs text-gray-500 dark:text-zinc-400">
            {formatTimestamp(commit.createdAt)}
          </span>
          {commit.retryOfCommitId && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
              Retried from v
              {versionById.get(commit.retryOfCommitId) ?? "?"}
            </span>
          )}
          {commit.parentCommitId && !commit.retryOfCommitId && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-zinc-800 dark:text-zinc-300">
              Branch from v
              {versionById.get(commit.parentCommitId) ?? "?"}
            </span>
          )}
        </div>
      </summary>

      <div className="space-y-4 border-t border-gray-100 px-3 py-3 dark:border-zinc-800">
        {commit.prompts.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
              Prompts
            </h4>
            <div className="mt-2 space-y-2">
              {commit.prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="rounded-md bg-gray-50 p-2 text-xs leading-5 text-gray-700 dark:bg-zinc-800/70 dark:text-zinc-200"
                >
                  <span className="font-semibold capitalize">{prompt.role}</span>
                  <span className="text-gray-400"> · {prompt.kind}</span>
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {readableJson(prompt.content)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
            Options and conversations
          </h4>
          <div className="mt-2 space-y-2">
            {commit.variants.map((variant) => (
              <details
                key={variant.index}
                className="rounded-md border border-gray-200 bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800/60"
              >
                <summary className="cursor-pointer list-none px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500">
                  <span className="font-semibold">{optionLabel(variant)}</span>
                  <span className="notranslate ml-2 text-gray-600 dark:text-zinc-300" translate="no">
                    {variant.model ?? "Model not recorded"}
                  </span>
                  <span className="ml-2 capitalize text-gray-500 dark:text-zinc-400">
                    {variant.status}
                  </span>
                  {variant.durationMs !== null && (
                    <span className="ml-2 text-gray-500 dark:text-zinc-400">
                      {(variant.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </summary>
                <div className="space-y-2 border-t border-gray-200 px-3 py-2 dark:border-zinc-700">
                  {variant.error && (
                    <p className="text-xs text-red-700 dark:text-red-300">
                      {variant.error}
                    </p>
                  )}
                  {variant.projectData && (
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                      {Object.keys(variant.projectData.files).length} files ·
                      entry {variant.projectData.entryPoint}
                    </p>
                  )}
                  {variant.messages.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                      No saved conversation messages for this option.
                    </p>
                  ) : (
                    variant.messages.map((message) => (
                      <div
                        key={message.id}
                        className="rounded bg-white p-2 text-xs leading-5 dark:bg-zinc-900"
                      >
                        <span className="font-semibold capitalize">
                          {message.role}
                        </span>
                        <span className="ml-2 text-gray-400">
                          {formatTimestamp(message.createdAt)}
                        </span>
                        {message.content && (
                          <p className="mt-1 whitespace-pre-wrap break-words text-gray-700 dark:text-zinc-200">
                            {message.content}
                          </p>
                        )}
                        {message.media.length > 0 && (
                          <p className="mt-1 text-gray-500 dark:text-zinc-400">
                            {message.media.length} attachment
                            {message.media.length === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}

export function FullHistoryProjectDetails({
  project,
  onOpenProject,
}: {
  project: HistoryProject;
  onOpenProject: (projectId: string) => Promise<boolean>;
}) {
  const ordered = [...project.commits].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
  );
  const versionById = new Map(
    ordered.map((commit, index) => [commit.id, index + 1])
  );

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-3 dark:border-zinc-700">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold text-gray-950 dark:text-zinc-50">
            {project.title}
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
            {project.stack?.replace(/_/g, " ") ?? "Stack not recorded"} ·{" "}
            {project.commitCount} versions · {project.variantCount} options
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
            Created {formatTimestamp(project.createdAt)} · updated{" "}
            {formatTimestamp(project.updatedAt)}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void onOpenProject(project.id)}
        >
          <LuFolderOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Open project
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {[...ordered].reverse().map((commit) => (
          <VersionDetails
            key={commit.id}
            commit={commit}
            version={versionById.get(commit.id) ?? 0}
            versionById={versionById}
          />
        ))}
      </div>
    </div>
  );
}

export default function FullHistoryDialog({
  open,
  onOpenChange,
  onOpenProject,
}: FullHistoryDialogProps) {
  const [projects, setProjects] = useState<HistoryProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<HistoryProject | null>(
    null
  );
  const [query, setQuery] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setIsLoadingProjects(true);
    setError(null);
    void loadAllHistoryProjectSummaries(controller.signal)
      .then((result) => {
        setProjects(result);
        setSelectedId((current) => chooseHistoryProjectId(current, result));
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load saved project history."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingProjects(false);
      });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open || !selectedId) {
      setSelectedProject(null);
      return;
    }
    const controller = new AbortController();
    setIsLoadingProject(true);
    setError(null);
    void getHistoryProject(selectedId, { signal: controller.signal })
      .then(setSelectedProject)
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load that project's complete history."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingProject(false);
      });
    return () => controller.abort();
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) =>
      [project.title, project.stack ?? "", project.inputMode ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [projects, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-gray-200 px-5 py-4 dark:border-zinc-700">
          <DialogTitle className="flex items-center gap-2">
            <LuHistory className="h-5 w-5" aria-hidden="true" />
            Full history
          </DialogTitle>
          <DialogDescription>
            Browse every locally stored project, version, prompt, model option,
            response, attachment count and retry/branch relationship.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)] md:grid-rows-1">
          <aside className="min-h-0 border-b border-gray-200 p-3 dark:border-zinc-700 md:border-b-0 md:border-r">
            <label className="relative block">
              <LuSearch
                className="absolute left-3 top-3.5 h-4 w-4 text-gray-400"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                className="pl-9"
                aria-label="Search full project history"
              />
            </label>
            <div className="mt-3 max-h-48 space-y-1 overflow-y-auto md:max-h-[calc(100%-3.5rem)]">
              {isLoadingProjects ? (
                <p className="p-2 text-sm text-gray-500">Loading projects…</p>
              ) : filtered.length === 0 ? (
                <p className="p-2 text-sm text-gray-500">
                  No saved project matches this search.
                </p>
              ) : (
                filtered.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedId(project.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                      selectedId === project.id
                        ? "bg-violet-100 text-violet-950 dark:bg-violet-900/40 dark:text-violet-50"
                        : "hover:bg-gray-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {project.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400">
                      <LuClock3 className="h-3 w-3" aria-hidden="true" />
                      {formatTimestamp(project.updatedAt)} ·{" "}
                      {project.commitCount} versions
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4">
            {error && (
              <p
                role="alert"
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
              >
                {error}
              </p>
            )}
            {isLoadingProject ? (
              <p className="text-sm text-gray-500">Loading complete history…</p>
            ) : selectedProject ? (
              <FullHistoryProjectDetails
                project={selectedProject}
                onOpenProject={async (projectId) => {
                  const opened = await onOpenProject(projectId);
                  if (opened) onOpenChange(false);
                  return opened;
                }}
              />
            ) : (
              !error && (
                <p className="text-sm text-gray-500">
                  Select a project to inspect its complete history.
                </p>
              )
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
