import { HTTP_BACKEND_URL } from "../config";
import {
  MAX_DISCOVERED_MODELS,
  isValidWireModel,
  toByokWirePayload,
  type CopilotSdkByokSettings,
} from "./copilot-sdk-byok";
import type { CatalogModel, ModelCatalog, ProviderId } from "./model-selection";

/**
 * Live "can this credential actually reach the provider" checks.
 *
 * `/api/integrations/validate` answers a structural question and contacts
 * nothing. This is the opposite: the backend makes one minimal, potentially
 * billable request so a key that is malformed, revoked, out of credit or
 * pointed at a model the account cannot see fails here rather than halfway
 * through a generation.
 *
 * The payload is built per provider and deliberately carries *only* the
 * credential being tested. Testing Gemini must never put the OpenAI key on the
 * wire, so `buildProviderValidationPayload` reads one field per provider and
 * there is no "send everything" path.
 */

export const PROVIDER_CHECK_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "replicate",
  "copilot-byok",
] as const;

export type ProviderCheckId = (typeof PROVIDER_CHECK_IDS)[number];

/** Native providers get an inline Test in the API Keys card. */
export const NATIVE_PROVIDER_CHECKS = [
  "openai",
  "anthropic",
  "gemini",
  "replicate",
] as const;

export type NativeProviderCheckId = (typeof NATIVE_PROVIDER_CHECKS)[number];

export const PROVIDER_CHECK_LABELS: Record<ProviderCheckId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  replicate: "Replicate",
  "copilot-byok": "Copilot SDK BYOK",
};

export interface ProviderCheckResult {
  provider: ProviderCheckId;
  ok: boolean;
  /** Backend-defined bucket. Unknown values fall back to its message. */
  category: string;
  message: string;
  /** The model the backend actually exercised, when it named one. */
  modelId: string | null;
  /**
   * Model ids the endpoint reported at `/models`, when it could be asked.
   *
   * Only an OpenAI-compatible connection exposes that route, so Azure and
   * Anthropic always come back empty and the model name is set by hand. These
   * are ids only: they say what the endpoint *serves*, never whether any of
   * them can see images or call tools.
   */
  models: string[];
}

/* -------------------------------------------------------------------------- */
/* Request                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProviderValidationRequest {
  provider: ProviderCheckId;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  copilotSdkByok?: ReturnType<typeof toByokWirePayload>;
}

export interface ProviderCredentialSlice {
  openAiApiKey?: string | null;
  openAiBaseURL?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
  replicateApiKey?: string | null;
}

function trimmed(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

/**
 * The single credential field each provider is allowed to read.
 *
 * Keeping this as a lookup rather than an inline conditional is what makes
 * "never send an unrelated key" checkable: there is exactly one reader per
 * provider and a test asserts each one ignores the others.
 */
const CREDENTIAL_READERS: Record<
  NativeProviderCheckId,
  (settings: ProviderCredentialSlice) => string | null
> = {
  openai: (s) => trimmed(s.openAiApiKey),
  anthropic: (s) => trimmed(s.anthropicApiKey),
  gemini: (s) => trimmed(s.geminiApiKey),
  replicate: (s) => trimmed(s.replicateApiKey),
};

export function isNativeProviderCheck(
  provider: ProviderCheckId
): provider is NativeProviderCheckId {
  return provider !== "copilot-byok";
}

export function buildProviderValidationPayload(
  provider: ProviderCheckId,
  options: {
    settings?: ProviderCredentialSlice;
    copilotSdkByok?: CopilotSdkByokSettings;
    modelId?: string | null;
  } = {}
): ProviderValidationRequest {
  const modelId = trimmed(options.modelId);
  const payload: ProviderValidationRequest = { provider };
  if (modelId) payload.modelId = modelId;

  if (provider === "copilot-byok") {
    if (options.copilotSdkByok) {
      payload.copilotSdkByok = toByokWirePayload(options.copilotSdkByok);
    }
    return payload;
  }

  const settings = options.settings ?? {};
  const apiKey = CREDENTIAL_READERS[provider](settings);
  // An absent key is not an error: the backend may hold one in its own .env,
  // and omitting the field is how we ask it to use that instead of asserting
  // there is no key at all.
  if (apiKey) payload.apiKey = apiKey;
  // The base URL only means anything for OpenAI-compatible traffic.
  if (provider === "openai") {
    const baseUrl = trimmed(settings.openAiBaseURL);
    if (baseUrl) payload.baseUrl = baseUrl;
  }
  return payload;
}

/* -------------------------------------------------------------------------- */
/* Response                                                                    */
/* -------------------------------------------------------------------------- */

export function parseProviderValidation(
  raw: unknown,
  requested: ProviderCheckId
): ProviderCheckResult {
  const payload =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const provider = PROVIDER_CHECK_IDS.includes(
    payload.provider as ProviderCheckId
  )
    ? (payload.provider as ProviderCheckId)
    : requested;
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  const modelId =
    typeof payload.modelId === "string" && payload.modelId.trim().length > 0
      ? payload.modelId.trim()
      : null;

  return {
    provider,
    ok: payload.ok === true,
    category:
      typeof payload.category === "string" && payload.category.length > 0
        ? payload.category
        : payload.ok === true
          ? "ready"
          : "unknown",
    message,
    modelId,
    models: parseDiscoveredModels(payload.models),
  };
}

/**
 * Take the discovered model list, bounded and de-duplicated.
 *
 * The endpoint is not shot2code's to trust: the list is filtered to names the
 * backend would actually accept as a wire model, capped at the same limit the
 * backend caps discovery to, and stripped of duplicates. A hostile or broken
 * `/models` response therefore cannot grow the picker without bound or smuggle
 * an unusable name into a selection id.
 */
export function parseDiscoveredModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const candidate = entry.trim();
    if (!isValidWireModel(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    models.push(candidate);
    if (models.length >= MAX_DISCOVERED_MODELS) break;
  }
  return models;
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

export type ProviderCheckTone =
  | "ready"
  | "billing"
  | "quota"
  | "auth"
  | "config"
  | "network"
  | "error";

export interface ProviderCheckPresentation {
  tone: ProviderCheckTone;
  headline: string;
  /** Always the backend's own wording when it sent any. */
  detail: string;
  /** Extra guidance this frontend can add without inventing a diagnosis. */
  guidance: string | null;
  actionLabel: string | null;
  actionUrl: string | null;
}

/**
 * The backend normalises every provider's failure into one of these.
 *
 * `provider_errors.ErrorCategory` is the source of truth; the extra aliases
 * below are the raw provider codes, kept so a category that reaches the UI
 * unnormalised still lands in the right bucket instead of "unknown".
 *
 * `billing` and `quota` are deliberately separate. An OpenAI account with no
 * credit answers `insufficient_quota`, which reads like a rate limit but is
 * not one: waiting never fixes it. The backend files that under `billing`, and
 * showing it as a generic failure sends people to re-check a key that was
 * always fine - so it gets its own tone and a link straight to billing.
 */
const BILLING_CATEGORIES = new Set([
  "billing",
  "insufficient_quota",
  "insufficient-quota",
  "billing_required",
  "no_credit",
  "no_credits",
  "zero_credit",
  "payment_required",
]);

/** Temporary: the account can pay, but not right now. */
const QUOTA_CATEGORIES = new Set([
  "quota",
  "rate_limit",
  "rate_limited",
  "overloaded",
  "resource_exhausted",
  "busy",
]);

const AUTH_CATEGORIES = new Set([
  "credentials",
  "invalid_key",
  "invalid-key",
  "invalid_api_key",
  "unauthorized",
  "unauthenticated",
  "auth",
  "authentication",
  "expired",
]);

const CONFIG_CATEGORIES = new Set([
  "configuration",
  "model",
  "permissions",
  "forbidden",
  "missing_key",
  "not_configured",
  "no_credential",
  "model_unavailable",
  "model_not_found",
  "unsupported_model",
  "invalid_base_url",
  "invalid_config",
  "config",
]);

const NETWORK_CATEGORIES = new Set([
  "network",
  "timeout",
  "unreachable",
  "connection",
  "dns",
]);

/** Where each provider's spend is managed. https only, and stable pages. */
const BILLING_URLS: Partial<Record<ProviderCheckId, string>> = {
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  anthropic: "https://console.anthropic.com/settings/billing",
  replicate: "https://replicate.com/account/billing",
  gemini: "https://aistudio.google.com/app/plan_information",
};

export function providerCheckTone(category: string): ProviderCheckTone {
  const key = category.toLowerCase();
  if (key === "ready" || key === "ok" || key === "success") return "ready";
  if (BILLING_CATEGORIES.has(key)) return "billing";
  if (QUOTA_CATEGORIES.has(key)) return "quota";
  if (AUTH_CATEGORIES.has(key)) return "auth";
  if (CONFIG_CATEGORIES.has(key)) return "config";
  if (NETWORK_CATEGORIES.has(key)) return "network";
  return "error";
}

const TONE_HEADLINES: Record<ProviderCheckTone, string> = {
  ready: "Ready",
  billing: "Out of credit",
  quota: "Rate limited",
  auth: "Key rejected",
  config: "Configuration problem",
  network: "Could not reach the provider",
  error: "Check failed",
};

/** Sharper wording for the categories the backend actually emits. */
const CATEGORY_HEADLINES: Record<string, string> = {
  permissions: "Access denied",
  model: "Model unavailable",
};

export function describeProviderCheck(
  result: ProviderCheckResult
): ProviderCheckPresentation {
  const tone = result.ok ? "ready" : providerCheckTone(result.category);
  const label = PROVIDER_CHECK_LABELS[result.provider];
  const billingUrl = BILLING_URLS[result.provider] ?? null;
  const headline = result.ok
    ? TONE_HEADLINES.ready
    : (CATEGORY_HEADLINES[result.category.toLowerCase()] ??
      TONE_HEADLINES[tone]);

  let guidance: string | null = null;
  if (tone === "billing") {
    guidance = `The key works, but the ${label} account has no credit left for this request. Add credit or a payment method, then test again.`;
  } else if (tone === "quota") {
    guidance =
      "This is temporary. Wait for the limit to reset, or generate fewer options at once.";
  } else if (tone === "auth") {
    guidance = `Check the ${label} key for a typo, or issue a new one and paste it above.`;
  } else if (tone === "network") {
    guidance = "This looks temporary. Try again in a moment.";
  }

  return {
    tone,
    headline,
    detail:
      result.message ||
      (result.ok
        ? `${label} answered a test request.`
        : `${label} did not accept the test request.`),
    guidance,
    actionLabel: tone === "billing" && billingUrl ? "Open billing" : null,
    actionUrl: tone === "billing" ? billingUrl : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Choosing what to test                                                       */
/* -------------------------------------------------------------------------- */

const CATALOG_PROVIDER_OF: Record<NativeProviderCheckId, ProviderId | null> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  // Replicate is an image backend, not a catalog entry; the backend picks.
  replicate: null,
};

/**
 * A model to exercise, preferring one the user actually selected.
 *
 * Testing the model that will really run catches "your account cannot see this
 * model" - by far the most common surprise once a key is valid. When nothing
 * of that provider is selected the field is omitted and the backend chooses,
 * which keeps the check cheap rather than guessing at an expensive model.
 */
export function nativeModelForProviderCheck(
  provider: NativeProviderCheckId,
  catalog: ModelCatalog,
  selectedModels: readonly string[]
): string | null {
  const providerId = CATALOG_PROVIDER_OF[provider];
  if (!providerId) return null;
  const group = catalog.providers.find((entry) => entry.id === providerId);
  if (!group) return null;

  const isUsable = (model: CatalogModel) =>
    model.runtime === "native" && model.status !== "deprecated";

  const selected = selectedModels.find((id) =>
    group.models.some((model) => model.id === id && isUsable(model))
  );
  if (selected) return selected;

  const recommended = group.models.find(
    (model) => isUsable(model) && model.recommended
  );
  return recommended?.id ?? group.models.find(isUsable)?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Request                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A backend without this route predates live checks; say so plainly rather
 * than reporting the provider itself as broken.
 */
const MISSING_ROUTE_MESSAGE =
  "This backend does not offer connection checks yet. Start a generation to find out whether the credential works.";

export async function validateProvider(
  request: ProviderValidationRequest,
  options: { signal?: AbortSignal } = {}
): Promise<ProviderCheckResult> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/providers/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify(request),
  });

  if (response.status === 404 || response.status === 405) {
    return {
      provider: request.provider,
      ok: false,
      category: "unsupported_backend",
      message: MISSING_ROUTE_MESSAGE,
      modelId: null,
      models: [],
    };
  }

  const body = await response.json().catch(() => null);
  if (body !== null) return parseProviderValidation(body, request.provider);
  if (!response.ok) {
    throw new Error(`The check could not be run (${response.status})`);
  }
  throw new Error("The check returned an unreadable response.");
}
