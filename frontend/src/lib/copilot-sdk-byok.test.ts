import {
  BYOK_SELECTION_PREFIX,
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  baseModelOfSelectionId,
  byokBaseProvider,
  byokSelectionId,
  byokUnusableReason,
  describeByokEndpoint,
  hasByokCredential,
  isByokSelectionId,
  isByokUsable,
  normalizeCopilotSdkByokSettings,
  parseByokSelectionId,
  runtimeOfSelectionId,
  toByokWirePayload,
  validateByokSettings,
  type CopilotSdkByokSettings,
} from "./copilot-sdk-byok";

const OPENAI_BASE = "gpt-5.6-sol (high thinking)";
const ANTHROPIC_BASE = "claude-opus-5 (high thinking)";

function settings(
  overrides: Partial<CopilotSdkByokSettings> = {}
): CopilotSdkByokSettings {
  return {
    ...DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
    enabled: true,
    provider: "openai",
    baseUrl: "https://gateway.example.com/v1",
    apiKey: "byok-dedicated-key",
    ...overrides,
  };
}

describe("defaults and normalisation", () => {
  test("defaults to a switched-off OpenAI-compatible connection", () => {
    expect(DEFAULT_COPILOT_SDK_BYOK_SETTINGS).toEqual({
      enabled: false,
      provider: "openai",
      baseUrl: null,
      apiKey: null,
      bearerToken: null,
      wireApi: null,
      wireModel: null,
      azureApiVersion: null,
    });
  });

  test("an absent or unusable blob becomes the default, not a migration", () => {
    expect(normalizeCopilotSdkByokSettings(undefined)).toEqual(
      DEFAULT_COPILOT_SDK_BYOK_SETTINGS
    );
    expect(normalizeCopilotSdkByokSettings("nonsense")).toEqual(
      DEFAULT_COPILOT_SDK_BYOK_SETTINGS
    );
    expect(normalizeCopilotSdkByokSettings([])).toEqual(
      DEFAULT_COPILOT_SDK_BYOK_SETTINGS
    );
  });

  test("fills in fields a blob saved by an older build is missing", () => {
    expect(
      normalizeCopilotSdkByokSettings({ enabled: true, provider: "anthropic" })
    ).toEqual({
      ...DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
      enabled: true,
      provider: "anthropic",
    });
  });

  test("ignores a profile list left behind by an intermediate build", () => {
    // A short-lived shape stored named profiles. It is not migrated: the
    // defaults win, so nothing is silently re-pointed at another endpoint.
    const migrated = normalizeCopilotSdkByokSettings({
      enabled: true,
      profiles: [{ id: "azure-prod", apiKey: "old-profile-key" }],
    });
    expect(migrated.apiKey).toBeNull();
    expect(JSON.stringify(migrated)).not.toContain("old-profile-key");
  });

  test("rejects an unknown provider or wire api instead of trusting it", () => {
    const normalized = normalizeCopilotSdkByokSettings({
      provider: "gemini",
      wireApi: "grpc",
    });
    expect(normalized.provider).toBe("openai");
    expect(normalized.wireApi).toBeNull();
  });

  test("drops an Azure api-version once the provider is not Azure", () => {
    expect(
      normalizeCopilotSdkByokSettings({
        provider: "openai",
        azureApiVersion: "2024-10-21",
      }).azureApiVersion
    ).toBeNull();
    expect(
      normalizeCopilotSdkByokSettings({
        provider: "azure",
        azureApiVersion: "2024-10-21",
      }).azureApiVersion
    ).toBe("2024-10-21");
  });

  test("trims values and turns blanks into null", () => {
    const normalized = normalizeCopilotSdkByokSettings({
      apiKey: "  key  ",
      wireModel: "   ",
    });
    expect(normalized.apiKey).toBe("key");
    expect(normalized.wireModel).toBeNull();
  });
});

describe("run identities", () => {
  test("builds and parses a round trip", () => {
    const id = byokSelectionId("azure", OPENAI_BASE);
    expect(id).toBe(`${BYOK_SELECTION_PREFIX}azure/${OPENAI_BASE}`);
    expect(parseByokSelectionId(id)).toEqual({
      provider: "azure",
      baseModelId: OPENAI_BASE,
      wireModel: null,
      isCustom: false,
    });
  });

  test("a BYOK identity can never be mistaken for a native model id", () => {
    expect(isByokSelectionId(byokSelectionId("openai", OPENAI_BASE))).toBe(true);
    expect(isByokSelectionId(OPENAI_BASE)).toBe(false);
    expect(isByokSelectionId("copilot/claude-opus-5")).toBe(false);
    expect(byokSelectionId("openai", OPENAI_BASE)).not.toBe(OPENAI_BASE);
  });

  test("refuses a malformed or unknown-provider identity", () => {
    expect(parseByokSelectionId("sdk-byok/")).toBeNull();
    expect(parseByokSelectionId("sdk-byok/openai/")).toBeNull();
    expect(parseByokSelectionId(`sdk-byok/gemini/${OPENAI_BASE}`)).toBeNull();
  });

  test("reports the runtime an id addresses", () => {
    expect(runtimeOfSelectionId(OPENAI_BASE)).toBe("native");
    expect(runtimeOfSelectionId("copilot/claude-opus-5")).toBe("native");
    expect(runtimeOfSelectionId(byokSelectionId("azure", OPENAI_BASE))).toBe(
      "copilot-byok"
    );
  });

  test("a native id is its own base model", () => {
    expect(baseModelOfSelectionId(OPENAI_BASE)).toBe(OPENAI_BASE);
    expect(baseModelOfSelectionId("copilot/claude-opus-5")).toBe(
      "copilot/claude-opus-5"
    );
  });

  test("a BYOK id carries its base model after the provider", () => {
    expect(baseModelOfSelectionId(byokSelectionId("azure", OPENAI_BASE))).toBe(
      OPENAI_BASE
    );
  });

  test("an unparsable BYOK id has no base model rather than a guessed one", () => {
    expect(baseModelOfSelectionId("sdk-byok/gemini/whatever")).toBeNull();
    expect(baseModelOfSelectionId("sdk-byok/broken")).toBeNull();
  });

  test("a base model id containing a slash still round-trips", () => {
    const id = byokSelectionId("openai", "copilot/claude-opus-5");
    expect(parseByokSelectionId(id)?.baseModelId).toBe("copilot/claude-opus-5");
  });

  test("azure and openai both borrow from the OpenAI catalog", () => {
    expect(byokBaseProvider("openai")).toBe("openai");
    expect(byokBaseProvider("azure")).toBe("openai");
    expect(byokBaseProvider("anthropic")).toBe("anthropic");
  });
});

describe("usability", () => {
  test("a complete connection is ready", () => {
    expect(byokUnusableReason(settings())).toBeNull();
    expect(isByokUsable(settings())).toBe(true);
  });

  test("a switched-off connection offers nothing", () => {
    expect(byokUnusableReason(settings({ enabled: false }))).toBe(
      "switched off"
    );
  });

  test("never falls back to a direct provider key", () => {
    const noKey = settings({ apiKey: null, bearerToken: null });
    expect(byokUnusableReason(noKey)).toContain("its own API key");
    expect(hasByokCredential(noKey)).toBe(false);
    expect(validateByokSettings(noKey).apiKey).toContain("dedicated API key");
  });

  test("allows a local OpenAI-compatible server without a key", () => {
    const local = settings({
      apiKey: null,
      baseUrl: "http://localhost:11434/v1",
    });
    expect(byokUnusableReason(local)).toBeNull();
    expect(validateByokSettings(local)).toEqual({});
  });

  test("does not extend the local exception to Azure or Anthropic", () => {
    expect(
      byokUnusableReason(
        settings({
          provider: "anthropic",
          apiKey: null,
          baseUrl: "http://localhost:8080",
        })
      )
    ).toContain("its own API key");
    expect(
      byokUnusableReason(
        settings({
          provider: "azure",
          apiKey: null,
          baseUrl: "http://localhost:8080",
        })
      )
    ).toContain("its own API key");
  });

  test("Azure needs its endpoint", () => {
    expect(
      byokUnusableReason(settings({ provider: "azure", baseUrl: null }))
    ).toContain("endpoint URL");
  });
});

describe("validation", () => {
  test("says nothing while the connection is off", () => {
    expect(validateByokSettings(settings({ enabled: false, apiKey: null }))).toEqual(
      {}
    );
  });

  test("requires https unless the host is loopback", () => {
    expect(
      validateByokSettings(settings({ baseUrl: "http://gateway.example.com/v1" }))
        .baseUrl
    ).toContain("https://");
    expect(
      validateByokSettings(settings({ baseUrl: "http://127.0.0.1:1234/v1" }))
        .baseUrl
    ).toBeUndefined();
  });

  test("refuses an endpoint with embedded credentials", () => {
    expect(
      validateByokSettings(
        settings({ baseUrl: "https://user:pass@gateway.example.com" })
      ).baseUrl
    ).toContain("username or password");
  });

  test("requires the endpoint for Azure", () => {
    expect(
      validateByokSettings(settings({ provider: "azure", baseUrl: null })).baseUrl
    ).toContain("Azure OpenAI");
  });

  test("keeps the Azure api-version out of the other providers", () => {
    expect(
      validateByokSettings(settings({ azureApiVersion: "2024-10-21" }))
        .azureApiVersion
    ).toContain("Azure");
  });

  test("refuses a control character in a credential", () => {
    expect(
      validateByokSettings(settings({ apiKey: "ab\u0000cd" })).apiKey
    ).toContain("not allowed");
  });
});

describe("wire payload", () => {
  test("sends the connection as configured", () => {
    expect(toByokWirePayload(settings())).toEqual({
      enabled: true,
      provider: "openai",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "byok-dedicated-key",
    });
  });

  test("describes the configuration, never this run's picks", () => {
    // Nothing about the selection reaches this block: the runtime is decided
    // per selection id, so sending it can never re-route a native pick.
    const payload = toByokWirePayload(settings());
    expect(Object.keys(payload)).not.toContain("selectedModels");
    expect(Object.keys(payload)).not.toContain("modelSelections");
  });

  test("omits every secret when asked to", () => {
    const payload = toByokWirePayload(
      settings({ bearerToken: "bearer-secret" }),
      { includeSecrets: false }
    );
    const json = JSON.stringify(payload);
    expect(json).not.toContain("byok-dedicated-key");
    expect(json).not.toContain("bearer-secret");
    expect(payload.baseUrl).toBe("https://gateway.example.com/v1");
  });

  test("only sends an api-version for Azure", () => {
    expect(
      toByokWirePayload(
        settings({
          provider: "azure",
          baseUrl: "https://r.openai.azure.com",
          azureApiVersion: "2024-10-21",
        })
      ).azureApiVersion
    ).toBe("2024-10-21");
    expect(
      toByokWirePayload(settings({ azureApiVersion: "2024-10-21" }))
        .azureApiVersion
    ).toBeUndefined();
  });
});

describe("descriptions", () => {
  test("names the endpoint by host without quoting the key", () => {
    const text = describeByokEndpoint(settings());
    expect(text).toContain("OpenAI-compatible");
    expect(text).toContain("gateway.example.com");
    expect(text).not.toContain("byok-dedicated-key");
  });

  test("names the wire model when the endpoint renames it", () => {
    expect(
      describeByokEndpoint(settings({ wireModel: "my-model-large" }))
    ).toContain("as my-model-large");
  });

  test("falls back to a readable placeholder with no base url", () => {
    expect(describeByokEndpoint(settings({ baseUrl: null }))).toContain(
      "provider default endpoint"
    );
    expect(
      describeByokEndpoint(
        settings({ provider: "azure", baseUrl: null, apiKey: "k" })
      )
    ).toContain("your resource");
  });

  test("covers the Anthropic base provider too", () => {
    expect(
      byokUnusableReason(
        settings({ provider: "anthropic", apiKey: "k", baseUrl: null })
      )
    ).toBeNull();
    expect(byokSelectionId("anthropic", ANTHROPIC_BASE)).toBe(
      `sdk-byok/anthropic/${ANTHROPIC_BASE}`
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Custom endpoint models                                                      */
/* -------------------------------------------------------------------------- */

import {
  MAX_WIRE_MODEL_LENGTH,
  byokCustomSelectionId,
  isCustomByokSelectionId,
  isValidWireModel,
  parseByokSelectionId as parseId,
  wireModelOfSelectionId,
} from "./copilot-sdk-byok";

describe("isValidWireModel", () => {
  it("accepts the shapes organisation endpoints really use", () => {
    for (const name of [
      "my-model-v1",
      "my-org/my-model:latest",
      "my-model@2026-01",
      "my_model+preview",
      "gpt-4o-mini",
    ]) {
      expect(isValidWireModel(name)).toBe(true);
    }
  });

  it("rejects whitespace, control characters and empty names", () => {
    for (const name of ["", "   ", "my model", "model\tname", "a\u0000b"]) {
      expect(isValidWireModel(name)).toBe(false);
    }
    expect(isValidWireModel(undefined)).toBe(false);
    expect(isValidWireModel(42)).toBe(false);
  });

  it("rejects a name that cannot start a path segment", () => {
    expect(isValidWireModel("/leading-slash")).toBe(false);
    expect(isValidWireModel("-leading-dash")).toBe(false);
  });

  it("bounds the length the same way the backend does", () => {
    expect(isValidWireModel("a".repeat(MAX_WIRE_MODEL_LENGTH))).toBe(true);
    expect(isValidWireModel("a".repeat(MAX_WIRE_MODEL_LENGTH + 1))).toBe(false);
  });
});

describe("custom selection ids", () => {
  it("builds the backend's documented pattern", () => {
    expect(byokCustomSelectionId("openai", "my-model-v1")).toBe(
      "sdk-byok/openai/custom/my-model-v1"
    );
  });

  it("URL-encodes a name so a slash can never read as structure", () => {
    const id = byokCustomSelectionId("openai", "my-org/my-model:latest");

    expect(id).toBe("sdk-byok/openai/custom/my-org%2Fmy-model%3Alatest");
    // The encoded segment must not introduce a new path level.
    expect(id.split("/")).toHaveLength(4);
  });

  it("round-trips every realistic name", () => {
    for (const name of [
      "my-model-v1",
      "my-org/my-model:latest",
      "my-model@2026-01",
      "a.b_c+d",
    ]) {
      const parsed = parseId(byokCustomSelectionId("openai", name));
      expect(parsed?.wireModel).toBe(name);
      expect(parsed?.isCustom).toBe(true);
      expect(parsed?.baseModelId).toBeNull();
      expect(parsed?.provider).toBe("openai");
    }
  });

  it("keeps a known-model identity separate from a custom one", () => {
    const known = parseId(byokSelectionId("azure", OPENAI_BASE));
    expect(known?.isCustom).toBe(false);
    expect(known?.baseModelId).toBe(OPENAI_BASE);
    expect(known?.wireModel).toBeNull();

    expect(isCustomByokSelectionId(byokSelectionId("azure", OPENAI_BASE))).toBe(
      false
    );
    expect(
      isCustomByokSelectionId(byokCustomSelectionId("azure", "my-deployment"))
    ).toBe(true);
  });

  it("never claims the endpoint model is a catalog base model", () => {
    // A custom id has no catalog base; the endpoint name stands in so the
    // selection still carries something truthful on the wire.
    const id = byokCustomSelectionId("openai", "my-model-v1");
    expect(baseModelOfSelectionId(id)).toBe("my-model-v1");
    expect(wireModelOfSelectionId(id)).toBe("my-model-v1");
    expect(wireModelOfSelectionId(byokSelectionId("openai", OPENAI_BASE))).toBeNull();
  });

  it("refuses a custom id whose decoded name is not usable", () => {
    expect(parseId("sdk-byok/openai/custom/")).toBeNull();
    expect(parseId("sdk-byok/openai/custom/my%20model")).toBeNull();
    expect(parseId("sdk-byok/openai/custom/%E0%A4%A")).toBeNull();
    expect(parseId("sdk-byok/nowhere/custom/my-model")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Wire API: Automatic must stay reachable                                     */
/* -------------------------------------------------------------------------- */

import {
  BYOK_WIRE_API_AUTOMATIC_LABEL,
  describeWireApiChoice,
  effectiveWireApi,
  MAX_WIRE_MODEL_LENGTH as WIRE_MODEL_LIMIT,
} from "./copilot-sdk-byok";

describe("the Automatic wire API", () => {
  it("is the default, so a fresh connection lets the backend decide", () => {
    expect(DEFAULT_COPILOT_SDK_BYOK_SETTINGS.wireApi).toBeNull();
    expect(BYOK_WIRE_API_AUTOMATIC_LABEL).toContain("Automatic");
  });

  it("omits wireApi from the payload so the backend's derivation can run", () => {
    const payload = toByokWirePayload(settings({ wireApi: null }));

    // The absence is the signal. Sending any value would pin the protocol and
    // make the backend's provider-neutral default unreachable.
    expect("wireApi" in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("wireApi");
  });

  it("still sends an explicitly pinned protocol", () => {
    expect(toByokWirePayload(settings({ wireApi: "completions" })).wireApi).toBe(
      "completions"
    );
    expect(toByokWirePayload(settings({ wireApi: "responses" })).wireApi).toBe(
      "responses"
    );
  });

  it("mirrors the backend's derivation for display", () => {
    // A custom endpoint speaks Chat Completions; a vendor endpoint Responses.
    expect(
      effectiveWireApi({ wireApi: null, baseUrl: "https://api.example.com/v1" })
    ).toBe("completions");
    expect(effectiveWireApi({ wireApi: null, baseUrl: null })).toBe("responses");
    // A pinned value wins over the derivation, either way.
    expect(
      effectiveWireApi({
        wireApi: "responses",
        baseUrl: "https://api.example.com/v1",
      })
    ).toBe("responses");
    expect(
      effectiveWireApi({ wireApi: "completions", baseUrl: null })
    ).toBe("completions");
  });

  it("says when a protocol was chosen rather than picked", () => {
    expect(
      describeWireApiChoice({
        wireApi: null,
        baseUrl: "https://api.example.com/v1",
      })
    ).toBe("Chat Completions API, chosen automatically");
    expect(
      describeWireApiChoice({ wireApi: "responses", baseUrl: null })
    ).toBe("Responses API");
  });

  it("keeps a protocol somebody saved on purpose", () => {
    // Upgrading must not change what a working connection speaks.
    for (const pinned of ["responses", "completions"] as const) {
      expect(
        normalizeCopilotSdkByokSettings({ wireApi: pinned }).wireApi
      ).toBe(pinned);
    }
  });

  it("treats an absent or unusable protocol as Automatic", () => {
    for (const stored of [undefined, null, "", "grpc", 7, {}]) {
      expect(
        normalizeCopilotSdkByokSettings({ wireApi: stored }).wireApi
      ).toBeNull();
    }
  });

  it("describes the endpoint with the protocol that will really be used", () => {
    expect(
      describeByokEndpoint(
        settings({ wireApi: null, baseUrl: "https://api.example.com/v1" })
      )
    ).toContain("Chat Completions API");
    expect(
      describeByokEndpoint(settings({ wireApi: null, baseUrl: null }))
    ).toContain("Responses API");
  });
});

/* -------------------------------------------------------------------------- */
/* Endpoint model names survive a restart                                      */
/* -------------------------------------------------------------------------- */

describe("persisting an endpoint model id", () => {
  const LONG_MODEL = `a${"b".repeat(WIRE_MODEL_LIMIT - 1)}`;

  it("keeps a valid id longer than the old 64-character bound", () => {
    expect(LONG_MODEL).toHaveLength(WIRE_MODEL_LIMIT);
    expect(LONG_MODEL.length).toBeGreaterThan(100);
    expect(isValidWireModel(LONG_MODEL)).toBe(true);

    const restored = normalizeCopilotSdkByokSettings({
      wireModel: LONG_MODEL,
    });

    // Truncating here would silently run a *different* model after a restart.
    expect(restored.wireModel).toBe(LONG_MODEL);
    expect(restored.wireModel).toHaveLength(WIRE_MODEL_LIMIT);
  });

  it("round-trips such an id through the payload and its selection identity", () => {
    const stored = normalizeCopilotSdkByokSettings({
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "dedicated",
      wireModel: LONG_MODEL,
    });

    expect(toByokWirePayload(stored).wireModel).toBe(LONG_MODEL);
    const id = byokCustomSelectionId("openai", LONG_MODEL);
    expect(parseByokSelectionId(id)?.wireModel).toBe(LONG_MODEL);
  });

  it("reports an over-long id instead of trimming it into a valid one", () => {
    const tooLong = "c".repeat(WIRE_MODEL_LIMIT + 40);
    const stored = normalizeCopilotSdkByokSettings({
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "dedicated",
      wireModel: tooLong,
    });

    // Kept verbatim, so the error names what was actually typed...
    expect(stored.wireModel).toBe(tooLong);
    // ...and it is refused rather than quietly becoming a different model.
    expect(isValidWireModel(stored.wireModel)).toBe(false);
    expect(validateByokSettings(stored).wireModel).toContain(
      String(WIRE_MODEL_LIMIT)
    );
  });

  it("still reports a badly shaped id of any length", () => {
    const stored = normalizeCopilotSdkByokSettings({
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "dedicated",
      wireModel: "has a space",
    });
    expect(stored.wireModel).toBe("has a space");
    expect(validateByokSettings(stored).wireModel).toContain("no spaces");
  });
});
