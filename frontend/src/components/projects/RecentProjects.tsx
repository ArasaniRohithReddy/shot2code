import { useState } from "react";
import {
  LuClock3,
  LuFolderOpen,
  LuPlus,
  LuTrash2,
} from "react-icons/lu";
import type { RecentHistoryProject } from "../../lib/project-history";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

interface RecentProjectsProps {
  projects: RecentHistoryProject[];
  isLoading: boolean;
  error: string | null;
  busyProjectId: string | null;
  onOpen: (projectId: string) => Promise<boolean>;
  onDelete: (projectId: string) => Promise<boolean>;
  onNew: () => void;
}

function formatUpdatedAt(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatStack(stack: string | null): string {
  return stack ? stack.replace(/_/g, " ") : "Stack not recorded";
}

export default function RecentProjects({
  projects,
  isLoading,
  error,
  busyProjectId,
  onOpen,
  onDelete,
  onNew,
}: RecentProjectsProps) {
  const [projectToDelete, setProjectToDelete] =
    useState<RecentHistoryProject | null>(null);

  const confirmDelete = async () => {
    if (!projectToDelete) return;
    const deleted = await onDelete(projectToDelete.id);
    if (deleted) setProjectToDelete(null);
  };

  return (
    <section
      aria-labelledby="recent-projects-heading"
      className="mx-auto w-full max-w-4xl px-4 pb-8"
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-200 pb-3 dark:border-zinc-800">
        <div>
          <h2
            id="recent-projects-heading"
            className="text-sm font-semibold text-gray-900 dark:text-zinc-100"
          >
            Recent projects
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
            Stored locally on this device.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onNew}>
          <LuPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          New project
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
        >
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-1" aria-label="Loading recent projects">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-14 animate-pulse rounded-lg bg-gray-100 dark:bg-zinc-900"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="flex min-h-20 items-center gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 dark:border-zinc-700 dark:text-zinc-300">
          <LuFolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          Your saved projects will appear here after the first generation or import.
        </div>
      ) : (
        <div className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {projects.map((project) => {
            const isBusy = busyProjectId === project.id;
            return (
              <div key={project.id} className="flex min-w-0 items-stretch">
                <button
                  type="button"
                  onClick={() => void onOpen(project.id)}
                  disabled={busyProjectId !== null}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-zinc-900"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                    <LuFolderOpen className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-zinc-100">
                      {project.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-zinc-400">
                      <span className="capitalize">{formatStack(project.stack)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {project.versionCount} version
                        {project.versionCount === 1 ? "" : "s"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <LuClock3 className="h-3 w-3" aria-hidden="true" />
                        {formatUpdatedAt(project.updatedAt)}
                      </span>
                    </span>
                  </span>
                  {isBusy && (
                    <span className="shrink-0 text-xs font-medium text-violet-700 dark:text-violet-300">
                      Opening...
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setProjectToDelete(project)}
                  disabled={busyProjectId !== null}
                  aria-label={`Delete ${project.title}`}
                  title={`Delete ${project.title}`}
                  className="flex w-11 shrink-0 items-center justify-center border-l border-gray-200 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                >
                  <LuTrash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={projectToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setProjectToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved project?</AlertDialogTitle>
            <AlertDialogDescription>
              {projectToDelete
                ? `"${projectToDelete.title}" and every saved version will be removed from this device. This cannot be undone.`
                : "This saved project and every version will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyProjectId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busyProjectId !== null}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500"
            >
              {busyProjectId === projectToDelete?.id ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
