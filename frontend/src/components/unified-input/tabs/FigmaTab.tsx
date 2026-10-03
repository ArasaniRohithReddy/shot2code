import { useRef, useState } from "react";
import { LuExternalLink, LuFigma, LuKeyRound } from "react-icons/lu";
import toast from "react-hot-toast";
import { HTTP_BACKEND_URL } from "../../../config";
import { readDesignSourceAssets } from "../../../lib/design-source-assets";
import { Stack } from "../../../lib/stacks";
import type { DesignSourceAsset } from "../../../types";
import type { DesignSystemSelectorProps } from "../../settings/DesignSystemSelector";
import type { ModelSelectorProps } from "../../settings/ModelSelector";
import { Input } from "../../ui/input";
import GenerationControls from "../GenerationControls";

interface Props {
  doCreate: (
    images: string[],
    inputMode: "image" | "video",
    textPrompt?: string,
    isAssetExtractionEnabled?: boolean,
    multiScreenshotMode?: undefined,
    sourceAssets?: DesignSourceAsset[]
  ) => void;
  figmaAccessToken: string | null;
  stack: Stack;
  setStack: (stack: Stack) => void;
  designSystem: DesignSystemSelectorProps;
  modelSelector?: ModelSelectorProps;
}

export default function FigmaTab({
  doCreate,
  figmaAccessToken,
  stack,
  setStack,
  designSystem,
  modelSelector,
}: Props) {
  const [url, setUrl] = useState("");
  const [instruction, setInstruction] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAssetExtractionEnabled, setIsAssetExtractionEnabled] =
    useState(false);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const hasToken = Boolean(figmaAccessToken?.trim());

  const importFigma = async () => {
    const figmaUrl = url.trim();
    if (!/^https:\/\/([\w.-]*\.)?figma\.com\//i.test(figmaUrl)) {
      toast.error("Paste a valid https://www.figma.com design URL.");
      return;
    }

    if (!hasToken) {
      toast.error(
        "Add a scoped Figma personal access token in Settings, or export the frame and use Upload."
      );
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`${HTTP_BACKEND_URL}/api/figma/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: figmaUrl,
          token: figmaAccessToken,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.detail === "string"
            ? payload.detail
            : `Figma import failed (HTTP ${response.status}).`
        );
      }
      const images = Array.isArray(payload.images)
        ? payload.images.filter(
            (image: unknown): image is string => typeof image === "string"
          )
        : [];
      if (images.length === 0) {
        throw new Error("Figma returned no renderable frames.");
      }
      const sourceAssets = readDesignSourceAssets(payload.sourceAssets);
      const warnings = Array.isArray(payload.warnings)
        ? payload.warnings.filter(
            (warning: unknown): warning is string =>
              typeof warning === "string" && warning.trim().length > 0
          )
        : [];
      doCreate(
        images,
        "image",
        instruction,
        isAssetExtractionEnabled,
        undefined,
        sourceAssets
      );
      if (sourceAssets.length > 0) {
        toast.success(
          `Imported ${images.length} Figma frame${
            images.length === 1 ? "" : "s"
          } and ${sourceAssets.length} reusable asset${
            sourceAssets.length === 1 ? "" : "s"
          }.`
        );
      }
      warnings.forEach((warning: string) => toast(warning));
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Could not import Figma."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <section className="rounded-xl border border-gray-200 bg-gray-50/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200">
            <LuFigma className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-zinc-100">
              Import from Figma
            </h3>
            <p className="mt-1 text-sm leading-5 text-gray-600 dark:text-zinc-400">
              Render selected frames through Figma's official REST API, then
              apply your selected stack and model choices in shot2code.
            </p>
          </div>
        </div>

        <label
          htmlFor="figma-design-url"
          className="mt-5 block text-sm font-medium text-gray-700 dark:text-zinc-300"
        >
          Figma design URL
        </label>
        <Input
          id="figma-design-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.figma.com/design/…"
          className="mt-2"
        />

        <div className="mt-4 space-y-2">
          <div
            className={`rounded-lg border p-3 text-xs ${
              hasToken
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200"
                : "border-gray-200 bg-white text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            }`}
          >
            <p className="flex items-center gap-1.5 font-medium">
              <LuKeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              REST frame import
            </p>
            <p className="mt-1">
              {hasToken
                ? "Ready. The saved PAT is sent only to api.figma.com."
                : "Add a Figma personal access token in Settings."}
            </p>
          </div>
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <p>
              Figma limits its desktop and hosted MCP servers to clients in the
              Figma MCP Catalog. shot2code is not currently allowlisted, so this
              tab does not offer a direct MCP connection.
            </p>
            <a
              href="https://developers.figma.com/docs/figma-mcp-server/"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex min-h-9 items-center gap-1 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              Figma MCP access documentation
              <LuExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <GenerationControls
        textPrompt={instruction}
        onTextPromptChange={setInstruction}
        textInputRef={instructionRef}
        onTextInputKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void importFigma();
          }
        }}
        stack={stack}
        setStack={setStack}
        designSystem={designSystem}
        modelSelector={modelSelector}
        showAssetExtraction={hasToken}
        isAssetExtractionEnabled={isAssetExtractionEnabled}
        onAssetExtractionChange={setIsAssetExtractionEnabled}
        onGenerate={() => void importFigma()}
        actionLabel="Render Figma & Generate"
        loadingActionLabel="Importing Figma…"
        isActionLoading={isLoading}
        isActionDisabled={!url.trim() || !hasToken}
        actionTestId="figma-generate"
      />

      <p className="text-center text-xs leading-5 text-gray-500 dark:text-zinc-400">
        Exported Figma PNG, JPG and SVG files still work in Upload. Figma does
        not provide a general REST client SDK that converts arbitrary files to
        code; this tab uses its documented REST rendering endpoints.
      </p>
    </div>
  );
}
