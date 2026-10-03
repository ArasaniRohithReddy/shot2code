import { useRef, useState } from "react";
import { LuGithub, LuKeyRound, LuLoader2 } from "react-icons/lu";
import toast from "react-hot-toast";
import { HTTP_BACKEND_URL } from "../../../config";
import {
  createGitHubDesignProject,
  type DesignProjectImportHandler,
} from "../../../lib/design-project-import";
import { readDesignSourceAssets } from "../../../lib/design-source-assets";
import {
  parseProjectImportAnalysis,
} from "../../../lib/project-import";
import { Stack } from "../../../lib/stacks";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";

interface Props {
  token: string | null;
  fallbackStack: Stack;
  importDesignProject: DesignProjectImportHandler;
}

export default function GitHubTab({
  token,
  fallbackStack,
  importDesignProject,
}: Props) {
  const [url, setUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const instructionRef = useRef<HTMLTextAreaElement>(null);

  const inspectRepository = async () => {
    const repositoryUrl = url.trim();
    if (!/^https:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+/i.test(repositoryUrl)) {
      toast.error("Paste an https://github.com/owner/repository URL.");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(
        `${HTTP_BACKEND_URL}/api/github-repository/inspect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: repositoryUrl,
            token: token?.trim() || null,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.detail === "string"
            ? payload.detail
            : `GitHub import failed (HTTP ${response.status}).`
        );
      }
      const analysis = parseProjectImportAnalysis(payload);
      const stack = analysis.project.detected_stack ?? fallbackStack;
      const assets = Array.isArray(payload.assets)
        ? payload.assets.filter(
            (asset: unknown): asset is Shot2CodeDesignAssetFile =>
              Boolean(
                asset &&
                  typeof asset === "object" &&
                  typeof (asset as { path?: unknown }).path === "string" &&
                  typeof (asset as { content?: unknown }).content === "string" &&
                  typeof (asset as { mimeType?: unknown }).mimeType === "string" &&
                  typeof (asset as { size?: unknown }).size === "number" &&
                  (asset as { encoding?: unknown }).encoding === "base64"
              )
          )
        : [];
      const sourceAssets = readDesignSourceAssets(payload.sourceAssets);
      importDesignProject(
        createGitHubDesignProject(
          analysis.project,
          assets,
          sourceAssets,
          repositoryUrl
        ),
        stack,
        instruction
      );
      const warnings = Array.isArray(payload.warnings)
        ? payload.warnings.filter(
            (warning: unknown): warning is string =>
              typeof warning === "string" && warning.trim().length > 0
          )
        : [];
      warnings.forEach((warning: string) => toast(warning));
      toast.success(
        `Opened ${analysis.project.name}: ${analysis.project.files.length} safe text files and ${assets.length} image asset${assets.length === 1 ? "" : "s"}, without executing the repository.`
      );
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Could not inspect the GitHub repository."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <section className="rounded-xl border border-gray-200 bg-gray-50/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-950">
            <LuGithub className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-zinc-100">
              Import a GitHub frontend
            </h3>
            <p className="mt-1 text-sm leading-5 text-gray-600 dark:text-zinc-400">
              Inspect source files, framework signals, components and tokens,
              then open the repository as an editable project. No dependency,
              configuration or application code is executed.
            </p>
          </div>
        </div>

        <label
          htmlFor="github-repository-url"
          className="mt-5 block text-sm font-medium text-gray-700 dark:text-zinc-300"
        >
          Repository URL
        </label>
        <Input
          id="github-repository-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/owner/repository"
          className="mt-2"
        />

        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <p className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-zinc-100">
            <LuKeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            Repository permission
          </p>
          <p className="mt-1">
            {token?.trim()
              ? "A dedicated repository token is configured and is sent only to api.github.com for this import."
              : "Public repositories work without a token. Private repositories need a separate fine-grained Contents: read token in Settings."}
          </p>
          <p className="mt-1">
            Copilot sign-in is not reused: its narrow sign-in permission does
            not authorize reading private repository contents.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900 sm:p-6">
        <label
          htmlFor="github-import-instruction"
          className="block text-sm font-medium text-gray-700 dark:text-zinc-300"
        >
          First refinement instruction (optional)
        </label>
        <Textarea
          id="github-import-instruction"
          ref={instructionRef}
          rows={3}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="For example: preserve the component APIs but modernize the dashboard visuals."
        />
        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={isLoading || !url.trim()}
          onClick={() => void inspectRepository()}
        >
          {isLoading ? (
            <>
              <LuLoader2
                className="h-4 w-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
              Inspecting repository…
            </>
          ) : (
            "Inspect & Open Repository"
          )}
        </Button>
      </section>
    </div>
  );
}
