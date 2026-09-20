import { useId, useState } from "react";
import {
  LuAlertTriangle,
  LuCheck,
  LuChevronDown,
  LuCreditCard,
  LuExternalLink,
  LuLoader,
  LuZap,
} from "react-icons/lu";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  BYOK_PROVIDERS,
  BYOK_PROVIDER_LABELS,
  BYOK_WIRE_APIS,
  BYOK_WIRE_API_AUTOMATIC_LABEL,
  BYOK_WIRE_API_LABELS,
  byokCustomSelectionId,
  byokUnusableReason,
  describeByokEndpoint,
  describeWireApiChoice,
  effectiveWireApi,
  hostOf,
  isLoopbackHost,
  isValidWireModel,
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
import {
  buildProviderValidationPayload,
  describeProviderCheck,
  validateProvider,
  type ProviderCheckResult,
  type ProviderValidationRequest,
} from "../../lib/provider-validation";

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
  /** Injectable for tests; defaults to the real live-check endpoint. */
  runProviderCheck?: (
    request: ProviderValidationRequest
  ) => Promise<ProviderCheckResult>;
  /** Seed discovery, used by tests to render the picker directly. */
  initialDiscoveredModels?: string[];
  /** Seed the disclosure open, used by tests to render advanced fields. */
  initialShowAdvanced?: boolean;
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
  runProviderCheck,
  initialDiscoveredModels,
  initialShowAdvanced,
}: CopilotSdkByokSettingsProps) {
  const baseId = useId().replace(/:/g, "");
  const [showAdvanced, setShowAdvanced] = useState(
    initialShowAdvanced === true
  );
  const [isValidating, setIsValidating] = useState(false);
  const [result, setResult] = useState<IntegrationValidationResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [liveResult, setLiveResult] = useState<ProviderCheckResult | null>(null);
  // Kept apart from `liveResult` so choosing one of the discovered models does
  // not erase the list it was chosen from.
  const [discovered, setDiscovered] = useState<string[]>(
    initialDiscoveredModels ?? []
  );

  const errors = validateByokSettings(settings);
  const reason = byokUnusableReason(settings);

  /** Fields that change *where* the connection points, invalidating discovery. */
  const CONNECTION_FIELDS: Array<keyof CopilotSdkByokSettings> = [
    "provider",
    "baseUrl",
    "apiKey",
    "bearerToken",
    "wireApi",
    "azureApiVersion",
  ];

  const update = (patch: Partial<CopilotSdkByokSettings>) => {
    setResult(null);
    setRequestError(null);
    setLiveResult(null);
    if (CONNECTION_FIELDS.some((field) => field in patch)) {
      setDiscovered([]);
    }
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

  // Exercise the identity the user actually picked; otherwise let the backend
  // choose, so an unconfigured selection still gets a cheap reachability test.
  // A configured endpoint model wins: that is the identity that will really run.
  const customId =
    settings.wireModel && isValidWireModel(settings.wireModel)
      ? byokCustomSelectionId(settings.provider, settings.wireModel.trim())
      : null;
  const liveTestTarget = customId ?? selectedByokIds[0] ?? null;

  // Only an OpenAI-compatible endpoint exposes `/models`; mirrors
  // `_supports_model_listing` in backend/provider_validation.py.
  const canDiscoverModels =
    settings.provider === "openai" && Boolean(settings.baseUrl);

  const runLiveTest = async () => {
    setIsTesting(true);
    setRequestError(null);
    try {
      const check = runProviderCheck ?? validateProvider;
      const outcome = await check(
        buildProviderValidationPayload("copilot-byok", {
          copilotSdkByok: settings,
          modelId: liveTestTarget,
        })
      );
      setLiveResult(outcome);
      // The endpoint reports what it serves on success *and* on a "no such
      // model" failure, so the list is kept either way — that failure is
      // precisely when the picker is most useful.
      if (outcome.models.length > 0) setDiscovered(outcome.models);
    } catch (caught) {
      setLiveResult({
        provider: "copilot-byok",
        ok: false,
        category: "request_failed",
        message:
          caught instanceof Error
            ? caught.message
            : "The check could not be run.",
        modelId: null,
        models: [],
      });
    } finally {
      setIsTesting(false);
    }
  };

  const livePresentation = liveResult
    ? describeProviderCheck(liveResult)
    : null;

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
                <strong>OpenAI-compatible</strong> works with any endpoint that
                speaks the OpenAI wire format — a vendor API, a gateway, a
                self-hosted server or one your organisation runs — and it can
                serve either the catalog models or its own. Azure OpenAI and
                Anthropic address those services directly.
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
              <label
                className={LABEL_CLASS}
                htmlFor={`${baseId}-wire-model`}
              >
                {settings.provider === "azure"
                  ? "Deployment name (optional)"
                  : "Endpoint model (optional)"}
              </label>
              <p className={HELP_CLASS} id={`${baseId}-wire-model-help`}>
                {canDiscoverModels
                  ? "The exact model id this endpoint serves, whatever it is called. Leave it empty to use the catalog models above instead. Run Test model access to list what the endpoint reports, or type the name yourself."
                  : settings.provider === "azure"
                    ? "The deployment name on your Azure OpenAI resource. Azure does not list deployments here, so type it exactly."
                    : "The model name this endpoint serves. Anthropic does not list models here, so type it exactly."}
              </p>

              {discovered.length > 0 && (
                <div className="mt-2">
                  <label
                    className="text-xs font-medium text-gray-600 dark:text-zinc-400"
                    htmlFor={`${baseId}-discovered`}
                  >
                    Models this endpoint reports ({discovered.length})
                  </label>
                  <select
                    id={`${baseId}-discovered`}
                    data-testid="byok-discovered-models"
                    className={SELECT_CLASS}
                    value={
                      settings.wireModel &&
                      discovered.includes(settings.wireModel)
                        ? settings.wireModel
                        : ""
                    }
                    onChange={(event) =>
                      setText("wireModel", event.target.value)
                    }
                    aria-describedby={`${baseId}-discovered-help`}
                  >
                    <option value="">Choose a model…</option>
                    {discovered.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <p
                    className={HELP_CLASS}
                    id={`${baseId}-discovered-help`}
                  >
                    This is the list of ids the endpoint returned. It does
                    not say which of them can read images or call tools —
                    only the endpoint's documentation can. You can also
                    type a name below.
                  </p>
                </div>
              )}

              <Input
                id={`${baseId}-wire-model`}
                className={FIELD_CLASS}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  settings.provider === "azure"
                    ? "your-deployment-name"
                    : "your-model-id"
                }
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

              {customId && (
                <p
                  data-testid="byok-custom-entry-note"
                  className="mt-2 rounded-md border border-gray-200 p-2 text-xs leading-5 text-gray-600 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Models will show one option for this connection:{" "}
                  <span className="font-medium notranslate" translate="no">
                    {settings.wireModel} via {settings.provider}
                  </span>
                  . The catalog models are replaced, because this endpoint
                  serves its own model and listing shot2code's catalog names
                  for it would be untrue. No thinking level is sent for it.
                </p>
              )}

              <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-zinc-400">
                Whichever model you choose, it has to accept the{" "}
                {BYOK_WIRE_API_LABELS[effectiveWireApi(settings)]} this
                connection uses and support image input and tool calling.
                Screenshots are sent as images and the agent works by calling
                tools, so a text-only model will fail — and neither this check
                nor the endpoint's model list can tell you which models
                qualify. Check the endpoint's own documentation.
              </p>
            </div>

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
                      How requests are shaped. Automatic picks Chat Completions
                      for an endpoint with its own base URL — the interface
                      almost every OpenAI-compatible server implements — and
                      Responses for a provider's own endpoint. Pin one only if
                      your endpoint needs it.
                    </p>
                    <select
                      id={`${baseId}-wire-api`}
                      data-testid="byok-wire-api"
                      className={SELECT_CLASS}
                      value={settings.wireApi ?? ""}
                      aria-describedby={`${baseId}-wire-help ${baseId}-wire-effective`}
                      onChange={(event) =>
                        update({
                          wireApi: event.target.value
                            ? (event.target.value as ByokWireApi)
                            : null,
                        })
                      }
                    >
                      <option value="">{BYOK_WIRE_API_AUTOMATIC_LABEL}</option>
                      {BYOK_WIRE_APIS.map((value) => (
                        <option key={value} value={value}>
                          {BYOK_WIRE_API_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    <p
                      className={HELP_CLASS}
                      id={`${baseId}-wire-effective`}
                      data-testid="byok-wire-api-effective"
                    >
                      This connection will use{" "}
                      <span className="font-medium">
                        {describeWireApiChoice(settings)}
                      </span>
                      .
                    </p>
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

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runValidation()}
                  disabled={isValidating}
                  data-testid="byok-validate"
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

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runLiveTest()}
                  disabled={isTesting}
                  data-testid="byok-test-model-access"
                  aria-describedby={`${baseId}-live-help`}
                  className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {isTesting ? (
                    <LuLoader
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                    />
                  ) : (
                    <LuZap aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                  Test model access
                </button>
                <span
                  id={`${baseId}-live-help`}
                  className="text-xs text-gray-500 dark:text-zinc-400"
                >
                  Contacts {describeByokEndpoint(settings)} with one tiny
                  request and may use a small amount of quota.
                  {liveTestTarget
                    ? ` Tests ${liveTestTarget}.`
                    : " Tests the first model this connection offers."}
                </span>
              </div>
            </div>

            <div aria-live="polite">
              {livePresentation && (
                <div
                  data-testid="byok-live-result"
                  data-tone={livePresentation.tone}
                  role={livePresentation.tone === "ready" ? undefined : "alert"}
                  className={`flex items-start gap-1.5 rounded-md border p-2 text-xs leading-5 ${
                    livePresentation.tone === "ready"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                      : livePresentation.tone === "billing" ||
                          livePresentation.tone === "quota" ||
                          livePresentation.tone === "config"
                        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100"
                        : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                  }`}
                >
                  {livePresentation.tone === "ready" ? (
                    <LuCheck
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                  ) : livePresentation.tone === "billing" ? (
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
                      {livePresentation.headline}
                    </span>
                    {livePresentation.detail && (
                      <> — {livePresentation.detail}</>
                    )}
                    {livePresentation.guidance && (
                      <span className="mt-1 block">
                        {livePresentation.guidance}
                      </span>
                    )}
                    {liveResult?.modelId && (
                      <span className="mt-1 block opacity-80">
                        Tested with {liveResult.modelId}.
                      </span>
                    )}
                    {livePresentation.actionUrl &&
                      livePresentation.actionLabel && (
                        <a
                          href={livePresentation.actionUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                        >
                          {livePresentation.actionLabel}
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
