import { useId, useState } from "react";
import { LuAlertTriangle, LuCheck, LuChevronDown, LuLoader } from "react-icons/lu";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  BYOK_PROVIDERS,
  BYOK_PROVIDER_LABELS,
  BYOK_WIRE_APIS,
  BYOK_WIRE_API_LABELS,
  byokUnusableReason,
  describeByokEndpoint,
  hostOf,
  isLoopbackHost,
  validateByokSettings,
  type ByokProvider,
  type ByokWireApi,
  type CopilotSdkByokSettings,
} from "../../lib/copilot-sdk-byok";
import { validateIntegrations } from "../../lib/integrations-client";
import {
  byokSelectionIdsIn,
  unavailableByokSelections,
  type IntegrationSettingsSlice,
  type IntegrationValidationResult,
} from "../../lib/integrations";
import IntegrationDiagnostics from "./IntegrationDiagnostics";

export interface CopilotSdkByokSettingsProps {
  settings: CopilotSdkByokSettings;
  /** An updater, so two edits landing in one React batch cannot lose one. */
  onChange: (
    update: (current: CopilotSdkByokSettings) => CopilotSdkByokSettings
  ) => void;
  /** Sent alongside the connection so one check covers the configuration. */
  mcpServers: IntegrationSettingsSlice["mcpServers"];
  /** The current model selection, so the card can say what will run on it. */
  selectedModels: string[];
}

const FIELD_CLASS = "mt-2";
const HELP_CLASS = "mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400";
const LABEL_CLASS = "text-sm font-medium text-gray-700 dark:text-zinc-300";
const ERROR_CLASS = "mt-1 text-xs text-red-600 dark:text-red-400";
// A native select keeps the whole card usable with a keyboard and a screen
// reader without a popover layer, which matters in a form this long.
const SELECT_CLASS =
  "mt-2 h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-zinc-900/40";

/**
 * The Copilot SDK BYOK connection.
 *
 * One connection, which the backend turns into one selectable entry per base
 * model under "Copilot SDK (BYOK)" in Models. Those entries have their own ids,
 * so a model can be picked directly *and* through this endpoint in the same
 * generation, producing two variants you can compare.
 *
 * This is additive. The OpenAI base URL and key, the Anthropic key, the Gemini
 * key and the Replicate key above are untouched, are never read here, and are
 * never used as a fallback: this connection carries its own credential. A
 * native pick always runs on its native provider, even while this is switched
 * on, so nothing is ever silently re-routed.
 *
 * The key fields are password inputs and the value is never echoed into a
 * toast, a log line or the validation response - the backend answers with
 * presence flags and a host name only.
 */
export default function CopilotSdkByokSettings({
  settings,
  onChange,
  mcpServers,
  selectedModels,
}: CopilotSdkByokSettingsProps) {
  const baseId = useId().replace(/:/g, "");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [result, setResult] = useState<IntegrationValidationResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const errors = validateByokSettings(settings);
  const reason = byokUnusableReason(settings);
  const update = (patch: Partial<CopilotSdkByokSettings>) => {
    setResult(null);
    setRequestError(null);
    onChange((current) => ({ ...current, ...patch }));
  };

  const setText = (field: keyof CopilotSdkByokSettings, value: string) =>
    update({ [field]: value.trim() || null } as Partial<CopilotSdkByokSettings>);

  const runValidation = async () => {
    setIsValidating(true);
    setRequestError(null);
    try {
      setResult(
        await validateIntegrations({ copilotSdkByok: settings, mcpServers })
      );
    } catch (caught) {
      // Only the request's own failure text, never anything that was sent.
      setRequestError(
        caught instanceof Error
          ? caught.message
          : "Could not check this configuration."
      );
    } finally {
      setIsValidating(false);
    }
  };

  const localOnly =
    settings.provider === "openai" && isLoopbackHost(hostOf(settings.baseUrl));
  const selectedByokIds = byokSelectionIdsIn(selectedModels);
  const orphaned = unavailableByokSelections(selectedModels, {
    copilotSdkByok: settings,
    mcpServers,
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">
            GitHub Copilot SDK BYOK
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
            Experimental · separate from the API keys above
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor={`${baseId}-enabled`}
            className="text-xs text-gray-600 dark:text-zinc-400"
          >
            {settings.enabled ? "On" : "Off"}
          </label>
          <Switch
            id={`${baseId}-enabled`}
            checked={settings.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
            aria-describedby={`${baseId}-intro`}
          />
        </div>
      </div>

      <div className="space-y-4 p-4">
        <p
          id={`${baseId}-intro`}
          className="text-xs leading-5 text-gray-500 dark:text-zinc-400"
        >
          Runs a model through the GitHub Copilot SDK against your own endpoint
          and your own key. <strong>No Copilot subscription is required.</strong>{" "}
          The SDK runtime is experimental. Every model this connection can serve
          appears in Models as its own option, so you can run a model directly
          and through your endpoint in the same generation and compare them.
          Your existing OpenAI, Anthropic, Gemini and Replicate settings are
          untouched and keep using their own providers — a direct pick is never
          re-routed. Gemini has no SDK provider, so Gemini models always use the
          Gemini API key.
        </p>

        {settings.enabled && (
          <>
            <div>
              <label className={LABEL_CLASS} htmlFor={`${baseId}-provider`}>
                Provider
              </label>
              <p className={HELP_CLASS} id={`${baseId}-provider-help`}>
                Azure OpenAI and OpenAI-compatible endpoints serve the GPT
                models; Anthropic serves the Claude models.
              </p>
              <select
                id={`${baseId}-provider`}
                className={SELECT_CLASS}
                value={settings.provider}
                aria-describedby={`${baseId}-provider-help`}
                onChange={(event) =>
                  update({
                    provider: event.target.value as ByokProvider,
                    // The backend refuses an api-version outside Azure.
                    azureApiVersion:
                      event.target.value === "azure"
                        ? settings.azureApiVersion
                        : null,
                  })
                }
              >
                {BYOK_PROVIDERS.map((value) => (
                  <option key={value} value={value}>
                    {BYOK_PROVIDER_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor={`${baseId}-base-url`}>
                Base URL
              </label>
              <p className={HELP_CLASS} id={`${baseId}-base-url-help`}>
                {settings.provider === "azure"
                  ? "Required. The endpoint of your Azure OpenAI resource."
                  : "Optional for the provider's own endpoint. https:// is required unless it points at localhost."}
              </p>
              <Input
                id={`${baseId}-base-url`}
                className={FIELD_CLASS}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  settings.provider === "azure"
                    ? "https://my-resource.openai.azure.com"
                    : "https://api.example.com/v1"
                }
                value={settings.baseUrl ?? ""}
                onChange={(event) => setText("baseUrl", event.target.value)}
                aria-describedby={`${baseId}-base-url-help`}
                aria-invalid={errors.baseUrl ? true : undefined}
                aria-errormessage={
                  errors.baseUrl ? `${baseId}-base-url-error` : undefined
                }
              />
              {errors.baseUrl && (
                <p
                  id={`${baseId}-base-url-error`}
                  role="alert"
                  className={ERROR_CLASS}
                >
                  {errors.baseUrl}
                </p>
              )}
            </div>

            <div>
              <label className={LABEL_CLASS} htmlFor={`${baseId}-api-key`}>
                API key for this connection
              </label>
              <p className={HELP_CLASS} id={`${baseId}-api-key-help`}>
                Dedicated to this connection and stored on this device only.
                shot2code will not use your OpenAI or Anthropic key here.
                {localOnly
                  ? " A local endpoint may be left without one."
                  : " Required."}
              </p>
              <Input
                id={`${baseId}-api-key`}
                className={FIELD_CLASS}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
                value={settings.apiKey ?? ""}
                onChange={(event) => setText("apiKey", event.target.value)}
                aria-describedby={`${baseId}-api-key-help`}
                aria-invalid={errors.apiKey ? true : undefined}
                aria-errormessage={
                  errors.apiKey ? `${baseId}-api-key-error` : undefined
                }
              />
              {errors.apiKey && (
                <p
                  id={`${baseId}-api-key-error`}
                  role="alert"
                  className={ERROR_CLASS}
                >
                  {errors.apiKey}
                </p>
              )}
            </div>

            <div
              className={`rounded-md border p-3 text-xs leading-5 ${
                reason === null
                  ? "border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300"
                  : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
              }`}
            >
              <p className="font-medium">
                {reason === null
                  ? "Where a BYOK option goes"
                  : `Not ready — ${reason}`}
              </p>
              <p className="notranslate mt-1 break-words" translate="no">
                {describeByokEndpoint(settings)}
              </p>
              <p className="mt-1">
                {selectedByokIds.length > 0
                  ? `${selectedByokIds.length} BYOK option${
                      selectedByokIds.length === 1 ? "" : "s"
                    } selected in Models. Options run as sdk-byok/${settings.provider}/<model>.`
                  : `No BYOK option is selected yet. They appear in Models under "Copilot SDK (BYOK)".`}
              </p>
            </div>

            {orphaned.length > 0 && (
              <p
                role="alert"
                className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] leading-4 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
              >
                <LuAlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  {orphaned.length} selected BYOK option
                  {orphaned.length === 1 ? "" : "s"} no longer match this
                  connection. Switch the provider back, or reselect in Models.
                </span>
              </p>
            )}

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((open) => !open)}
                aria-expanded={showAdvanced}
                aria-controls={`${baseId}-advanced`}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Advanced connection options
                <LuChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 transition-transform ${
                    showAdvanced ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showAdvanced && (
                <div id={`${baseId}-advanced`} className="mt-3 space-y-4">
                  <div>
                    <label className={LABEL_CLASS} htmlFor={`${baseId}-bearer`}>
                      Bearer token (optional)
                    </label>
                    <p className={HELP_CLASS} id={`${baseId}-bearer-help`}>
                      Sent instead of the API key when your gateway expects an
                      Authorization header. Stored on this device only.
                    </p>
                    <Input
                      id={`${baseId}-bearer`}
                      className={FIELD_CLASS}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={settings.bearerToken ?? ""}
                      onChange={(event) =>
                        setText("bearerToken", event.target.value)
                      }
                      aria-describedby={`${baseId}-bearer-help`}
                      aria-invalid={errors.bearerToken ? true : undefined}
                    />
                    {errors.bearerToken && (
                      <p role="alert" className={ERROR_CLASS}>
                        {errors.bearerToken}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={LABEL_CLASS} htmlFor={`${baseId}-wire-api`}>
                      Wire API
                    </label>
                    <p className={HELP_CLASS} id={`${baseId}-wire-help`}>
                      How requests are shaped. Most OpenAI-compatible servers
                      expect Chat Completions.
                    </p>
                    <select
                      id={`${baseId}-wire-api`}
                      className={SELECT_CLASS}
                      value={settings.wireApi}
                      aria-describedby={`${baseId}-wire-help`}
                      onChange={(event) =>
                        update({ wireApi: event.target.value as ByokWireApi })
                      }
                    >
                      {BYOK_WIRE_APIS.map((value) => (
                        <option key={value} value={value}>
                          {BYOK_WIRE_API_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      className={LABEL_CLASS}
                      htmlFor={`${baseId}-wire-model`}
                    >
                      {settings.provider === "azure"
                        ? "Deployment name (optional)"
                        : "Model name override (optional)"}
                    </label>
                    <p className={HELP_CLASS} id={`${baseId}-wire-model-help`}>
                      Use this when your endpoint serves one model under a name
                      of its own, whichever option is picked.
                    </p>
                    <Input
                      id={`${baseId}-wire-model`}
                      className={FIELD_CLASS}
                      autoComplete="off"
                      spellCheck={false}
                      value={settings.wireModel ?? ""}
                      onChange={(event) =>
                        setText("wireModel", event.target.value)
                      }
                      aria-describedby={`${baseId}-wire-model-help`}
                      aria-invalid={errors.wireModel ? true : undefined}
                    />
                    {errors.wireModel && (
                      <p role="alert" className={ERROR_CLASS}>
                        {errors.wireModel}
                      </p>
                    )}
                  </div>

                  {settings.provider === "azure" && (
                    <div>
                      <label
                        className={LABEL_CLASS}
                        htmlFor={`${baseId}-azure-version`}
                      >
                        Azure API version (optional)
                      </label>
                      <p
                        className={HELP_CLASS}
                        id={`${baseId}-azure-version-help`}
                      >
                        The api-version query value your resource expects.
                      </p>
                      <Input
                        id={`${baseId}-azure-version`}
                        className={FIELD_CLASS}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="2024-10-21"
                        value={settings.azureApiVersion ?? ""}
                        onChange={(event) =>
                          setText("azureApiVersion", event.target.value)
                        }
                        aria-describedby={`${baseId}-azure-version-help`}
                        aria-invalid={errors.azureApiVersion ? true : undefined}
                      />
                      {errors.azureApiVersion && (
                        <p role="alert" className={ERROR_CLASS}>
                          {errors.azureApiVersion}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void runValidation()}
                disabled={isValidating}
                className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {isValidating ? (
                  <LuLoader
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                  />
                ) : (
                  <LuCheck aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                Validate connection
              </button>
              <span className="text-xs text-gray-500 dark:text-zinc-400">
                Checks the settings only. Nothing is sent to the endpoint.
              </span>
            </div>

            <div aria-live="polite" className="space-y-2">
              {requestError && (
                <p role="alert" className={ERROR_CLASS}>
                  {requestError}
                </p>
              )}
              {result && result.valid && (
                <p className="flex items-start gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100">
                  <LuCheck
                    aria-hidden="true"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  />
                  <span>
                    {result.byokSelectionIds.length > 0
                      ? `Configuration accepted. It makes ${result.byokSelectionIds.length} option${
                          result.byokSelectionIds.length === 1 ? "" : "s"
                        } selectable in Models.`
                      : result.byok?.reason
                        ? `Accepted, but not usable yet: it ${result.byok.reason}.`
                        : "Accepted, but no option is selectable yet."}
                  </span>
                </p>
              )}
              {result && !result.valid && result.error && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                >
                  <LuAlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  />
                  <span>{result.error}</span>
                </p>
              )}
              {result && (
                <IntegrationDiagnostics
                  diagnostics={result.diagnostics}
                  idPrefix={`${baseId}-validation`}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
