/**
 * The provider-neutral web search a user configures in Settings.
 *
 * shot2code owns one canonical `search_web` tool, so every runtime - native
 * OpenAI, Anthropic and Gemini, a Copilot subscription session, and a Copilot
 * SDK BYOK session - reaches the same implementation with the same budgets and
 * the same bounded response. That is the whole reason this is separate from
 * Copilot's built-in `web_search`, which only exists inside SDK sessions.
 *
 * The limits here mirror `backend/web_search/config.py` so the UI can say
 * "that will be refused" before a generation does.
 *
 * `apiKey` is a credential. It is read from Settings at send time, travels on
 * the request, and is excluded from every wire payload that gets written down
 * (`toWebSearchWirePayload(..., { includeSecrets: false })`).
 */

import { containsControlCharacters } from "./utils";

export const WEB_SEARCH_TOOL_NAME = "search_web";
export const READ_WEB_PAGE_TOOL_NAME = "read_web_page";

export type WebSearchProvider = "tavily" | "exa";
/**
 * How the provider is reached.
 *
 * `keyless` is Tavily's documented, rate-limited trial mode. It is a separate
 * explicit choice, never a silent fallback when a key is missing: a query
 * leaving this machine should always be something the user asked for.
 */
export type WebSearchAccessMode = "api-key" | "keyless";

export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = ["tavily", "exa"];
export const WEB_SEARCH_ACCESS_MODES: WebSearchAccessMode[] = [
  "api-key",
  "keyless",
];

/** Only Tavily documents a keyless trial. */
export const KEYLESS_PROVIDERS: WebSearchProvider[] = ["tavily"];

/** All mirrored from backend/web_search/config.py. */
export const WEB_SEARCH_MAX_RESULTS = 5;
export const WEB_SEARCH_MAX_INCLUDE_DOMAINS = 10;
export const WEB_SEARCH_MAX_TITLE_CHARS = 160;
export const WEB_SEARCH_MAX_SNIPPET_CHARS = 600;
export const WEB_SEARCH_MAX_TOTAL_CHARS = 4000;
export const WEB_SEARCH_MAX_PER_TURN = 3;
export const WEB_SEARCH_MAX_PER_GENERATION = 10;
export const WEB_SEARCH_MAX_API_KEY_LENGTH = 256;
export const WEB_SEARCH_TIMEOUT_SECONDS = 12;
export const PAGE_FETCH_MAX_BYTES = 512 * 1024;
export const PAGE_FETCH_MAX_TEXT_CHARS = 16_000;
export const PAGE_FETCH_MAX_PER_TURN = 2;
export const PAGE_FETCH_MAX_PER_GENERATION = 5;
export const PAGE_FETCH_TIMEOUT_SECONDS = 12;

export interface WebSearchProviderInfo {
  id: WebSearchProvider;
  label: string;
  /** The single fixed endpoint every query for this provider goes to. */
  endpoint: string;
  /** Where a key is created, so the UI never has to guess a URL. */
  signupUrl: string;
  /** The provider's own pricing page, so a claim here can be checked. */
  pricingUrl: string;
  supportsKeyless: boolean;
  /**
   * What the provider's *published* terms say, quoted plainly and scoped.
   *
   * Never write "free" unqualified. An allowance belongs to the provider's
   * account, is set by them and can change or run out, so every string here
   * attributes it, scopes it (per month / per day) and is paired with
   * `ALLOWANCE_CAVEAT`. shot2code promises nothing about somebody else's
   * billing.
   */
  freeTier: string;
}

/**
 * Appended wherever an allowance is shown.
 *
 * The user pays this bill, not shot2code, and a provider can change its plan
 * the day after we ship. Saying so once, everywhere, is cheaper than a support
 * thread about a quota that moved.
 */
export const ALLOWANCE_CAVEAT =
  "This allowance is set by the provider, depends on your account, and can " +
  "change at any time - check their pricing page before relying on it.";

export const WEB_SEARCH_PROVIDER_INFO: Record<
  WebSearchProvider,
  WebSearchProviderInfo
> = {
  tavily: {
    id: "tavily",
    label: "Tavily",
    endpoint: "https://api.tavily.com/search",
    signupUrl: "https://app.tavily.com",
    pricingUrl: "https://docs.tavily.com/documentation/api-credits",
    supportsKeyless: true,
    freeTier:
      "Tavily's published plan includes 1,000 API credits a month, reset on " +
      "the first of each month, with no credit card required. A basic search " +
      "costs one credit; shot2code never requests the two-credit advanced " +
      "mode. Tavily also documents a keyless trial that needs no account at " +
      "all, rate-limited and shared with every other keyless user.",
  },
  exa: {
    id: "exa",
    label: "Exa",
    endpoint: "https://api.exa.ai/search",
    signupUrl: "https://dashboard.exa.ai/api-keys",
    pricingUrl: "https://exa.ai/docs/admin/pricing",
    supportsKeyless: false,
    freeTier:
      "Exa is pay-as-you-go with no subscription. Its published free tier " +
      "gives $10 of credits at sign-up and resets to $10 on the first of each " +
      "month, with no payment method required. Search is billed at $7 per " +
      "1,000 requests for up to 10 results, and shot2code asks for at most " +
      "five. Exa has no keyless mode, so an API key is required.",
  },
};

export interface WebSearchSettings {
  /** Off unless the user turned it on. Nothing is sent while this is false. */
  enabled: boolean;
  provider: WebSearchProvider;
  accessMode: WebSearchAccessMode;
  /** Backend-only credential. Never written to history or a snapshot. */
  apiKey: string | null;
  /** Separate opt-in for bounded full-page text. Search never implies this. */
  pageFetchEnabled: boolean;
}

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  enabled: false,
  provider: "tavily",
  accessMode: "api-key",
  apiKey: null,
  pageFetchEnabled: false,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProvider(raw: unknown): WebSearchProvider {
  if (typeof raw !== "string") return "tavily";
  const value = raw.trim().toLowerCase();
  return WEB_SEARCH_PROVIDERS.includes(value as WebSearchProvider)
    ? (value as WebSearchProvider)
    : "tavily";
}

function normalizeAccessMode(
  raw: unknown,
  provider: WebSearchProvider
): WebSearchAccessMode {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const mode = WEB_SEARCH_ACCESS_MODES.includes(value as WebSearchAccessMode)
    ? (value as WebSearchAccessMode)
    : "api-key";
  // A provider with no keyless mode can never be left in one, however the
  // blob was saved or hand-edited.
  return mode === "keyless" && !supportsKeyless(provider) ? "api-key" : mode;
}

export function supportsKeyless(provider: WebSearchProvider): boolean {
  return KEYLESS_PROVIDERS.includes(provider);
}

/** Mirrors the backend: no whitespace, no control characters, bounded. */
export function isValidWebSearchApiKey(value: string): boolean {
  const key = value.trim();
  if (!key || key.length > WEB_SEARCH_MAX_API_KEY_LENGTH) return false;
  if (containsControlCharacters(key)) return false;
  return !/\s/.test(key);
}

export function normalizeWebSearchSettings(raw: unknown): WebSearchSettings {
  if (!isPlainObject(raw)) return { ...DEFAULT_WEB_SEARCH_SETTINGS };
  const provider = normalizeProvider(raw.provider);
  const accessMode = normalizeAccessMode(raw.accessMode, provider);
  const rawKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  return {
    enabled: raw.enabled === true,
    provider,
    accessMode,
    // Keyless deliberately forgets any saved key, so a request cannot end up
    // keyed after the user asked for the trial.
    apiKey:
      accessMode === "keyless" || !rawKey
        ? null
        : rawKey.slice(0, WEB_SEARCH_MAX_API_KEY_LENGTH),
    pageFetchEnabled: raw.pageFetchEnabled === true,
  };
}

/** Why this configuration cannot run a search, or null when it can. */
export function webSearchBlockedReason(
  settings: WebSearchSettings
): string | null {
  if (!settings.enabled) return "Web search is switched off.";
  const info = WEB_SEARCH_PROVIDER_INFO[settings.provider];
  if (settings.accessMode === "keyless") {
    return info.supportsKeyless
      ? null
      : `${info.label} has no keyless mode. Add an API key or choose Tavily.`;
  }
  if (!settings.apiKey) {
    return `${info.label} needs an API key before it can search.`;
  }
  if (!isValidWebSearchApiKey(settings.apiKey)) {
    return `That ${info.label} key contains characters that are not allowed.`;
  }
  return null;
}

export function isWebSearchUsable(settings: WebSearchSettings): boolean {
  return webSearchBlockedReason(settings) === null;
}

export interface WebSearchWirePayload {
  enabled: boolean;
  provider: WebSearchProvider;
  accessMode: WebSearchAccessMode;
  pageFetchEnabled: boolean;
  apiKey?: string;
}

/**
 * The block a request carries.
 *
 * With `includeSecrets: false` the key is dropped entirely rather than blanked,
 * so a snapshot records *that* a provider was configured without hinting at
 * the credential's existence or length.
 */
export function toWebSearchWirePayload(
  settings: WebSearchSettings,
  options: { includeSecrets?: boolean } = {}
): WebSearchWirePayload {
  const includeSecrets = options.includeSecrets !== false;
  const payload: WebSearchWirePayload = {
    enabled: settings.enabled,
    provider: settings.provider,
    accessMode: settings.accessMode,
    pageFetchEnabled: settings.pageFetchEnabled,
  };
  if (
    includeSecrets &&
    settings.accessMode !== "keyless" &&
    settings.apiKey &&
    isValidWebSearchApiKey(settings.apiKey)
  ) {
    payload.apiKey = settings.apiKey.trim();
  }
  return payload;
}

/** The backend's secret-free description of the same configuration. */
export interface WebSearchSummary {
  enabled: boolean;
  provider: string;
  providerLabel: string;
  accessMode: string;
  hasApiKey: boolean;
  endpoint: string;
  usable: boolean;
  reason: string | null;
  maxResults: number;
  maxSearchesPerTurn: number;
  maxSearchesPerGeneration: number;
  pageFetchEnabled: boolean;
  maxPageBytes: number;
  maxPageTextChars: number;
  maxPageFetchesPerTurn: number;
  maxPageFetchesPerGeneration: number;
}

export function parseWebSearchSummary(raw: unknown): WebSearchSummary | null {
  if (!isPlainObject(raw)) return null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const count = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    enabled: raw.enabled === true,
    provider: text(raw.provider),
    providerLabel: text(raw.providerLabel),
    accessMode: text(raw.accessMode),
    hasApiKey: raw.hasApiKey === true,
    endpoint: text(raw.endpoint),
    usable: raw.usable === true,
    reason: typeof raw.reason === "string" ? raw.reason : null,
    maxResults: count(raw.maxResults, WEB_SEARCH_MAX_RESULTS),
    maxSearchesPerTurn: count(raw.maxSearchesPerTurn, WEB_SEARCH_MAX_PER_TURN),
    maxSearchesPerGeneration: count(
      raw.maxSearchesPerGeneration,
      WEB_SEARCH_MAX_PER_GENERATION
    ),
    pageFetchEnabled: raw.pageFetchEnabled === true,
    maxPageBytes: count(raw.maxPageBytes, PAGE_FETCH_MAX_BYTES),
    maxPageTextChars: count(
      raw.maxPageTextChars,
      PAGE_FETCH_MAX_TEXT_CHARS
    ),
    maxPageFetchesPerTurn: count(
      raw.maxPageFetchesPerTurn,
      PAGE_FETCH_MAX_PER_TURN
    ),
    maxPageFetchesPerGeneration: count(
      raw.maxPageFetchesPerGeneration,
      PAGE_FETCH_MAX_PER_GENERATION
    ),
  };
}

export interface WebSearchTestResult {
  ok: boolean;
  error: string | null;
  errorCode: string | null;
  providerLabel: string | null;
  resultCount: number;
}

export function parseWebSearchTestResult(raw: unknown): WebSearchTestResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: "Unexpected response.",
      errorCode: null,
      providerLabel: null,
      resultCount: 0,
    };
  }
  return {
    ok: raw.ok === true,
    error: typeof raw.error === "string" ? raw.error : null,
    errorCode: typeof raw.errorCode === "string" ? raw.errorCode : null,
    providerLabel:
      typeof raw.providerLabel === "string" ? raw.providerLabel : null,
    resultCount: typeof raw.resultCount === "number" ? raw.resultCount : 0,
  };
}

/**
 * The one sentence Settings must show before anything is switched on.
 *
 * Query egress is the only genuinely irreversible part of this feature, so it
 * is stated first, names the provider, and is never hidden behind a tooltip.
 */
export function describeWebSearchEgress(settings: WebSearchSettings): string {
  const info = WEB_SEARCH_PROVIDER_INFO[settings.provider];
  const credential =
    settings.accessMode === "keyless"
      ? "no account is used, so requests share a rate limit with everyone else on the keyless trial"
      : "your API key is sent with each request";
  return (
    `Search queries written by the model leave this device and are sent to ` +
    `${info.label} at ${info.endpoint}; ${credential}. Your screenshots, ` +
    `prompt text and generated code are never sent. Only titles, links and ` +
    `short snippets come back - no page is fetched.`
  );
}

/** Which variants of a run can use `search_web`: all of them, by design. */
export function describeWebSearchScope(settings: WebSearchSettings): string {
  if (!settings.enabled) {
    return "Web search is off, so no model is offered the search_web tool.";
  }
  const blocked = webSearchBlockedReason(settings);
  if (blocked) return blocked;
  return (
    `Every selected model gets the search_web tool, including OpenAI, ` +
    `Anthropic, Gemini, GitHub Copilot and Copilot SDK BYOK options. Limits: ` +
    `${WEB_SEARCH_MAX_RESULTS} results per search, ` +
    `${WEB_SEARCH_MAX_PER_TURN} searches per turn and ` +
    `${WEB_SEARCH_MAX_PER_GENERATION} per generation.`
  );
}

/**
 * Whether Copilot's built-in `web_search` will be suppressed for this run.
 *
 * Two tools that do the same job under different rules is how a model ends up
 * taking the unbounded route, so the backend enables only one. Saying so in
 * the UI stops "I turned Copilot web search on and nothing changed".
 */
export function suppressesCopilotBuiltInSearch(
  settings: WebSearchSettings
): boolean {
  return isWebSearchUsable(settings);
}
