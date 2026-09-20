jest.mock("../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import {
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  type CopilotSdkByokSettings,
} from "./copilot-sdk-byok";
import type { ModelCatalog } from "./model-selection";
import {
  buildProviderValidationPayload,
  describeProviderCheck,
  nativeModelForProviderCheck,
  parseProviderValidation,
  providerCheckTone,
  validateProvider,
} from "./provider-validation";

const OPENAI_KEY = "sk-openai-secret-value";
const ANTHROPIC_KEY = "sk-ant-secret-value";
const GEMINI_KEY = "gemini-secret-value";
const REPLICATE_KEY = "r8-replicate-secret-value";

const ALL_KEYS = {
  openAiApiKey: OPENAI_KEY,
  openAiBaseURL: "https://proxy.example.com/v1",
  anthropicApiKey: ANTHROPIC_KEY,
  geminiApiKey: GEMINI_KEY,
  replicateApiKey: REPLICATE_KEY,
};

function byok(
  overrides: Partial<CopilotSdkByokSettings> = {}
): CopilotSdkByokSettings {
  return {
    ...DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
    enabled: true,
    provider: "azure",
    baseUrl: "https://resource.openai.azure.com",
    apiKey: "byok-dedicated-secret",
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildProviderValidationPayload", () => {
  it("sends only the tested provider's credential", () => {
    const openai = buildProviderValidationPayload("openai", {
      settings: ALL_KEYS,
    });
    expect(openai.apiKey).toBe(OPENAI_KEY);
    expect(openai.baseUrl).toBe("https://proxy.example.com/v1");

    const serialized = JSON.stringify(openai);
    expect(serialized).not.toContain(ANTHROPIC_KEY);
    expect(serialized).not.toContain(GEMINI_KEY);
    expect(serialized).not.toContain(REPLICATE_KEY);
  });

  it.each([
    ["anthropic", ANTHROPIC_KEY, [OPENAI_KEY, GEMINI_KEY, REPLICATE_KEY]],
    ["gemini", GEMINI_KEY, [OPENAI_KEY, ANTHROPIC_KEY, REPLICATE_KEY]],
    ["replicate", REPLICATE_KEY, [OPENAI_KEY, ANTHROPIC_KEY, GEMINI_KEY]],
  ] as const)(
    "%s carries its own key and no other",
    (provider, own, others) => {
      const payload = buildProviderValidationPayload(provider, {
        settings: ALL_KEYS,
      });
      expect(payload.apiKey).toBe(own);
      const serialized = JSON.stringify(payload);
      for (const other of others) {
        expect(serialized).not.toContain(other);
      }
      // The base URL belongs to OpenAI-compatible traffic only.
      expect(payload.baseUrl).toBeUndefined();
    }
  );

  it("omits the key when the field is empty so the backend uses its own", () => {
    const payload = buildProviderValidationPayload("openai", {
      settings: { openAiApiKey: "   " },
    });
    expect(payload).toEqual({ provider: "openai" });
    expect("apiKey" in payload).toBe(false);
  });

  it("sends the BYOK connection and never a native key", () => {
    const payload = buildProviderValidationPayload("copilot-byok", {
      settings: ALL_KEYS,
      copilotSdkByok: byok(),
      modelId: "sdk-byok/azure/gpt-5.5 (high thinking)",
    });

    expect(payload.provider).toBe("copilot-byok");
    expect(payload.modelId).toBe("sdk-byok/azure/gpt-5.5 (high thinking)");
    expect(payload.copilotSdkByok?.apiKey).toBe("byok-dedicated-secret");

    const serialized = JSON.stringify(payload);
    for (const key of [OPENAI_KEY, ANTHROPIC_KEY, GEMINI_KEY, REPLICATE_KEY]) {
      expect(serialized).not.toContain(key);
    }
  });

  it("never attaches a BYOK connection to a native check", () => {
    const payload = buildProviderValidationPayload("openai", {
      settings: ALL_KEYS,
      copilotSdkByok: byok(),
    });
    expect(payload.copilotSdkByok).toBeUndefined();
  });

  it("includes a model id only when one was chosen", () => {
    expect(
      buildProviderValidationPayload("gemini", {
        settings: ALL_KEYS,
        modelId: "gemini-3-pro (high thinking)",
      }).modelId
    ).toBe("gemini-3-pro (high thinking)");
    expect(
      buildProviderValidationPayload("gemini", {
        settings: ALL_KEYS,
        modelId: null,
      }).modelId
    ).toBeUndefined();
  });
});

describe("parseProviderValidation", () => {
  it("reads the documented shape", () => {
    expect(
      parseProviderValidation(
        {
          provider: "openai",
          ok: true,
          category: "ready",
          message: "Reached gpt-5.5.",
          modelId: "gpt-5.5 (high thinking)",
        },
        "openai"
      )
    ).toEqual({
      provider: "openai",
      ok: true,
      category: "ready",
      message: "Reached gpt-5.5.",
      modelId: "gpt-5.5 (high thinking)",
      models: [],
    });
  });

  it("keeps the requested provider when the answer omits or garbles it", () => {
    const result = parseProviderValidation({ ok: false }, "anthropic");
    expect(result.provider).toBe("anthropic");
    expect(result.category).toBe("unknown");
    expect(result.ok).toBe(false);
  });
});

describe("result presentation", () => {
  it("renders a zero-credit OpenAI answer as billing, not a generic failure", () => {
    // `provider_errors.py` files OpenAI's `insufficient_quota` under `billing`.
    const presentation = describeProviderCheck(
      parseProviderValidation(
        {
          provider: "openai",
          ok: false,
          category: "billing",
          message:
            "OpenAI reports no available credit for this account. Add credits or update the billing details on the provider's dashboard.",
        },
        "openai"
      )
    );

    expect(presentation.tone).toBe("billing");
    expect(presentation.headline).toBe("Out of credit");
    // The backend's own wording survives.
    expect(presentation.detail).toContain("no available credit");
    // And the frontend adds the action that actually fixes it.
    expect(presentation.guidance).toContain("no credit left");
    expect(presentation.actionLabel).toBe("Open billing");
    expect(presentation.actionUrl).toBe(
      "https://platform.openai.com/settings/organization/billing/overview"
    );
    expect(presentation.headline).not.toBe("Check failed");
  });

  it("still routes a raw provider code to billing if one reaches the UI", () => {
    expect(providerCheckTone("insufficient_quota")).toBe("billing");
  });

  it("maps every category the backend can emit", () => {
    // Mirrors `ErrorCategory` in backend/provider_errors.py.
    expect(providerCheckTone("ready")).toBe("ready");
    expect(providerCheckTone("credentials")).toBe("auth");
    expect(providerCheckTone("billing")).toBe("billing");
    expect(providerCheckTone("quota")).toBe("quota");
    expect(providerCheckTone("permissions")).toBe("config");
    expect(providerCheckTone("model")).toBe("config");
    expect(providerCheckTone("network")).toBe("network");
    expect(providerCheckTone("configuration")).toBe("config");
    expect(providerCheckTone("unknown")).toBe("error");
    expect(providerCheckTone("something_new")).toBe("error");
  });

  it("keeps a temporary rate limit distinct from an unpaid account", () => {
    const quota = describeProviderCheck({
      provider: "openai",
      ok: false,
      category: "quota",
      message: "OpenAI is rate limiting or out of quota right now.",
      modelId: null,
      models: [],
    });

    expect(quota.tone).toBe("quota");
    expect(quota.headline).toBe("Rate limited");
    expect(quota.guidance).toContain("temporary");
    // Sending someone to billing for a rate limit would be wrong.
    expect(quota.actionUrl).toBeNull();
  });

  it("names an access and a model problem specifically", () => {
    expect(
      describeProviderCheck({
        provider: "openai",
        ok: false,
        category: "permissions",
        message: "OpenAI denied access to this model.",
        modelId: null,
        models: [],
      }).headline
    ).toBe("Access denied");

    expect(
      describeProviderCheck({
        provider: "gemini",
        ok: false,
        category: "model",
        message: "Gemini does not offer the requested model.",
        modelId: null,
        models: [],
      }).headline
    ).toBe("Model unavailable");
  });

  it("separates a rejected key from an unpaid account", () => {
    const auth = describeProviderCheck({
      provider: "anthropic",
      ok: false,
      category: "credentials",
      message: "Anthropic rejected the credentials.",
      modelId: null,
      models: [],
    });
    expect(auth.tone).toBe("auth");
    expect(auth.headline).toBe("Key rejected");
    expect(auth.actionUrl).toBeNull();
    expect(auth.guidance).toContain("Anthropic key");
  });

  it("reports success with the backend message", () => {
    const ready = describeProviderCheck({
      provider: "gemini",
      ok: true,
      category: "ready",
      message: "Google Gemini responded successfully using gemini-3-pro.",
      modelId: "gemini-3-pro (high thinking)",
      models: [],
    });
    expect(ready.tone).toBe("ready");
    expect(ready.headline).toBe("Ready");
    expect(ready.detail).toContain("responded successfully");
  });

  it("falls back to its own sentence when the backend sent no message", () => {
    expect(
      describeProviderCheck({
        provider: "replicate",
        ok: true,
        category: "ready",
        message: "",
        modelId: null,
        models: [],
      }).detail
    ).toBe("Replicate answered a test request.");
  });
});

describe("nativeModelForProviderCheck", () => {
  const catalog: ModelCatalog = {
    providers: [
      {
        id: "openai",
        label: "OpenAI",
        available: true,
        credential_label: "OpenAI API key",
        credential_source: "request",
        source_kind: "curated",
        detail: "",
        models: [
          {
            id: "gpt-old",
            provider: "openai",
            label: "old",
            family: "gpt",
            status: "deprecated",
            recommended: false,
            supports_video: false,
            runtime: "native",
            base_model_id: null,
          },
          {
            id: "gpt-rec",
            provider: "openai",
            label: "rec",
            family: "gpt",
            status: "available",
            recommended: true,
            supports_video: false,
            runtime: "native",
            base_model_id: null,
          },
          {
            id: "gpt-other",
            provider: "openai",
            label: "other",
            family: "gpt",
            status: "available",
            recommended: false,
            supports_video: false,
            runtime: "native",
            base_model_id: null,
          },
        ],
        unsupported_model_ids: [],
      },
      {
        id: "sdk-byok",
        label: "Copilot SDK (BYOK)",
        available: true,
        credential_label: "BYOK",
        credential_source: "sdk-byok",
        source_kind: "configured",
        detail: "",
        models: [
          {
            id: "sdk-byok/openai/gpt-rec",
            provider: "sdk-byok",
            label: "rec",
            family: "gpt",
            status: "available",
            recommended: false,
            supports_video: false,
            runtime: "copilot-byok",
            base_model_id: "gpt-rec",
          },
        ],
        unsupported_model_ids: [],
      },
    ],
    stale_selection: [],
    integration_diagnostics: [],
  };

  it("prefers a model the user actually selected", () => {
    expect(
      nativeModelForProviderCheck("openai", catalog, ["gpt-other"])
    ).toBe("gpt-other");
  });

  it("never tests a native provider with a BYOK identity", () => {
    // Selecting only the BYOK twin must not make the native check exercise it.
    expect(
      nativeModelForProviderCheck("openai", catalog, [
        "sdk-byok/openai/gpt-rec",
      ])
    ).toBe("gpt-rec");
  });

  it("falls back to the recommended model, never a deprecated one", () => {
    expect(nativeModelForProviderCheck("openai", catalog, [])).toBe("gpt-rec");
  });

  it("lets the backend choose for providers with no catalog group", () => {
    expect(nativeModelForProviderCheck("replicate", catalog, [])).toBeNull();
    expect(nativeModelForProviderCheck("anthropic", catalog, [])).toBeNull();
  });
});

describe("validateProvider", () => {
  it("posts to the documented route", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ provider: "openai", ok: true, category: "ok" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await validateProvider({ provider: "openai" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:7001/api/providers/validate"
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(result.ok).toBe(true);
  });

  it("explains an older backend instead of blaming the provider", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const result = await validateProvider({ provider: "gemini" });
    expect(result.category).toBe("unsupported_backend");
    expect(result.message).toContain("does not offer connection checks");
    expect(describeProviderCheck(result).tone).toBe("error");
  });

  it("still reads a structured body on a non-2xx answer", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        provider: "openai",
        ok: false,
        category: "insufficient_quota",
        message: "Add credit to continue.",
      }),
    }) as unknown as typeof fetch;

    const result = await validateProvider({ provider: "openai" });
    expect(result.category).toBe("insufficient_quota");
    expect(describeProviderCheck(result).tone).toBe("billing");
  });
});


/* -------------------------------------------------------------------------- */
/* Endpoint model discovery                                                    */
/* -------------------------------------------------------------------------- */

import { MAX_DISCOVERED_MODELS } from "./copilot-sdk-byok";
import { parseDiscoveredModels } from "./provider-validation";

describe("parseDiscoveredModels", () => {
  it("keeps the ids an organisation endpoint really reports", () => {
    expect(
      parseDiscoveredModels([
        "my-model-v1",
        "my-org/my-model:latest",
        "my-model@2026-01",
      ])
    ).toEqual(["my-model-v1", "my-org/my-model:latest", "my-model@2026-01"]);
  });

  it("drops anything that could not become a selection id", () => {
    // A name the backend would refuse must never reach the picker, or picking
    // it would build an id that cannot be parsed back.
    expect(
      parseDiscoveredModels([
        "good-model",
        "bad model",
        "",
        "   ",
        null,
        42,
        { id: "nested" },
        "control\u0007char",
      ])
    ).toEqual(["good-model"]);
  });

  it("de-duplicates while preserving the endpoint's order", () => {
    expect(
      parseDiscoveredModels(["b", "a", "b", " a ", "c"])
    ).toEqual(["b", "a", "c"]);
  });

  it("caps the list so a hostile endpoint cannot flood the picker", () => {
    const flood = Array.from({ length: 5000 }, (_, i) => `model-${i}`);
    const parsed = parseDiscoveredModels(flood);

    expect(parsed).toHaveLength(MAX_DISCOVERED_MODELS);
    expect(parsed[0]).toBe("model-0");
  });

  it("treats a non-list as no discovery at all", () => {
    expect(parseDiscoveredModels(undefined)).toEqual([]);
    expect(parseDiscoveredModels(null)).toEqual([]);
    expect(parseDiscoveredModels("my-model-v1")).toEqual([]);
    expect(parseDiscoveredModels({ data: [] })).toEqual([]);
  });
});

describe("a validation response carrying discovery", () => {
  it("surfaces the list on success", () => {
    const result = parseProviderValidation(
      {
        provider: "copilot-byok",
        ok: true,
        category: "ready",
        message: "Reached the endpoint.",
        models: ["my-model-v1", "my-model-large"],
      },
      "copilot-byok"
    );
    expect(result.models).toEqual(["my-model-v1", "my-model-large"]);
  });

  it("surfaces the list on a wrong-model failure, where it matters most", () => {
    const result = parseProviderValidation(
      {
        provider: "copilot-byok",
        ok: false,
        category: "model",
        message: "The endpoint does not list 'gpt-4o'.",
        models: ["my-model-v1"],
      },
      "copilot-byok"
    );
    expect(result.ok).toBe(false);
    expect(result.models).toEqual(["my-model-v1"]);
    expect(describeProviderCheck(result).headline).toBe("Model unavailable");
  });

  it("defaults to an empty list for providers that cannot list models", () => {
    expect(
      parseProviderValidation(
        { provider: "anthropic", ok: true, category: "ready" },
        "anthropic"
      ).models
    ).toEqual([]);
  });
});
