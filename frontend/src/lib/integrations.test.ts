import {
  DEFAULT_INTEGRATION_SETTINGS,
  buildGenerationIntegrationPayload,
  buildIntegrationValidationPayload,
  buildIntegrationWirePayload,
  buildModelSelections,
  byokIdForBaseModel,
  byokSelectionIdsIn,
  describeMcpScope,
  describeSelectionEntry,
  isMcpToolName,
  mcpRuntimeScope,
  needsIntegrationNormalization,
  parseIntegrationDiagnostics,
  parseIntegrationValidation,
  parseMcpToolName,
  stripIntegrationSecrets,
  unavailableByokSelections,
  withIntegrationDefaults,
  type IntegrationSettingsSlice,
} from "./integrations";
import {
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  MAX_MODEL_SELECTIONS,
  byokSelectionId,
  type CopilotSdkByokSettings,
} from "./copilot-sdk-byok";
import { createMcpServer, type McpServerConfig } from "./mcp-servers";

const OPENAI_BASE = "gpt-5.6-sol (high thinking)";
const OTHER_BASE = "gpt-5.5 (high thinking)";
const BYOK_ID = byokSelectionId("azure", OPENAI_BASE);
const BYOK_KEY = "byok-api-key-value";
const BEARER = "byok-bearer-value";
const ENV_SECRET = "mcp-env-token-value";
const HEADER_SECRET = "Bearer mcp-header-token-value";

function byok(
  overrides: Partial<CopilotSdkByokSettings> = {}
): CopilotSdkByokSettings {
  return {
    ...DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
    enabled: true,
    provider: "azure",
    baseUrl: "https://r.openai.azure.com",
    apiKey: BYOK_KEY,
    ...overrides,
  };
}

function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return createMcpServer({
    id: "docs",
    name: "Docs",
    enabled: true,
    trusted: true,
    transport: "stdio",
    command: "npx",
    env: { API_TOKEN: ENV_SECRET },
    ...overrides,
  });
}

function settings(
  overrides: Partial<IntegrationSettingsSlice> = {}
): IntegrationSettingsSlice {
  return { copilotSdkByok: byok(), mcpServers: [server()], ...overrides };
}

describe("defaults and backward compatibility", () => {
  test("defaults are off and empty", () => {
    expect(DEFAULT_INTEGRATION_SETTINGS.copilotSdkByok).toEqual(
      DEFAULT_COPILOT_SDK_BYOK_SETTINGS
    );
    expect(DEFAULT_INTEGRATION_SETTINGS.mcpServers).toEqual([]);
  });

  test("a settings blob that predates the feature gains the defaults", () => {
    const migrated = withIntegrationDefaults({
      openAiApiKey: "sk-direct",
      selectedModels: [OPENAI_BASE],
    });
    expect(migrated.copilotSdkByok).toEqual(DEFAULT_COPILOT_SDK_BYOK_SETTINGS);
    expect(migrated.mcpServers).toEqual([]);
  });

  test("no existing field is read, renamed or rewritten", () => {
    const legacy = {
      openAiApiKey: "sk-direct",
      openAiBaseURL: "https://proxy.example.com/v1",
      anthropicApiKey: "sk-ant",
      geminiApiKey: "gem",
      replicateApiKey: "rep",
      selectedModels: [OPENAI_BASE],
    };
    const migrated = withIntegrationDefaults(legacy);
    expect(migrated.openAiApiKey).toBe("sk-direct");
    expect(migrated.openAiBaseURL).toBe("https://proxy.example.com/v1");
    expect(migrated.anthropicApiKey).toBe("sk-ant");
    expect(migrated.geminiApiKey).toBe("gem");
    expect(migrated.replicateApiKey).toBe("rep");
    expect(migrated.selectedModels).toEqual([OPENAI_BASE]);
    // The connection never borrows a direct key.
    expect(migrated.copilotSdkByok.apiKey).toBeNull();
    expect(migrated.copilotSdkByok.baseUrl).toBeNull();
  });

  test("normalisation is skipped when nothing would change", () => {
    const normalized = withIntegrationDefaults({});
    expect(needsIntegrationNormalization(normalized)).toBe(false);
    expect(needsIntegrationNormalization({})).toBe(true);
  });
});

describe("diagnostics", () => {
  test("parses the backend's safe entries", () => {
    expect(
      parseIntegrationDiagnostics([
        {
          scope: "byok",
          code: "incomplete",
          message: "BYOK needs its own API key.",
          target: "byok",
        },
        { scope: "mcp", code: "untrusted", message: "Docs is not trusted." },
      ])
    ).toHaveLength(2);
  });

  test("drops entries with an unknown scope or no message", () => {
    expect(
      parseIntegrationDiagnostics([
        { scope: "other", code: "x", message: "y" },
        { scope: "mcp", code: "x" },
        null,
        "nope",
      ])
    ).toEqual([]);
  });

  test("parses a validation response into its safe parts", () => {
    const parsed = parseIntegrationValidation({
      valid: true,
      byok_enabled: true,
      byok: {
        enabled: true,
        provider: "azure",
        baseProvider: "openai",
        wireApi: "responses",
        wireModel: null,
        baseUrlHost: "r.openai.azure.com",
        hasApiKey: true,
        hasBearerToken: false,
        azureApiVersion: "2024-10-21",
        usable: true,
        reason: null,
      },
      byok_selection_ids: [BYOK_ID],
      mcp_servers: [{ key: "docs", name: "Docs", active: true }],
      active_mcp_servers: ["docs"],
      diagnostics: [{ scope: "mcp", code: "disabled", message: "Off." }],
    });

    expect(parsed.valid).toBe(true);
    expect(parsed.byokEnabled).toBe(true);
    expect(parsed.byok).toMatchObject({
      provider: "azure",
      baseProvider: "openai",
      baseUrlHost: "r.openai.azure.com",
      hasApiKey: true,
      usable: true,
    });
    expect(parsed.byokSelectionIds).toEqual([BYOK_ID]);
    expect(parsed.activeMcpServers).toEqual(["docs"]);
    expect(parsed.diagnostics).toHaveLength(1);
  });

  test("carries the reason a connection is not usable", () => {
    const parsed = parseIntegrationValidation({
      valid: true,
      byok: { usable: false, reason: "needs its own API key" },
      byok_selection_ids: [],
    });
    expect(parsed.byok?.usable).toBe(false);
    expect(parsed.byok?.reason).toBe("needs its own API key");
  });

  test("reports a refusal with the backend's sentence", () => {
    const parsed = parseIntegrationValidation({
      valid: false,
      error: "copilotSdkByok.baseUrl must use https://.",
    });
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("must use https://");
  });

  test("survives a response that is not an object", () => {
    expect(parseIntegrationValidation("nope").error).toBe(
      "Unexpected response."
    );
  });
});

describe("model selections carry a runtime per pick", () => {
  test("a native pick names itself as its base model", () => {
    expect(buildModelSelections([OPENAI_BASE])).toEqual([
      { id: OPENAI_BASE, baseModel: OPENAI_BASE, runtime: "native" },
    ]);
  });

  test("a BYOK pick keeps its identity and names the base it borrows", () => {
    expect(buildModelSelections([BYOK_ID])).toEqual([
      { id: BYOK_ID, baseModel: OPENAI_BASE, runtime: "copilot-byok" },
    ]);
  });

  test("the same base model appears twice when the runtimes differ", () => {
    const entries = buildModelSelections([OPENAI_BASE, BYOK_ID]);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.baseModel)).toEqual([
      OPENAI_BASE,
      OPENAI_BASE,
    ]);
    expect(entries.map((entry) => entry.runtime)).toEqual([
      "native",
      "copilot-byok",
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([OPENAI_BASE, BYOK_ID]);
  });

  test("de-duplicates by id only, never by base model", () => {
    const entries = buildModelSelections([
      OPENAI_BASE,
      OPENAI_BASE,
      BYOK_ID,
      BYOK_ID,
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([OPENAI_BASE, BYOK_ID]);
  });

  test("preserves the order the user arranged", () => {
    const selection = [BYOK_ID, "copilot/claude-opus-5", OPENAI_BASE];
    expect(buildModelSelections(selection).map((entry) => entry.id)).toEqual(
      selection
    );
  });

  test("drops an unparsable BYOK id rather than downgrading it to native", () => {
    const entries = buildModelSelections([
      OPENAI_BASE,
      "sdk-byok/gemini/whatever",
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].runtime).toBe("native");
  });

  test("never sends more selections than the backend accepts", () => {
    const many = Array.from(
      { length: MAX_MODEL_SELECTIONS + 5 },
      (_, index) => `model-${index}`
    );
    expect(buildModelSelections(many)).toHaveLength(MAX_MODEL_SELECTIONS);
  });

  test("picks out the BYOK ids in a mixed selection", () => {
    expect(
      byokSelectionIdsIn([OPENAI_BASE, BYOK_ID, "copilot/claude-opus-5"])
    ).toEqual([BYOK_ID]);
  });

  test("names a BYOK pick by its base model and provider", () => {
    expect(describeSelectionEntry(BYOK_ID)).toBe(`${OPENAI_BASE} via azure`);
    expect(describeSelectionEntry(OPENAI_BASE)).toBe(OPENAI_BASE);
  });

  test("builds the identity for a base model on the current connection", () => {
    expect(byokIdForBaseModel(settings(), OTHER_BASE)).toBe(
      `sdk-byok/azure/${OTHER_BASE}`
    );
  });
});

describe("picks the connection can no longer serve", () => {
  test("reports nothing while the connection matches", () => {
    expect(
      unavailableByokSelections([OPENAI_BASE, BYOK_ID], settings())
    ).toEqual([]);
  });

  test("reports a pick whose provider no longer matches", () => {
    const moved = settings({ copilotSdkByok: byok({ provider: "openai" }) });
    expect(unavailableByokSelections([OPENAI_BASE, BYOK_ID], moved)).toEqual([
      BYOK_ID,
    ]);
  });

  test("reports every BYOK pick once the connection is off", () => {
    const off = settings({ copilotSdkByok: byok({ enabled: false }) });
    expect(unavailableByokSelections([BYOK_ID], off)).toEqual([BYOK_ID]);
  });

  test("never reports a native pick", () => {
    const off = settings({ copilotSdkByok: byok({ enabled: false }) });
    expect(unavailableByokSelections([OPENAI_BASE], off)).toEqual([]);
  });
});

describe("the generation payload", () => {
  test("sends modelSelections plus the ids for an older backend", () => {
    const payload = buildGenerationIntegrationPayload(settings(), [
      OPENAI_BASE,
      BYOK_ID,
    ]);

    expect(payload.modelSelections).toEqual([
      { id: OPENAI_BASE, baseModel: OPENAI_BASE, runtime: "native" },
      { id: BYOK_ID, baseModel: OPENAI_BASE, runtime: "copilot-byok" },
    ]);
    expect(payload.selectedModels).toEqual([OPENAI_BASE, BYOK_ID]);
    expect(payload.copilotSdkByok.apiKey).toBe(BYOK_KEY);
    expect(payload.mcpServers).toHaveLength(1);
  });

  test("the connection block is identical whether or not BYOK was picked", () => {
    const withByok = buildGenerationIntegrationPayload(settings(), [BYOK_ID]);
    const withoutByok = buildGenerationIntegrationPayload(settings(), [
      OPENAI_BASE,
    ]);

    // Sending it can never re-route a native pick, so there is nothing to gate.
    expect(withoutByok.copilotSdkByok).toEqual(withByok.copilotSdkByok);
    expect(withoutByok.copilotSdkByok.enabled).toBe(true);
    expect(withoutByok.modelSelections[0].runtime).toBe("native");
  });

  test("validation and generation send the same configuration block", () => {
    expect(buildIntegrationValidationPayload(settings())).toEqual(
      buildIntegrationWirePayload(settings())
    );
  });
});

describe("secrets never reach anything that is written down", () => {
  const withEverything = settings({
    copilotSdkByok: byok({ bearerToken: BEARER }),
    mcpServers: [
      server(),
      server({
        id: "remote",
        name: "Remote",
        transport: "http",
        url: "https://mcp.example.com",
        headers: { Authorization: HEADER_SECRET },
        env: {},
        command: null,
      }),
    ],
  });

  test("a stripped copy keeps the shape and drops every value", () => {
    const stripped = JSON.stringify(stripIntegrationSecrets(withEverything));

    expect(stripped).not.toContain(BYOK_KEY);
    expect(stripped).not.toContain(BEARER);
    expect(stripped).not.toContain(ENV_SECRET);
    expect(stripped).not.toContain("mcp-header-token-value");
    // The shape survives, so a snapshot can still say what was configured.
    expect(stripped).toContain("API_TOKEN");
    expect(stripped).toContain("Authorization");
    expect(stripped).toContain("r.openai.azure.com");
  });

  test("the generation payload is the only place a secret appears", () => {
    const generation = JSON.stringify(
      buildGenerationIntegrationPayload(withEverything, [BYOK_ID])
    );
    expect(generation).toContain(BEARER);
    expect(generation).toContain(ENV_SECRET);

    const stripped = JSON.stringify(stripIntegrationSecrets(withEverything));
    expect(stripped).not.toContain(BEARER);
    expect(stripped).not.toContain(ENV_SECRET);
  });
});

describe("MCP runtime scope", () => {
  const providerOf = (modelId: string) => {
    if (modelId.startsWith("sdk-byok/")) return "sdk-byok";
    if (modelId.startsWith("copilot/")) return "copilot";
    if (modelId.startsWith("claude")) return "anthropic";
    if (modelId.startsWith("gemini")) return "gemini";
    return "openai";
  };

  test("reports nothing active while no server is enabled and trusted", () => {
    const scope = mcpRuntimeScope(
      settings({ mcpServers: [server({ trusted: false })] }),
      ["copilot/claude-opus-5"],
      providerOf
    );
    expect(scope.hasActiveServers).toBe(false);
    expect(describeMcpScope(scope)).toContain("No MCP server");
  });

  test("applies to Copilot subscription options", () => {
    const scope = mcpRuntimeScope(
      settings(),
      ["copilot/claude-opus-5"],
      providerOf
    );
    expect(scope.appliesToCopilot).toBe(true);
    expect(scope.appliesToByok).toBe(false);
    expect(scope.excludedModelIds).toEqual([]);
  });

  test("applies to a BYOK option too", () => {
    const scope = mcpRuntimeScope(settings(), [BYOK_ID], providerOf);
    expect(scope.appliesToByok).toBe(true);
    expect(scope.excludedModelIds).toEqual([]);
  });

  test("excludes only the options running on their own provider key", () => {
    const scope = mcpRuntimeScope(
      settings(),
      [BYOK_ID, OPENAI_BASE, "copilot/claude-opus-5"],
      providerOf
    );
    // The native pick keeps its own runtime even though the BYOK option that
    // borrows the same base model is in the same run.
    expect(scope.excludedModelIds).toEqual([OPENAI_BASE]);
    expect(describeMcpScope(scope)).toContain("do not see them");
  });

  test("names the servers a run will actually offer", () => {
    expect(
      describeMcpScope(mcpRuntimeScope(settings(), [], providerOf))
    ).toContain("Docs");
  });
});

describe("MCP tool names", () => {
  test("splits the backend's `MCP · server · tool` name", () => {
    expect(parseMcpToolName("MCP · docs · search")).toEqual({
      server: "docs",
      tool: "search",
    });
    expect(isMcpToolName("MCP · docs · search")).toBe(true);
  });

  test("keeps a tool name that itself contains the separator", () => {
    expect(parseMcpToolName("MCP · docs · search · deep")).toEqual({
      server: "docs",
      tool: "search · deep",
    });
  });

  test("leaves shot2code's own tools alone", () => {
    expect(parseMcpToolName("create_file")).toBeNull();
    expect(parseMcpToolName(undefined)).toBeNull();
    expect(isMcpToolName("screenshot_preview")).toBe(false);
  });

  test("refuses a half-formed name rather than guessing", () => {
    expect(parseMcpToolName("MCP · docs")).toBeNull();
    expect(parseMcpToolName("MCP ·  · search")).toBeNull();
  });
});
