import { useEffect, useId, useRef, useState } from "react";
import { LuAlertTriangle, LuCheck, LuExternalLink, LuLoader } from "react-icons/lu";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  ALLOWANCE_CAVEAT,
  WEB_SEARCH_MAX_PER_GENERATION,
  WEB_SEARCH_MAX_PER_TURN,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_MAX_SNIPPET_CHARS,
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_INFO,
  WEB_SEARCH_TIMEOUT_SECONDS,
  describeWebSearchEgress,
  isWebSearchUsable,
  supportsKeyless,
  webSearchBlockedReason,
  type WebSearchProvider,
  type WebSearchSettings,
  type WebSearchTestResult,
} from "../../lib/web-search";
import { testWebSearchConnection } from "../../lib/web-search-client";

export interface WebSearchSettingsProps {
  settings: WebSearchSettings;
  /**
   * Applied to the block as it is at the time of the update.
   *
   * An updater rather than a value, for the same reason the MCP card uses one:
   * the provider select and the access-mode switch can both change in a single
   * React batch, and a value would lose one of them.
   */
  onChange: (update: (current: WebSearchSettings) => WebSearchSettings) => void;
  /**
   * Whether Copilot's built-in `web_search` is switched on in Settings.
   *
   * Only used to explain the collision: when canonical search is usable the
   * backend enables one tool per session, and it is this one.
   */
  copilotBuiltInEnabled: boolean;
}

const HELP_CLASS = "mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400";
const LABEL_CLASS = "text-sm font-medium text-gray-700 dark:text-zinc-300";
const SELECT_CLASS =
  "mt-2 h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-zinc-900/40";

export default function WebSearchSettings({
  settings,
  onChange,
  copilotBuiltInEnabled,
}: WebSearchSettingsProps) {
  const enabledId = useId();
  const providerId = useId();
  const keylessId = useId();
  const apiKeyId = useId();

  const [testResult, setTestResult] = useState<WebSearchTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const info = WEB_SEARCH_PROVIDER_INFO[settings.provider];
  const usable = isWebSearchUsable(settings);
  const blockedReason = webSearchBlockedReason(settings);
  const keyless = settings.accessMode === "keyless";

  // A result describes one exact configuration. Any edit makes it stale, so
  // it is cleared rather than left to imply that the new value was checked.
  const update = (
    next: (current: WebSearchSettings) => WebSearchSettings
  ) => {
    setTestResult(null);
    setTestError(null);
    onChange(next);
  };

  const runTest = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      setTestResult(
        await testWebSearchConnection(settings, { signal: controller.signal })
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setTestError(
        error instanceof Error ? error.message : "Could not run the test."
      );
    } finally {
      if (!controller.signal.aborted) setIsTesting(false);
    }
  };

  return (
    <div
      data-testid="web-search-settings"
      className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60"
    >
      <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">
          Web search (all models)
        </h2>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor={enabledId} className={LABEL_CLASS}>
              Allow models to search the web
            </label>
            <p className={HELP_CLASS}>
              Adds a <code className="font-mono">search_web</code> tool to every
              selected model - OpenAI, Anthropic, Gemini, GitHub Copilot and
              Copilot SDK BYOK alike - so it can look up current documentation,
              APIs or brand details. Off by default.
            </p>
          </div>
          <Switch
            id={enabledId}
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              update((current) => ({ ...current, enabled: checked }))
            }
            aria-label="Allow models to search the web"
          />
        </div>

        {/* Query egress is the irreversible part, so it is stated up front and
            never hidden behind a disclosure triangle. */}
        <div
          data-testid="web-search-egress"
          className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20"
        >
          <LuAlertTriangle
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-amber-500"
          />
          <div className="min-w-0 text-xs leading-5 text-amber-800 dark:text-amber-200">
            <p>{describeWebSearchEgress(settings)}</p>
            <p className="mt-1.5">
              Results are third-party text and are treated as untrusted
              reference material: each search returns at most{" "}
              {WEB_SEARCH_MAX_RESULTS} titles and {WEB_SEARCH_MAX_SNIPPET_CHARS}
              -character snippets, capped at {WEB_SEARCH_MAX_PER_TURN} searches
              per turn and {WEB_SEARCH_MAX_PER_GENERATION} per generation, with
              a {WEB_SEARCH_TIMEOUT_SECONDS}-second timeout and no redirects.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor={providerId} className={LABEL_CLASS}>
            Search provider
          </label>
          <select
            id={providerId}
            className={SELECT_CLASS}
            value={settings.provider}
            onChange={(event) => {
              const provider = event.target.value as WebSearchProvider;
              update((current) => ({
                ...current,
                provider,
                // A provider with no keyless mode can never be left in one.
                accessMode: supportsKeyless(provider)
                  ? current.accessMode
                  : "api-key",
              }));
            }}
          >
            {WEB_SEARCH_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {WEB_SEARCH_PROVIDER_INFO[provider].label}
              </option>
            ))}
          </select>
          <p className={HELP_CLASS}>{info.freeTier}</p>
          <p className={HELP_CLASS} data-testid="web-search-allowance-caveat">
            {ALLOWANCE_CAVEAT}
          </p>
          <p className={HELP_CLASS}>
            Requests go only to{" "}
            <code className="font-mono">{info.endpoint}</code>.{" "}
            <a
              href={info.signupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              Get a key
              <LuExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
            {" · "}
            <a
              href={info.pricingUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="web-search-pricing-link"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              {info.label} pricing
              <LuExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
          </p>
        </div>

        {info.supportsKeyless && (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label htmlFor={keylessId} className={LABEL_CLASS}>
                Use the keyless trial instead of a key
              </label>
              <p className={HELP_CLASS}>
                {info.label} documents a free keyless mode that needs no account
                at all. It shares a rate limit with every other keyless user, so
                searches can be refused at busy times; a free key removes that.
                Turning this on clears any key saved here.
              </p>
            </div>
            <Switch
              id={keylessId}
              checked={keyless}
              onCheckedChange={(checked) =>
                update((current) => ({
                  ...current,
                  accessMode: checked ? "keyless" : "api-key",
                  apiKey: checked ? null : current.apiKey,
                }))
              }
              aria-label={`Use the ${info.label} keyless trial`}
            />
          </div>
        )}

        {!keyless && (
          <div>
            <label htmlFor={apiKeyId} className={LABEL_CLASS}>
              {info.label} API key
            </label>
            <Input
              id={apiKeyId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                settings.provider === "tavily" ? "tvly-..." : "Exa API key"
              }
              value={settings.apiKey ?? ""}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  apiKey: event.target.value ? event.target.value : null,
                }))
              }
              className="mt-2"
            />
            <p className={HELP_CLASS}>
              Stored in this browser's settings and sent to the backend with
              each run. It is never written into project history, a commit
              snapshot or a tool argument. A{" "}
              <code className="font-mono">
                {settings.provider === "tavily" ? "TAVILY_API_KEY" : "EXA_API_KEY"}
              </code>{" "}
              in <code className="font-mono">backend/.env</code> is used when
              this is empty.
            </p>
          </div>
        )}

        {settings.enabled && blockedReason && (
          <p
            data-testid="web-search-blocked"
            className="text-xs text-red-600 dark:text-red-400"
          >
            {blockedReason}
          </p>
        )}

        {usable && copilotBuiltInEnabled && (
          <p
            data-testid="web-search-copilot-collision"
            className={HELP_CLASS}
          >
            Copilot's built-in web search is also switched on. shot2code enables
            one search tool per session, so Copilot options will use{" "}
            <code className="font-mono">search_web</code> instead - same limits
            and the same provider as every other model. Switch this card off to
            go back to Copilot's built-in search.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={isTesting || !usable}
            data-testid="web-search-test"
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
          >
            {isTesting ? (
              <LuLoader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LuCheck aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            Test connection
          </button>
          <span className={HELP_CLASS}>
            Runs one real search and spends one provider credit.
          </span>
        </div>

        {testError && (
          <p
            data-testid="web-search-test-error"
            className="text-xs text-red-600 dark:text-red-400"
          >
            {testError}
          </p>
        )}
        {testResult && (
          <p
            data-testid="web-search-test-result"
            className={
              testResult.ok
                ? "text-xs text-green-700 dark:text-green-400"
                : "text-xs text-red-600 dark:text-red-400"
            }
          >
            {testResult.ok
              ? `${testResult.providerLabel ?? info.label} answered with ` +
                `${testResult.resultCount} result(s). Web search is ready.`
              : (testResult.error ?? "The search could not be completed.")}
          </p>
        )}
      </div>
    </div>
  );
}
