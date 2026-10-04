import { FormEvent, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  LuBookOpen,
  LuCheckCircle2,
  LuFileArchive,
  LuFileJson,
  LuFolderOpen,
  LuGlobe2,
  LuLoader2,
  LuShieldCheck,
  LuTrash2,
} from "react-icons/lu";
import type { ProjectContext } from "../../../types";
import {
  STORYBOOK_JSON_ACCEPT,
  STORYBOOK_ZIP_ACCEPT,
  inspectStorybookFiles,
  inspectStorybookUrl,
  inspectStorybookZip,
  type StorybookImportAnalysis,
  type StorybookImportProgress,
  type StorybookLocalSourceKind,
} from "../../../lib/storybook-import";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Progress } from "../../ui/progress";

interface BuiltStorybookImportProps {
  setProjectContext: (context: ProjectContext | null) => void;
}

export interface BuiltStorybookImportResultProps {
  analysis: StorybookImportAnalysis;
  onUse: () => void;
  onClear: () => void;
}

export function BuiltStorybookImportResult({
  analysis,
  onUse,
  onClear,
}: BuiltStorybookImportResultProps) {
  return (
    <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LuCheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="truncate text-sm font-semibold text-emerald-950 dark:text-emerald-100">
              {analysis.context.name}
            </p>
          </div>
          <p className="mt-1 pl-6 text-xs leading-5 text-emerald-800 dark:text-emerald-300">
            {analysis.context.component_count} components · {analysis.story_count} stories ·{" "}
            {analysis.docs_count} docs · {analysis.metadata_files.length} JSON files
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear Built Storybook analysis"
          title="Clear Built Storybook analysis"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-emerald-700 transition-colors duration-200 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
        >
          <LuTrash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {analysis.metadata_files.map((path) => (
          <span
            key={path}
            className="rounded-full bg-white/90 px-2 py-1 font-mono text-[11px] text-emerald-800 dark:bg-zinc-900 dark:text-emerald-200"
          >
            {path}
          </span>
        ))}
      </div>

      {analysis.warnings.map((warning) => (
        <p
          key={warning}
          className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {warning}
        </p>
      ))}

      <Button type="button" className="min-h-11 w-full" onClick={onUse}>
        Use as component-library context
      </Button>
    </div>
  );
}

function BuiltStorybookImport({
  setProjectContext,
}: BuiltStorybookImportProps) {
  const [analysis, setAnalysis] = useState<StorybookImportAnalysis | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<StorybookImportProgress | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const startScan = () => {
    setIsScanning(true);
    setError(null);
    setAnalysis(null);
    setProgress(null);
  };

  const finishScan = (result: StorybookImportAnalysis) => {
    setAnalysis(result);
    toast.success(
      `Analysed ${result.context.component_count} components from ${result.context.name}`
    );
  };

  const failScan = (failure: unknown) => {
    const message =
      failure instanceof Error
        ? failure.message
        : "Could not inspect the Built Storybook metadata.";
    setError(message);
    setProgress(null);
    toast.error(message);
  };

  const analyseFiles = async (
    files: File[],
    sourceKind: StorybookLocalSourceKind
  ) => {
    startScan();
    try {
      finishScan(await inspectStorybookFiles(files, sourceKind, setProgress));
    } catch (failure) {
      failScan(failure);
    } finally {
      setIsScanning(false);
    }
  };

  const analyseZip = async (file: File) => {
    startScan();
    try {
      finishScan(await inspectStorybookZip(file, setProgress));
    } catch (failure) {
      failScan(failure);
    } finally {
      setIsScanning(false);
    }
  };

  const analyseUrl = async (event: FormEvent) => {
    event.preventDefault();
    startScan();
    try {
      finishScan(await inspectStorybookUrl(publicUrl, setProgress));
    } catch (failure) {
      failScan(failure);
    } finally {
      setIsScanning(false);
    }
  };

  const clearAnalysis = () => {
    setAnalysis(null);
    setError(null);
    setProgress(null);
  };

  return (
    <section className="mt-5 space-y-4" aria-label="Import Built Storybook metadata">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-900">
          <LuBookOpen className="h-5 w-5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-800 dark:text-zinc-100">
              Built Storybook metadata
            </h4>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200">
              Add-on
            </span>
          </div>
          <p className="mt-1 max-w-[70ch] text-xs leading-5 text-gray-600 dark:text-zinc-400">
            Add an already-built Storybook as structured component-library context. shot2code reads
            only <code>index.json</code> and optional <code>manifests/components.json</code> and{" "}
            <code>manifests/docs.json</code>.
          </p>
        </div>
      </div>

      <div className="flex gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-xs leading-5 text-gray-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
        <LuShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p>
          JSON only: stories, bundles, CSF modules, decorators, loaders, play functions, addons,
          manifest references and <code>iframe.html</code> are never loaded or executed. Names,
          descriptions, docs and path labels remain untrusted reference data.
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
        ref={filesInputRef}
        type="file"
        multiple
        accept={STORYBOOK_JSON_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) void analyseFiles(files, "files");
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept={STORYBOOK_ZIP_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void analyseZip(file);
        }}
      />

      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          disabled={isScanning}
          onClick={() => folderInputRef.current?.click()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
        >
          <LuFolderOpen className="h-4 w-4" />
          Built folder
        </button>
        <button
          type="button"
          disabled={isScanning}
          onClick={() => filesInputRef.current?.click()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
        >
          <LuFileJson className="h-4 w-4" />
          JSON files
        </button>
        <button
          type="button"
          disabled={isScanning}
          onClick={() => zipInputRef.current?.click()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/30"
        >
          <LuFileArchive className="h-4 w-4" />
          Built ZIP
        </button>
      </div>

      <form onSubmit={analyseUrl} className="space-y-2">
        <label
          htmlFor="storybook-public-url"
          className="text-sm font-medium text-gray-700 dark:text-zinc-300"
        >
          Public HTTPS build <span className="font-normal text-gray-400">Optional</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <LuGlobe2 className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
            <Input
              id="storybook-public-url"
              type="url"
              value={publicUrl}
              onChange={(event) => setPublicUrl(event.target.value)}
              placeholder="https://storybook.example.com/"
              className="pl-9"
              disabled={isScanning}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            className="min-h-11 shrink-0 bg-white dark:bg-zinc-900"
            disabled={isScanning || !publicUrl.trim()}
          >
            Inspect public build
          </Button>
        </div>
        <p className="text-xs leading-5 text-gray-500 dark:text-zinc-400">
          Only fixed JSON paths are requested. Private or local addresses, HTTP, credentials,
          query strings, custom ports, unsafe redirects and oversized responses are refused.
        </p>
      </form>

      {progress && isScanning && (
        <div role="status" className="space-y-2 rounded-md bg-gray-100 px-3 py-3 dark:bg-zinc-800">
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-300">
            <LuLoader2 className="h-4 w-4 animate-spin" />
            {progress.message}
          </div>
          <Progress value={progress.percent} aria-label="Built Storybook import progress" />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      {analysis && !isScanning && (
        <BuiltStorybookImportResult
          analysis={analysis}
          onClear={clearAnalysis}
          onUse={() => {
            setProjectContext(analysis.context);
            toast.success(`${analysis.context.name} is now used as component-library context.`);
          }}
        />
      )}
    </section>
  );
}

export default BuiltStorybookImport;
