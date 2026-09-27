import { useEffect, useState } from "react";
import {
  LuDownload,
  LuExternalLink,
  LuLoader,
  LuSearch,
  LuX,
} from "react-icons/lu";
import {
  FEATURED_MCP_TEMPLATES,
  registryEntryToServer,
  searchMcpRegistry,
  type McpRegistryEntry,
} from "../../lib/mcp-registry";
import type { McpServerConfig } from "../../lib/mcp-servers";
import { Input } from "../ui/input";

interface Props {
  configured: McpServerConfig[];
  atLimit: boolean;
  onInstall: (server: McpServerConfig) => void;
  onClose: () => void;
}

const INSTALL_CLASS =
  "flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

export default function McpMarketplace({
  configured,
  atLimit,
  onInstall,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<McpRegistryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configuredUrls = new Set(
    configured.map((server) => server.url).filter(Boolean)
  );

  const search = async (value: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setResults(await searchMcpRegistry(value, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load the MCP Registry."
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void search("", controller.signal);
    return () => controller.abort();
  }, []);

  return (
    <section
      className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900/70 dark:bg-violet-950/20"
      aria-labelledby="mcp-marketplace-title"
      data-testid="mcp-marketplace"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3
            id="mcp-marketplace-title"
            className="text-sm font-semibold text-gray-900 dark:text-zinc-100"
          >
            MCP Registry
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-400">
            Installing adds a disabled, untrusted draft. Review its URL,
            authentication and tools before enabling it.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close MCP Registry"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-violet-950/50"
        >
          <LuX className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4">
        <h4 className="text-xs font-semibold text-gray-700 dark:text-zinc-300">
          Design integrations
        </h4>
        <div className="mt-2 space-y-2">
          {FEATURED_MCP_TEMPLATES.map((template) => {
            const preview = template.server();
            const installed = configuredUrls.has(preview.url);
            return (
              <article
                key={template.id}
                className="rounded-lg border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                      {template.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-400">
                      {template.description}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                      {template.note}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={atLimit || installed}
                    onClick={() => onInstall(template.server())}
                    className={INSTALL_CLASS}
                  >
                    <LuDownload className="h-3.5 w-3.5" aria-hidden="true" />
                    {installed ? "Added" : "Add"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query);
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the official MCP Registry"
          aria-label="Search the MCP Registry"
        />
        <button type="submit" className={INSTALL_CLASS} disabled={loading}>
          {loading ? (
            <LuLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <LuSearch className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Search
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {results.map((entry) => {
          const installed = configuredUrls.has(entry.url);
          return (
            <article
              key={`${entry.name}-${entry.version}`}
              className="rounded-lg border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {entry.title}
                  </p>
                  <p className="notranslate mt-0.5 break-all text-[11px] text-gray-500 dark:text-zinc-400" translate="no">
                    {entry.name} · {entry.version}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-zinc-400">
                    {entry.description}
                  </p>
                  {entry.repositoryUrl && (
                    <a
                      href={entry.repositoryUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-flex min-h-9 items-center gap-1 text-[11px] font-medium text-violet-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300"
                    >
                      Review source
                      <LuExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  disabled={atLimit || installed}
                  onClick={() => onInstall(registryEntryToServer(entry))}
                  className={INSTALL_CLASS}
                >
                  <LuDownload className="h-3.5 w-3.5" aria-hidden="true" />
                  {installed ? "Added" : "Add"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
