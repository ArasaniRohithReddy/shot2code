import { useEffect, useRef, useState } from "react";
import {
  LuExternalLink,
  LuFolderOpen,
  LuGithub,
  LuLoader,
  LuPuzzle,
  LuTrash2,
} from "react-icons/lu";
import {
  deleteInstalledSkill,
  importGitHubSkill,
  importLocalSkill,
  listInstalledSkills,
  setInstalledSkillEnabled,
  type InstalledSkill,
  type SkillImportFile,
} from "../../lib/skills-client";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

const MAX_FILES = 64;
const MAX_FILE_BYTES = 256_000;

export default function SkillLibrary({
  initialSkills,
}: {
  initialSkills?: InstalledSkill[];
}) {
  const [skills, setSkills] = useState<InstalledSkill[]>(initialSkills ?? []);
  const [loading, setLoading] = useState(initialSkills === undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (initialSkills !== undefined) return;
    const controller = new AbortController();
    void listInstalledSkills(controller.signal)
      .then(setSkills)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error ? caught.message : "Could not load skills."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [initialSkills]);

  const upsert = (skill: InstalledSkill) =>
    setSkills((current) =>
      [...current.filter((item) => item.name !== skill.name), skill].sort(
        (left, right) => left.name.localeCompare(right.name)
      )
    );

  const importFolder = async (fileList: FileList | null) => {
    const selected = Array.from(fileList ?? []);
    if (selected.length === 0) return;
    if (selected.length > MAX_FILES) {
      setError(`A skill may contain at most ${MAX_FILES} text files.`);
      return;
    }
    setBusy("local");
    setError(null);
    try {
      const files: SkillImportFile[] = [];
      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(
            `${file.name} exceeds the ${MAX_FILE_BYTES}-byte skill file limit.`
          );
        }
        files.push({
          path:
            (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name,
          content: await file.text(),
        });
      }
      upsert(await importLocalSkill(files));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not import the skill."
      );
    } finally {
      setBusy(null);
    }
  };

  const importFromGitHub = async () => {
    const url = githubUrl.trim();
    if (!url) return;
    setBusy("github");
    setError(null);
    try {
      upsert(await importGitHubSkill(url));
      setGithubUrl("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not import the GitHub skill."
      );
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (skill: InstalledSkill, enabled: boolean) => {
    setBusy(skill.name);
    setError(null);
    try {
      upsert(await setInstalledSkillEnabled(skill.name, enabled));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update the skill."
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      await deleteInstalledSkill(name);
      setSkills((current) => current.filter((skill) => skill.name !== name));
      setPendingDelete(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not remove the skill."
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">
          Agent Skills
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
          {skills.length} installed on this device
        </p>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-xs leading-5 text-gray-500 dark:text-zinc-400">
          Skills add reviewed instructions and resources to GitHub Copilot and
          Copilot SDK BYOK runs. They are disabled after import. Scripts may be
          stored as resources, but shot2code never enables shell tools to run
          them.
        </p>

        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void importFolder(event.target.files);
            event.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            disabled={busy !== null}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {busy === "local" ? (
              <LuLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <LuFolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Import skill folder
          </button>
          <a
            href="https://github.com/github/awesome-copilot/tree/main/skills"
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-950/30"
          >
            Browse community skills
            <LuExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void importFromGitHub();
          }}
        >
          <label
            htmlFor="github-skill-url"
            className="text-xs font-medium text-gray-700 dark:text-zinc-300"
          >
            Import a public GitHub skill folder
          </label>
          <div className="flex gap-2">
            <Input
              id="github-skill-url"
              type="url"
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
            />
            <button
              type="submit"
              disabled={!githubUrl.trim() || busy !== null}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {busy === "github" ? (
                <LuLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <LuGithub className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Import
            </button>
          </div>
        </form>

        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
            <LuLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Loading skills…
          </p>
        ) : skills.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500 dark:border-zinc-700 dark:text-zinc-400">
            No skill installed. Import a folder containing SKILL.md.
          </p>
        ) : (
          <ul className="space-y-2">
            {skills.map((skill) => (
              <li
                key={skill.name}
                className="rounded-lg border border-gray-200 p-3 dark:border-zinc-700"
              >
                <div className="flex items-start gap-3">
                  <LuPuzzle className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />
                  <div className="min-w-0 flex-1">
                    <p className="notranslate text-sm font-semibold text-gray-900 dark:text-zinc-100" translate="no">
                      {skill.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-400">
                      {skill.description}
                    </p>
                    <p className="mt-1 break-all text-[11px] text-gray-500 dark:text-zinc-500">
                      {skill.fileCount} files
                      {skill.license ? ` · ${skill.license}` : ""}
                      {skill.hasScripts ? " · contains scripts (not executable)" : ""}
                      {skill.source !== "local" ? ` · ${skill.source}` : ""}
                    </p>
                  </div>
                  <Switch
                    checked={skill.enabled}
                    disabled={busy === skill.name}
                    onCheckedChange={(enabled) => void toggle(skill, enabled)}
                    aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => setPendingDelete(skill.name)}
                    aria-label={`Remove ${skill.name}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                  >
                    <LuTrash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {pendingDelete === skill.name && (
                  <div
                    role="alertdialog"
                    aria-label={`Remove ${skill.name}?`}
                    className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"
                  >
                    <span>Remove this skill and its stored resources?</span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingDelete(null)}
                        className="min-h-11 rounded-lg px-3 font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(skill.name)}
                        className="min-h-11 rounded-lg bg-red-600 px-3 font-medium text-white"
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
