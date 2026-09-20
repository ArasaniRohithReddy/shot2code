/**
 * The Copilot SDK "bring your own key" connection.
 *
 * One connection - an endpoint, a dedicated credential and a provider type -
 * which the backend turns into one *selectable run identity per base model*:
 *
 *     sdk-byok/<provider>/<base model id>
 *
 * No `Llm` value starts with that prefix, so a BYOK identity can never collide
 * with a direct model id. That is what lets a direct model and the BYOK variant
 * of the *same* base model sit in one run as two separate variants. A native
 * selection always uses the native provider, even while BYOK is switched on, so
 * nothing is ever silently re-routed and there is nothing to warn about.
 *
 * This connection is additive. It never reads, replaces or falls back to the
 * OpenAI / Anthropic / Gemini / Replicate credentials; those keep working on
 * their own providers untouched.
 *
 * No I/O lives here, and nothing in this module logs or formats a credential.
 */

import { containsControlCharacters } from "./utils";

export type ByokProvider = "openai" | "azure" | "anthropic";
export type ByokWireApi = "responses" | "completions";

/** How one variant is executed. Carried per selection, never per provider. */
export type ModelRuntime = "native" | "copilot-byok";

/** The shot2code provider whose models a BYOK provider type can serve. */
export type ByokBaseProvider = "openai" | "anthropic";

export const BYOK_PROVIDERS: ByokProvider[] = ["openai", "azure", "anthropic"];
export const BYOK_WIRE_APIS: ByokWireApi[] = ["responses", "completions"];
export const MODEL_RUNTIMES: ModelRuntime[] = ["native", "copilot-byok"];

/** Mirrors `BYOK_SELECTION_PREFIX` in backend/integrations/config.py. */
export const BYOK_SELECTION_PREFIX = "sdk-byok/";

/** All mirrored from backend/integrations/config.py. */
export const MAX_MODEL_SELECTIONS = 16;
export const BYOK_MAX_VALUE_LENGTH = 4096;
export const BYOK_MAX_URL_LENGTH = 2048;
export const BYOK_MAX_NAME_LENGTH = 64;

/** Azure serves OpenAI deployments, so both map onto the OpenAI catalog. */
export const BYOK_BASE_PROVIDERS: Record<ByokProvider, ByokBaseProvider> = {
  openai: "openai",
  azure: "openai",
  anthropic: "anthropic",
};

export interface CopilotSdkByokSettings {
  enabled: boolean;
  provider: ByokProvider;
  baseUrl: string | null;
  /** Dedicated to this connection. Never one of the direct provider keys. */
  apiKey: string | null;
  bearerToken: string | null;
  wireApi: ByokWireApi;
  /** What the endpoint calls the model, when it differs from the base model. */
  wireModel: string | null;
  azureApiVersion: string | null;
}

export const DEFAULT_COPILOT_SDK_BYOK_SETTINGS: CopilotSdkByokSettings = {
  enabled: false,
  provider: "openai",
  baseUrl: null,
  apiKey: null,
  bearerToken: null,
  wireApi: "responses",
  wireModel: null,
  azureApiVersion: null,
};

export const BYOK_PROVIDER_LABELS: Record<ByokProvider, string> = {
  openai: "OpenAI-compatible",
  azure: "Azure OpenAI",
  anthropic: "Anthropic",
};

export const BYOK_WIRE_API_LABELS: Record<ByokWireApi, string> = {
  responses: "Responses API",
  completions: "Chat Completions API",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, limit) : null;
}

/**
 * Bring a stored (or absent) blob onto the current shape.
 *
 * `usePersistedState` only fills in *top level* defaults, so a blob saved by an
 * earlier build can be missing nested fields. Nothing is migrated from another
 * credential: an unknown value falls back to this module's default.
 */
export function normalizeCopilotSdkByokSettings(
  raw: unknown
): CopilotSdkByokSettings {
  if (!isPlainObject(raw)) return { ...DEFAULT_COPILOT_SDK_BYOK_SETTINGS };

  const provider = BYOK_PROVIDERS.includes(raw.provider as ByokProvider)
    ? (raw.provider as ByokProvider)
    : DEFAULT_COPILOT_SDK_BYOK_SETTINGS.provider;
  const wireApi = BYOK_WIRE_APIS.includes(raw.wireApi as ByokWireApi)
    ? (raw.wireApi as ByokWireApi)
    : DEFAULT_COPILOT_SDK_BYOK_SETTINGS.wireApi;

  return {
    enabled: raw.enabled === true,
    provider,
    baseUrl: cleanText(raw.baseUrl, BYOK_MAX_URL_LENGTH),
    apiKey: cleanText(raw.apiKey, BYOK_MAX_VALUE_LENGTH),
    bearerToken: cleanText(raw.bearerToken, BYOK_MAX_VALUE_LENGTH),
    wireApi,
    wireModel: cleanText(raw.wireModel, BYOK_MAX_NAME_LENGTH),
    // Only Azure accepts an api-version; the backend refuses it elsewhere.
    azureApiVersion:
      provider === "azure"
        ? cleanText(raw.azureApiVersion, BYOK_MAX_NAME_LENGTH)
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Run identities                                                              */
/* -------------------------------------------------------------------------- */

export interface ByokSelectionId {
  provider: ByokProvider;
  baseModelId: string;
}

/** `sdk-byok/azure/gpt-5.5 (high thinking)` for one base model. */
export function byokSelectionId(
  provider: ByokProvider,
  baseModelId: string
): string {
  return `${BYOK_SELECTION_PREFIX}${provider}/${baseModelId}`;
}

export function isByokSelectionId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(BYOK_SELECTION_PREFIX);
}

/** Split a BYOK run identity, or null when it is not one. */
export function parseByokSelectionId(value: string): ByokSelectionId | null {
  if (!isByokSelectionId(value)) return null;
  const remainder = value.slice(BYOK_SELECTION_PREFIX.length);
  const separator = remainder.indexOf("/");
  if (separator <= 0) return null;
  const provider = remainder.slice(0, separator);
  const baseModelId = remainder.slice(separator + 1);
  if (!baseModelId) return null;
  if (!BYOK_PROVIDERS.includes(provider as ByokProvider)) return null;
  return { provider: provider as ByokProvider, baseModelId };
}

/** The runtime a selected id addresses. */
export function runtimeOfSelectionId(value: string): ModelRuntime {
  return isByokSelectionId(value) ? "copilot-byok" : "native";
}

/**
 * The base model behind a selected id.
 *
 * A native id *is* its base model; a BYOK id carries it after the provider.
 * Returns null only for a BYOK id the browser cannot parse.
 */
export function baseModelOfSelectionId(value: string): string | null {
  const parsed = parseByokSelectionId(value);
  if (parsed) return parsed.baseModelId;
  return isByokSelectionId(value) ? null : value;
}

export function byokBaseProvider(provider: ByokProvider): ByokBaseProvider {
  return BYOK_BASE_PROVIDERS[provider];
}

/* -------------------------------------------------------------------------- */
/* Usability                                                                   */
/* -------------------------------------------------------------------------- */

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

export function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export function hasByokCredential(settings: CopilotSdkByokSettings): boolean {
  return Boolean(settings.apiKey || settings.bearerToken);
}

/**
 * Why this connection cannot run, in the words the user will see.
 *
 * Mirrors `ByokConnection.unusable_reason`. A dedicated credential is always
 * required except for an OpenAI-compatible server on this machine: shot2code
 * will not spend the direct OpenAI or Anthropic key on someone's own endpoint.
 */
export function byokUnusableReason(
  settings: CopilotSdkByokSettings
): string | null {
  if (!settings.enabled) return "switched off";
  if (settings.provider === "azure") {
    if (!settings.baseUrl) {
      return "needs the endpoint URL of your Azure OpenAI resource";
    }
    if (!hasByokCredential(settings)) {
      return "needs its own API key or bearer token";
    }
    return null;
  }
  if (settings.provider === "anthropic") {
    if (!hasByokCredential(settings)) {
      return "needs its own API key or bearer token";
    }
    return null;
  }
  if (!hasByokCredential(settings) && !isLoopbackHost(hostOf(settings.baseUrl))) {
    return "needs its own API key unless it points at localhost";
  }
  return null;
}

export function isByokUsable(settings: CopilotSdkByokSettings): boolean {
  return byokUnusableReason(settings) === null;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export type ByokField =
  | "baseUrl"
  | "apiKey"
  | "bearerToken"
  | "wireModel"
  | "azureApiVersion";

export type ByokValidationErrors = Partial<Record<ByokField, string>>;

function endpointError(url: string, label: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${label} must be a full http:// or https:// URL.`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `${label} must be an http:// or https:// URL.`;
  }
  if (parsed.username || parsed.password) {
    return `${label} must not embed a username or password.`;
  }
  if (!parsed.hostname) return `${label} must include a host name.`;
  if (
    parsed.protocol === "http:" &&
    !isLoopbackHost(parsed.hostname.toLowerCase())
  ) {
    return `${label} must use https:// unless it points at localhost.`;
  }
  return null;
}

/** Field-level problems, phrased for the person who typed them. */
export function validateByokSettings(
  settings: CopilotSdkByokSettings
): ByokValidationErrors {
  const errors: ByokValidationErrors = {};
  if (!settings.enabled) return errors;

  if (settings.baseUrl) {
    const message = endpointError(settings.baseUrl, "Base URL");
    if (message) errors.baseUrl = message;
  } else if (settings.provider === "azure") {
    errors.baseUrl =
      "Azure OpenAI needs the endpoint URL of your Azure OpenAI resource.";
  }

  for (const field of ["apiKey", "bearerToken", "wireModel"] as const) {
    const value = settings[field];
    if (value && containsControlCharacters(value)) {
      errors[field] = "This value contains characters that are not allowed.";
    }
  }

  if (
    !hasByokCredential(settings) &&
    !(settings.provider === "openai" && isLoopbackHost(hostOf(settings.baseUrl)))
  ) {
    errors.apiKey =
      settings.provider === "openai"
        ? "Add a dedicated API key, or point the base URL at localhost for a local server."
        : "Add a dedicated API key or bearer token for this connection.";
  }

  if (settings.azureApiVersion && settings.provider !== "azure") {
    errors.azureApiVersion =
      "An API version only applies to the Azure OpenAI provider.";
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Wire payload                                                                */
/* -------------------------------------------------------------------------- */

export interface CopilotSdkByokWirePayload {
  enabled: boolean;
  provider: ByokProvider;
  wireApi: ByokWireApi;
  baseUrl?: string;
  apiKey?: string;
  bearerToken?: string;
  wireModel?: string;
  azureApiVersion?: string;
}

/**
 * The block the backend takes.
 *
 * It describes the connection as configured, on every request. Which runtime a
 * variant uses is decided per selection id, not by this block, so sending it
 * never re-routes a native pick.
 *
 * `includeSecrets: false` produces the same shape with the credentials
 * removed, which is what a snapshot or a dependency key may hold.
 */
export function toByokWirePayload(
  settings: CopilotSdkByokSettings,
  options: { includeSecrets?: boolean } = {}
): CopilotSdkByokWirePayload {
  const includeSecrets = options.includeSecrets !== false;
  const payload: CopilotSdkByokWirePayload = {
    enabled: settings.enabled,
    provider: settings.provider,
    wireApi: settings.wireApi,
  };
  if (settings.baseUrl) payload.baseUrl = settings.baseUrl;
  if (includeSecrets && settings.apiKey) payload.apiKey = settings.apiKey;
  if (includeSecrets && settings.bearerToken) {
    payload.bearerToken = settings.bearerToken;
  }
  if (settings.wireModel) payload.wireModel = settings.wireModel;
  if (settings.provider === "azure" && settings.azureApiVersion) {
    payload.azureApiVersion = settings.azureApiVersion;
  }
  return payload;
}

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

/** A one-line summary of where a BYOK run goes. Never includes a key. */
export function describeByokEndpoint(settings: CopilotSdkByokSettings): string {
  const provider = BYOK_PROVIDER_LABELS[settings.provider];
  const host = hostOf(settings.baseUrl);
  const where =
    host ||
    (settings.provider === "azure"
      ? "your resource"
      : "the provider default endpoint");
  const wire = BYOK_WIRE_API_LABELS[settings.wireApi];
  const model = settings.wireModel ? ` as ${settings.wireModel}` : "";
  return `${provider} · ${where} · ${wire}${model}`;
}
