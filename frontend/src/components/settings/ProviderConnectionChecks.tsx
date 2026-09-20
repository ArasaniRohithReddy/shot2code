import { useCallback, useRef, useState } from "react";
import {
  LuAlertTriangle,
  LuCheck,
  LuCreditCard,
  LuExternalLink,
  LuLoader,
  LuPlug,
} from "react-icons/lu";
import {
  NATIVE_PROVIDER_CHECKS,
  PROVIDER_CHECK_LABELS,
  buildProviderValidationPayload,
  describeProviderCheck,
  nativeModelForProviderCheck,
  validateProvider,
  type NativeProviderCheckId,
  type ProviderCheckResult,
  type ProviderCredentialSlice,
  type ProviderValidationRequest,
} from "../../lib/provider-validation";
import type { ModelCatalog } from "../../lib/model-selection";

export interface ProviderConnectionChecksProps {
  settings: ProviderCredentialSlice;
  catalog: ModelCatalog;
  selectedModels: readonly string[];
  /** Injectable for tests; defaults to the real endpoint. */
  runCheck?: (
    request: ProviderValidationRequest
  ) => Promise<ProviderCheckResult>;
  /** Seed results, used by tests to render an outcome directly. */
  initialResults?: Partial<Record<NativeProviderCheckId, ProviderCheckResult>>;
}

type CheckState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; result: ProviderCheckResult };

const TONE_STYLES: Record<string, string> = {
  ready:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100",
  billing:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100",
  quota:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100",
  auth: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200",
  config:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100",
  network:
    "border-gray-200 bg-gray-50 text-gray-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200",
};

/**
 * Per-provider "does this credential actually work" checks.
 *
 * Every provider can always be tested, even with an empty field here: the
 * backend may hold a key in its own `.env`, and refusing to test that would
 * make the control lie about what shot2code can reach. The wording says so
 * rather than the button pretending there is nothing to check.
 *
 * Each button sends one provider's credential and nothing else - see
 * `buildProviderValidationPayload`. No key is ever echoed back into this UI;
 * only the backend's category and message are rendered.
 */
export default function ProviderConnectionChecks({
  settings,
  catalog,
  selectedModels,
  runCheck,
  initialResults,
}: ProviderConnectionChecksProps) {
  const [states, setStates] = useState<
    Partial<Record<NativeProviderCheckId, CheckState>>
  >(() =>
    Object.fromEntries(
      Object.entries(initialResults ?? {}).map(([provider, result]) => [
        provider,
        { phase: "done", result } as CheckState,
      ])
    )
  );
  const runRef = useRef(runCheck ?? validateProvider);
  runRef.current = runCheck ?? validateProvider;

  const test = useCallback(
    async (provider: NativeProviderCheckId) => {
      setStates((current) => ({ ...current, [provider]: { phase: "running" } }));
      const payload = buildProviderValidationPayload(provider, {
        settings,
        modelId: nativeModelForProviderCheck(
          provider,
          catalog,
          selectedModels
        ),
      });
      try {
        const result = await runRef.current(payload);
        setStates((current) => ({
          ...current,
          [provider]: { phase: "done", result },
        }));
      } catch (caught) {
        setStates((current) => ({
          ...current,
          [provider]: {
            phase: "done",
            result: {
              provider,
              ok: false,
              category: "request_failed",
              message:
                caught instanceof Error
                  ? caught.message
                  : "The check could not be run.",
              modelId: null,
            },
          },
        }));
      }
    },
    [settings, catalog, selectedModels]
  );

  return (
    <section
      aria-labelledby="provider-checks-heading"
      data-testid="provider-connection-checks"
      className="rounded-md border border-gray-200 p-3 dark:border-zinc-700"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3
          id="provider-checks-heading"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-zinc-300"
        >
          <LuPlug aria-hidden="true" className="h-3.5 w-3.5" />
          Connection checks
        </h3>
      </div>
      <p
        id="provider-checks-help"
        className="mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400"
      >
        Each test sends one tiny request to that provider and may use a small
        amount of quota. Only that provider's key is sent — leave a field empty
        to test the key the backend holds in its own configuration instead.
      </p>

      <ul className="mt-3 space-y-2">
        {NATIVE_PROVIDER_CHECKS.map((provider) => {
          const state = states[provider] ?? { phase: "idle" };
          const running = state.phase === "running";
          const presentation =
            state.phase === "done"
              ? describeProviderCheck(state.result)
              : null;
          const statusId = `provider-check-${provider}-status`;

          return (
            <li key={provider} className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span className="text-sm text-gray-700 dark:text-zinc-300">
                  {PROVIDER_CHECK_LABELS[provider]}
                </span>
                <button
                  type="button"
                  onClick={() => void test(provider)}
                  disabled={running}
                  data-testid={`provider-check-${provider}`}
                  aria-describedby={`provider-checks-help ${
                    presentation ? statusId : ""
                  }`.trim()}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {running ? (
                    <LuLoader
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                    />
                  ) : (
                    <LuCheck aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                  {running
                    ? "Testing…"
                    : `Test ${PROVIDER_CHECK_LABELS[provider]}`}
                </button>
              </div>

              <div aria-live="polite">
                {presentation && (
                  <div
                    id={statusId}
                    data-testid={`provider-check-${provider}-result`}
                    data-tone={presentation.tone}
                    role={presentation.tone === "ready" ? undefined : "alert"}
                    className={`mt-1.5 flex items-start gap-1.5 rounded-md border p-2 text-xs leading-5 ${
                      TONE_STYLES[presentation.tone] ?? TONE_STYLES.error
                    }`}
                  >
                    {presentation.tone === "ready" ? (
                      <LuCheck
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      />
                    ) : presentation.tone === "billing" ? (
                      <LuCreditCard
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      />
                    ) : (
                      <LuAlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">
                        {presentation.headline}
                      </span>
                      {presentation.detail && <> — {presentation.detail}</>}
                      {presentation.guidance && (
                        <span className="mt-1 block">
                          {presentation.guidance}
                        </span>
                      )}
                      {state.phase === "done" && state.result.modelId && (
                        <span className="mt-1 block opacity-80">
                          Tested with {state.result.modelId}.
                        </span>
                      )}
                      {presentation.actionUrl && presentation.actionLabel && (
                        <a
                          href={presentation.actionUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          data-testid={`provider-check-${provider}-action`}
                          className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                        >
                          {presentation.actionLabel}
                          <LuExternalLink
                            aria-hidden="true"
                            className="h-3 w-3"
                          />
                        </a>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
