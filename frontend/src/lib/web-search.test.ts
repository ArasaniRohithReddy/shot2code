import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  ALLOWANCE_CAVEAT,
  PAGE_FETCH_MAX_BYTES,
  PAGE_FETCH_MAX_PER_GENERATION,
  PAGE_FETCH_MAX_PER_TURN,
  PAGE_FETCH_MAX_TEXT_CHARS,
  WEB_SEARCH_MAX_INCLUDE_DOMAINS,
  WEB_SEARCH_MAX_PER_GENERATION,
  WEB_SEARCH_MAX_PER_TURN,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_MAX_SNIPPET_CHARS,
  WEB_SEARCH_MAX_TITLE_CHARS,
  WEB_SEARCH_MAX_TOTAL_CHARS,
  WEB_SEARCH_PROVIDER_INFO,
  describeWebSearchEgress,
  describeWebSearchScope,
  isValidWebSearchApiKey,
  isWebSearchUsable,
  normalizeWebSearchSettings,
  parseWebSearchSummary,
  parseWebSearchTestResult,
  suppressesCopilotBuiltInSearch,
  supportsKeyless,
  toWebSearchWirePayload,
  webSearchBlockedReason,
  type WebSearchSettings,
} from "./web-search";
import {
  DEFAULT_INTEGRATION_SETTINGS,
  buildGenerationIntegrationPayload,
  buildIntegrationWirePayload,
  needsIntegrationNormalization,
  stripIntegrationSecrets,
  webSearchRuntimeScope,
  withIntegrationDefaults,
  type IntegrationSettingsSlice,
} from "./integrations";
import { DEFAULT_COPILOT_SDK_BYOK_SETTINGS } from "./copilot-sdk-byok";

const KEY = "tvly-super-secret-value";

function keyed(overrides: Partial<WebSearchSettings> = {}): WebSearchSettings {
  return {
    enabled: true,
    provider: "tavily",
    accessMode: "api-key",
    apiKey: KEY,
    pageFetchEnabled: false,
    ...overrides,
  };
}

function slice(
  webSearch: WebSearchSettings = keyed()
): IntegrationSettingsSlice {
  return {
    copilotSdkByok: DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
    mcpServers: [],
    webSearch,
  };
}

describe("defaults and backward compatibility", () => {
  test("web search is off by default", () => {
    expect(DEFAULT_WEB_SEARCH_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_WEB_SEARCH_SETTINGS.apiKey).toBeNull();
    expect(DEFAULT_WEB_SEARCH_SETTINGS.pageFetchEnabled).toBe(false);
    expect(DEFAULT_INTEGRATION_SETTINGS.webSearch).toEqual(
      DEFAULT_WEB_SEARCH_SETTINGS
    );
  });

  test("a settings blob that predates the feature simply gets the default", () => {
    const filled = withIntegrationDefaults({ openAiApiKey: "sk-test" });

    expect(filled.webSearch).toEqual(DEFAULT_WEB_SEARCH_SETTINGS);
    expect(filled.openAiApiKey).toBe("sk-test");
  });

  test("a missing block is reported as needing normalization exactly once", () => {
    const stored = { copilotSdkByok: DEFAULT_COPILOT_SDK_BYOK_SETTINGS, mcpServers: [] };

    expect(needsIntegrationNormalization(stored)).toBe(true);
    expect(needsIntegrationNormalization(withIntegrationDefaults(stored))).toBe(
      false
    );
  });
});

describe("normalization mirrors the backend", () => {
  test("an unknown provider falls back to Tavily", () => {
    expect(normalizeWebSearchSettings({ provider: "brave" }).provider).toBe(
      "tavily"
    );
  });

  test("keyless is dropped for a provider that has no keyless mode", () => {
    const normalized = normalizeWebSearchSettings({
      enabled: true,
      provider: "exa",
      accessMode: "keyless",
    });

    expect(normalized.accessMode).toBe("api-key");
    expect(supportsKeyless("exa")).toBe(false);
  });

  test("choosing keyless forgets any saved key", () => {
    const normalized = normalizeWebSearchSettings({
      enabled: true,
      accessMode: "keyless",
      apiKey: KEY,
    });

    expect(normalized.apiKey).toBeNull();
  });

  test("bounded page reading is a separate persisted opt-in", () => {
    expect(
      normalizeWebSearchSettings({
        enabled: false,
        pageFetchEnabled: true,
      }).pageFetchEnabled
    ).toBe(true);
  });

  test("a key with whitespace or control characters is refused", () => {
    expect(isValidWebSearchApiKey("tvly-ok")).toBe(true);
    expect(isValidWebSearchApiKey("tvly ok")).toBe(false);
    expect(isValidWebSearchApiKey("tvly\u0007ok")).toBe(false);
    expect(isValidWebSearchApiKey("")).toBe(false);
  });

  test("limits match backend/web_search/config.py", () => {
    expect(WEB_SEARCH_MAX_RESULTS).toBe(5);
    expect(WEB_SEARCH_MAX_INCLUDE_DOMAINS).toBe(10);
    expect(WEB_SEARCH_MAX_TITLE_CHARS).toBe(160);
    expect(WEB_SEARCH_MAX_SNIPPET_CHARS).toBe(600);
    expect(WEB_SEARCH_MAX_TOTAL_CHARS).toBe(4000);
    expect(WEB_SEARCH_MAX_PER_TURN).toBe(3);
    expect(WEB_SEARCH_MAX_PER_GENERATION).toBe(10);
    expect(PAGE_FETCH_MAX_BYTES).toBe(512 * 1024);
    expect(PAGE_FETCH_MAX_TEXT_CHARS).toBe(16_000);
    expect(PAGE_FETCH_MAX_PER_TURN).toBe(2);
    expect(PAGE_FETCH_MAX_PER_GENERATION).toBe(5);
  });
});

describe("usability", () => {
  test("off is never usable", () => {
    expect(isWebSearchUsable(keyed({ enabled: false }))).toBe(false);
  });

  test("enabled without a key explains what is missing", () => {
    expect(webSearchBlockedReason(keyed({ apiKey: null }))).toContain(
      "needs an API key"
    );
  });

  test("keyless Tavily is usable with no key at all", () => {
    expect(
      isWebSearchUsable(keyed({ accessMode: "keyless", apiKey: null }))
    ).toBe(true);
  });

  test("keyless Exa is refused, because Exa has no keyless mode", () => {
    expect(
      webSearchBlockedReason(
        keyed({ provider: "exa", accessMode: "keyless", apiKey: null })
      )
    ).toContain("no keyless mode");
  });
});

describe("wire payloads and secrets", () => {
  test("a run carries the key", () => {
    expect(toWebSearchWirePayload(keyed()).apiKey).toBe(KEY);
  });

  test("a keyless run never carries a key", () => {
    expect(
      toWebSearchWirePayload(keyed({ accessMode: "keyless", apiKey: KEY }))
        .apiKey
    ).toBeUndefined();
  });

  test("stripping drops the key entirely rather than blanking it", () => {
    const stripped = toWebSearchWirePayload(keyed(), { includeSecrets: false });

    expect(stripped).toEqual({
      enabled: true,
      provider: "tavily",
      accessMode: "api-key",
      pageFetchEnabled: false,
    });
    expect(JSON.stringify(stripped)).not.toContain(KEY);
  });

  test("stripIntegrationSecrets removes the search key with the rest", () => {
    const stripped = JSON.stringify(stripIntegrationSecrets(slice()));

    expect(stripped).not.toContain(KEY);
    expect(stripped).toContain("tavily");
  });

  test("the generation payload includes the block and the key", () => {
    const payload = buildGenerationIntegrationPayload(
      slice(keyed({ pageFetchEnabled: true })),
      []
    );

    expect(payload.webSearch.apiKey).toBe(KEY);
    expect(payload.webSearch.pageFetchEnabled).toBe(true);
  });

  test("the plain wire payload includes the block too", () => {
    expect(buildIntegrationWirePayload(slice()).webSearch.enabled).toBe(true);
  });
});

describe("disclosure copy", () => {
  test("egress names the provider, the endpoint and what is not sent", () => {
    const text = describeWebSearchEgress(keyed());

    expect(text).toContain("Tavily");
    expect(text).toContain(WEB_SEARCH_PROVIDER_INFO.tavily.endpoint);
    expect(text).toContain("never sent");
  });

  test("keyless egress says requests share a rate limit", () => {
    expect(
      describeWebSearchEgress(keyed({ accessMode: "keyless", apiKey: null }))
    ).toContain("rate limit");
  });

  test("the free-tier note repeats the provider's own terms", () => {
    expect(WEB_SEARCH_PROVIDER_INFO.tavily.freeTier).toContain(
      "1,000 API credits a month"
    );
    // Exa's free credit is recurring monthly and needs no payment method;
    // calling it a one-off signup allowance would understate it.
    expect(WEB_SEARCH_PROVIDER_INFO.exa.freeTier).toContain(
      "first of each month"
    );
    expect(WEB_SEARCH_PROVIDER_INFO.exa.freeTier).toContain(
      "no payment method required"
    );
  });

  test("no provider is ever described as permanently free", () => {
    for (const info of Object.values(WEB_SEARCH_PROVIDER_INFO)) {
      expect(info.freeTier.toLowerCase()).not.toContain("permanently free");
      expect(info.freeTier.toLowerCase()).not.toContain("always free");
      expect(info.freeTier.toLowerCase()).not.toContain("unlimited");
      // Every allowance is attributed to the provider rather than promised.
      expect(info.freeTier).toContain(info.label);
    }
  });

  test("allowances are scoped, attributed and marked changeable", () => {
    expect(ALLOWANCE_CAVEAT).toContain("set by the provider");
    expect(ALLOWANCE_CAVEAT).toContain("can change");
    expect(ALLOWANCE_CAVEAT).toContain("pricing page");
  });

  test("each provider cites an official pricing URL", () => {
    expect(WEB_SEARCH_PROVIDER_INFO.tavily.pricingUrl).toBe(
      "https://docs.tavily.com/documentation/api-credits"
    );
    expect(WEB_SEARCH_PROVIDER_INFO.exa.pricingUrl).toBe(
      "https://exa.ai/docs/admin/pricing"
    );
    for (const info of Object.values(WEB_SEARCH_PROVIDER_INFO)) {
      expect(info.pricingUrl.startsWith("https://")).toBe(true);
    }
  });

  test("scope says every model gets the tool, with the limits", () => {
    const text = describeWebSearchScope(keyed());

    expect(text).toContain("search_web");
    expect(text).toContain("Copilot");
    expect(text).toContain(String(WEB_SEARCH_MAX_PER_GENERATION));
  });

  test("scope explains an off switch rather than promising tools", () => {
    expect(describeWebSearchScope(keyed({ enabled: false }))).toContain("off");
  });
});

describe("Copilot built-in collision", () => {
  test("a usable canonical configuration supersedes the built-in", () => {
    expect(suppressesCopilotBuiltInSearch(keyed())).toBe(true);

    const scope = webSearchRuntimeScope(slice(), true);
    expect(scope.canonicalActive).toBe(true);
    expect(scope.copilotBuiltInActive).toBe(false);
  });

  test("an unusable configuration leaves the built-in alone", () => {
    const scope = webSearchRuntimeScope(slice(keyed({ apiKey: null })), true);

    expect(scope.canonicalActive).toBe(false);
    expect(scope.copilotBuiltInActive).toBe(true);
  });

  test("with neither configured, nothing is active", () => {
    const scope = webSearchRuntimeScope(
      slice(DEFAULT_WEB_SEARCH_SETTINGS),
      false
    );

    expect(scope.canonicalActive).toBe(false);
    expect(scope.copilotBuiltInActive).toBe(false);
  });
});

describe("backend response parsing", () => {
  test("a summary is read without inventing a credential", () => {
    const summary = parseWebSearchSummary({
      enabled: true,
      provider: "tavily",
      providerLabel: "Tavily",
      accessMode: "api-key",
      hasApiKey: true,
      endpoint: "https://api.tavily.com/search",
      usable: true,
      reason: null,
      maxResults: 5,
      pageFetchEnabled: true,
      maxPageBytes: PAGE_FETCH_MAX_BYTES,
      maxPageTextChars: PAGE_FETCH_MAX_TEXT_CHARS,
      maxPageFetchesPerTurn: PAGE_FETCH_MAX_PER_TURN,
      maxPageFetchesPerGeneration: PAGE_FETCH_MAX_PER_GENERATION,
    });

    expect(summary?.hasApiKey).toBe(true);
    expect(summary?.maxSearchesPerTurn).toBe(WEB_SEARCH_MAX_PER_TURN);
    expect(summary?.pageFetchEnabled).toBe(true);
    expect(summary?.maxPageTextChars).toBe(PAGE_FETCH_MAX_TEXT_CHARS);
    expect(JSON.stringify(summary)).not.toContain(KEY);
  });

  test("a non-object summary is null rather than a guess", () => {
    expect(parseWebSearchSummary("nope")).toBeNull();
  });

  test("a failed test result keeps the provider's actionable message", () => {
    const result = parseWebSearchTestResult({
      ok: false,
      error: "Tavily rejected the API key (HTTP 401).",
      errorCode: "unauthorized",
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("unauthorized");
    expect(result.error).toContain("401");
  });

  test("an unexpected body becomes an honest failure", () => {
    expect(parseWebSearchTestResult(null).error).toBe("Unexpected response.");
  });
});
