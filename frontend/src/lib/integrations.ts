/**
 * The additive integration settings: a Copilot SDK BYOK connection and MCP
 * servers.
 *
 * This module is the seam between the two feature modules and the rest of the
 * app. It builds the payloads the generate socket, the model catalog and the
 * validation endpoint take.
 *
 * The selection is **authoritative**: `modelSelections` carries one entry per
 * pick, in the order the user arranged them, each naming its own runtime. A
 * native entry and a BYOK entry of the same base model are two different
 * identities and therefore two different variants. Nothing here collapses,
 * dedupes across runtimes or reorders what was chosen.
 *
 * It is pure: the requests themselves live in `integrations-client.ts` and
 * `model-catalog-client.ts`.
 */

import {
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  MAX_MODEL_SELECTIONS,
  baseModelOfSelectionId,
  byokSelectionId,
  configuredWireModels,
  isByokSelectionId,
  normalizeCopilotSdkByokSettings,
  parseByokSelectionId,
  runtimeOfSelectionId,
  toByokWirePayload,
  type ByokProvider,
  type CopilotSdkByokSettings,
  type CopilotSdkByokWirePayload,
  type ModelRuntime,
} from "./copilot-sdk-byok";
import {
  activeMcpServers,
  normalizeMcpServers,
  toMcpWirePayload,
  type McpServerConfig,
  type McpServerWirePayload,
} from "./mcp-servers";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  isWebSearchUsable,
  normalizeWebSearchSettings,
  toWebSearchWirePayload,
  type WebSearchSettings,
  type WebSearchWirePayload,
} from "./web-search";

export interface IntegrationDiagnostic {
  scope: "byok" | "mcp";
  code: string;
  message: string;
  target?: string;
}

/** The fields this feature adds to Settings, and nothing else. */
export interface IntegrationSettingsSlice {
  copilotSdkByok: CopilotSdkByokSettings;
  mcpServers: McpServerConfig[];
  /**
   * Provider-neutral web search.
   *
   * Additive and independent: it does not read a model provider's key, does
   * not change which model runs, and is off until the user switches it on.
   */
  webSearch: WebSearchSettings;
}

export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettingsSlice = {
  copilotSdkByok: DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  mcpServers: [],
  webSearch: DEFAULT_WEB_SEARCH_SETTINGS,
};

/**
 * The part of the slice the BYOK/MCP surface works with.
 *
 * Web search is a separate feature with its own endpoint and its own
 * validator, so the BYOK card, the MCP card and the model picker keep taking
 * exactly what they need rather than a whole settings object they would have
 * to invent a web-search block for.
 */
export type ByokMcpSettingsSlice = Pick<
  IntegrationSettingsSlice,
  "copilotSdkByok" | "mcpServers"
>;

/**
 * Fill in both fields from a settings blob of any age.
 *
 * Nothing existing is read or rewritten: a blob that predates this feature
 * simply gets the defaults, which are "off" and "no servers".
 */
export function withIntegrationDefaults<T extends object>(
  settings: T
): Omit<T, keyof IntegrationSettingsSlice> & IntegrationSettingsSlice {
  const stored = settings as Partial<IntegrationSettingsSlice>;
  return {
    ...settings,
    copilotSdkByok: normalizeCopilotSdkByokSettings(stored.copilotSdkByok),
    mcpServers: normalizeMcpServers(stored.mcpServers),
    webSearch: normalizeWebSearchSettings(stored.webSearch),
  };
}

/** True when normalising would change something, so an effect can skip a write. */
export function needsIntegrationNormalization(settings: object): boolean {
  const stored = settings as Partial<IntegrationSettingsSlice>;
  const normalized = withIntegrationDefaults(settings);
  return (
    JSON.stringify(normalized.copilotSdkByok) !==
      JSON.stringify(stored.copilotSdkByok) ||
    JSON.stringify(normalized.mcpServers) !== JSON.stringify(stored.mcpServers) ||
    JSON.stringify(normalized.webSearch) !== JSON.stringify(stored.webSearch)
  );
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

export function parseIntegrationDiagnostics(
  raw: unknown
): IntegrationDiagnostic[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): IntegrationDiagnostic[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const item = entry as Record<string, unknown>;
    if (item.scope !== "byok" && item.scope !== "mcp") return [];
    if (typeof item.message !== "string" || item.message.length === 0) return [];
    return [
      {
        scope: item.scope,
        code: typeof item.code === "string" ? item.code : "unknown",
        message: item.message,
        ...(typeof item.target === "string" ? { target: item.target } : {}),
      },
    ];
  });
}

/** The connection as the backend describes it back: never a credential. */
export interface ByokConnectionSummary {
  enabled: boolean;
  provider: string;
  baseProvider: string;
  wireApi: string;
  wireModel: string | null;
  wireModels: string[];
  baseUrlHost: string | null;
  hasApiKey: boolean;
  hasBearerToken: boolean;
  azureApiVersion: string | null;
  usable: boolean;
  reason: string | null;
  /** Set when the endpoint serves its own model rather than a catalog one. */
  customSelectionId: string | null;
  customSelectionIds: string[];
}

function parseByokSummary(raw: unknown): ByokConnectionSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const nullableText = (value: unknown) =>
    typeof value === "string" ? value : null;
  return {
    enabled: item.enabled === true,
    provider: text(item.provider),
    baseProvider: text(item.baseProvider),
    wireApi: text(item.wireApi),
    wireModel: nullableText(item.wireModel),
    wireModels: stringList(item.wireModels),
    baseUrlHost: nullableText(item.baseUrlHost),
    hasApiKey: item.hasApiKey === true,
    hasBearerToken: item.hasBearerToken === true,
    azureApiVersion: nullableText(item.azureApiVersion),
    usable: item.usable === true,
    reason: nullableText(item.reason),
    customSelectionId: nullableText(item.customSelectionId),
    customSelectionIds: stringList(item.customSelectionIds),
  };
}

export interface IntegrationValidationResult {
  valid: boolean;
  error: string | null;
  byokEnabled: boolean;
  /** Secret-free metadata, or null when nothing is configured. */
  byok: ByokConnectionSummary | null;
  /** The run identities this connection would make selectable. */
  byokSelectionIds: string[];
  mcpServers: Record<string, unknown>[];
  activeMcpServers: string[];
  diagnostics: IntegrationDiagnostic[];
}

export const EMPTY_INTEGRATION_VALIDATION: IntegrationValidationResult = {
  valid: false,
  error: null,
  byokEnabled: false,
  byok: null,
  byokSelectionIds: [],
  mcpServers: [],
  activeMcpServers: [],
  diagnostics: [],
};

function stringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function parseIntegrationValidation(
  raw: unknown
): IntegrationValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ...EMPTY_INTEGRATION_VALIDATION, error: "Unexpected response." };
  }
  const payload = raw as Record<string, unknown>;
  return {
    valid: payload.valid === true,
    error: typeof payload.error === "string" ? payload.error : null,
    byokEnabled: payload.byok_enabled === true,
    byok: parseByokSummary(payload.byok),
    byokSelectionIds: stringList(payload.byok_selection_ids),
    mcpServers: Array.isArray(payload.mcp_servers)
      ? payload.mcp_servers.filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" && entry !== null
        )
      : [],
    activeMcpServers: stringList(payload.active_mcp_servers),
    diagnostics: parseIntegrationDiagnostics(payload.diagnostics),
  };
}

/* -------------------------------------------------------------------------- */
/* Model selections                                                            */
/* -------------------------------------------------------------------------- */

/** One `modelSelections` entry: the run identity plus how it executes. */
export interface ModelSelectionEntry {
  id: string;
  baseModel: string;
  runtime: ModelRuntime;
  /**
   * The endpoint's own model name, for a custom BYOK identity.
   *
   * The `id` is already authoritative - the backend parses provider, runtime
   * and the exact name out of it. This is sent alongside so the backend's
   * explicit fallback path (`runtime` + `provider` + `wireModel`) can still
   * resolve the selection if the identity ever fails to parse.
   */
  wireModel?: string;
  provider?: ByokProvider;
}

/**
 * Turn a saved selection into the per-selection run identities.
 *
 * Every id carries its own runtime, so this is a pure derivation: a native id
 * *is* its base model, and a BYOK id names its provider and either a base
 * model or the endpoint model it addresses. Order is preserved and entries are
 * de-duplicated **by id only**, which is what keeps a native pick and the BYOK
 * pick of the same base model as two variants.
 *
 * A BYOK id the browser cannot parse is dropped rather than downgraded to
 * native - running someone's prompt on a different runtime than they asked for
 * is worse than running one fewer option.
 */
export function buildModelSelections(
  selection: readonly string[]
): ModelSelectionEntry[] {
  const entries: ModelSelectionEntry[] = [];
  const seen = new Set<string>();

  for (const id of selection) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (seen.has(id)) continue;
    const baseModel = baseModelOfSelectionId(id);
    if (baseModel === null) continue;
    seen.add(id);

    const parsed = parseByokSelectionId(id);
    const entry: ModelSelectionEntry = {
      id,
      baseModel,
      runtime: runtimeOfSelectionId(id),
    };
    if (parsed?.isCustom && parsed.wireModel) {
      entry.wireModel = parsed.wireModel;
      entry.provider = parsed.provider;
    }
    entries.push(entry);
    if (entries.length >= MAX_MODEL_SELECTIONS) break;
  }

  return entries;
}

/** Selected ids that address the BYOK runtime, in order. */
export function byokSelectionIdsIn(selection: readonly string[]): string[] {
  return selection.filter(isByokSelectionId);
}

/**
 * BYOK picks the current connection can no longer serve.
 *
 * A connection that was switched off, or pointed at another provider, leaves
 * saved picks behind. They are reported rather than quietly dropped, so the fix
 * is to repair the connection instead of losing the selection.
 */
export function unavailableByokSelections(
  selection: readonly string[],
  settings: ByokMcpSettingsSlice
): string[] {
  const connection = settings.copilotSdkByok;
  return byokSelectionIdsIn(selection).filter((id) => {
    const parsed = parseByokSelectionId(id);
    if (parsed === null) return true;
    if (!connection.enabled) return true;
    if (parsed.provider !== connection.provider) return true;
    // A custom identity names one exact endpoint model. Pointing the
    // connection at a different one leaves the old pick unserviceable, and the
    // backend refuses it for the same reason.
    if (parsed.isCustom) {
      return !configuredWireModels(connection).includes(parsed.wireModel ?? "");
    }
    if (configuredWireModels(connection).length > 0) return true;
    return false;
  });
}

/* -------------------------------------------------------------------------- */
/* Payloads                                                                    */
/* -------------------------------------------------------------------------- */

export interface IntegrationWirePayload {
  copilotSdkByok: CopilotSdkByokWirePayload;
  mcpServers: McpServerWirePayload[];
  webSearch: WebSearchWirePayload;
}

/**
 * The integration block every request carries.
 *
 * The same block serves a first run, a retry and the catalog: it describes what
 * is configured, not what this run picked.
 */
export function buildIntegrationWirePayload(
  settings: IntegrationSettingsSlice
): IntegrationWirePayload {
  return {
    copilotSdkByok: toByokWirePayload(settings.copilotSdkByok),
    mcpServers: toMcpWirePayload(settings.mcpServers),
    webSearch: toWebSearchWirePayload(settings.webSearch),
  };
}

/**
 * Same payload, for `/api/integrations/validate`.
 *
 * That endpoint checks the BYOK connection and the MCP list only; web search
 * has its own validator at `/api/web-search/validate`, so the block is left
 * out rather than sent and ignored.
 */
export function buildIntegrationValidationPayload(
  settings: ByokMcpSettingsSlice
): Omit<IntegrationWirePayload, "webSearch"> {
  return {
    copilotSdkByok: toByokWirePayload(settings.copilotSdkByok),
    mcpServers: toMcpWirePayload(settings.mcpServers),
  };
}

/**
 * A copy with every credential removed, for anything that is written down.
 *
 * Commit snapshots, project history and generation context must never carry a
 * key, a bearer token, a search-provider key, an MCP env value or a request
 * header. The shape is kept so a snapshot can still say *what* was configured.
 */
export function stripIntegrationSecrets(
  settings: IntegrationSettingsSlice
): IntegrationWirePayload {
  return {
    copilotSdkByok: toByokWirePayload(settings.copilotSdkByok, {
      includeSecrets: false,
    }),
    mcpServers: toMcpWirePayload(settings.mcpServers, { includeSecrets: false }),
    webSearch: toWebSearchWirePayload(settings.webSearch, {
      includeSecrets: false,
    }),
  };
}

export interface GenerationIntegrationPayload extends IntegrationWirePayload {
  /** The per-selection run identities for this run. */
  modelSelections: ModelSelectionEntry[];
  /** The same selection as plain ids, for backward compatibility. */
  selectedModels: string[];
  byokSelectionIds: string[];
  unavailableByokIds: string[];
}

/**
 * Everything the generate socket needs for one run.
 *
 * `modelSelections` is authoritative; `selectedModels` is sent alongside it so
 * an older backend still understands the request.
 */
export function buildGenerationIntegrationPayload(
  settings: IntegrationSettingsSlice,
  selection: readonly string[]
): GenerationIntegrationPayload {
  const modelSelections = buildModelSelections(selection);
  return {
    modelSelections,
    selectedModels: modelSelections.map((entry) => entry.id),
    byokSelectionIds: byokSelectionIdsIn(selection),
    unavailableByokIds: unavailableByokSelections(selection, settings),
    ...buildIntegrationWirePayload(settings),
  };
}

/* -------------------------------------------------------------------------- */
/* Runtime scope                                                               */
/* -------------------------------------------------------------------------- */

export interface McpRuntimeScope {
  /** Any server is enabled *and* trusted, so MCP can run at all. */
  hasActiveServers: boolean;
  activeServerNames: string[];
  /** Copilot subscription variants always get MCP when servers are active. */
  appliesToCopilot: boolean;
  /** BYOK variants get MCP too, because they run on the SDK. */
  appliesToByok: boolean;
  /** Selected ids whose variant will not see MCP tools. */
  excludedModelIds: string[];
}

/**
 * Which variants of a run will actually see MCP tools.
 *
 * MCP is an SDK feature, so only Copilot subscription models and BYOK
 * selections get it. A native OpenAI/Anthropic/Gemini variant runs on its own
 * client and never sees an MCP tool, which is worth stating in the UI rather
 * than leaving people to infer it from an empty activity list.
 */
export function mcpRuntimeScope(
  settings: ByokMcpSettingsSlice,
  selection: readonly string[],
  providerOf: (modelId: string) => string | undefined
): McpRuntimeScope {
  const active = activeMcpServers(settings.mcpServers);
  const byokIds = new Set(byokSelectionIdsIn(selection));

  const excludedModelIds = selection.filter((modelId) => {
    if (byokIds.has(modelId)) return false;
    const provider = providerOf(modelId);
    if (provider === "copilot" || provider === "sdk-byok") return false;
    return provider !== undefined;
  });

  return {
    hasActiveServers: active.length > 0,
    activeServerNames: active.map((server) => server.name.trim()).filter(Boolean),
    appliesToCopilot: active.length > 0,
    appliesToByok: active.length > 0 && byokIds.size > 0,
    excludedModelIds,
  };
}

/**
 * Whether this run's canonical web search is active, and what that means for
 * Copilot's built-in search.
 *
 * Unlike MCP, `search_web` is runtime-neutral: it is a shot2code tool, so
 * every selected model sees it. The only interaction worth stating is that it
 * replaces Copilot's built-in `web_search` rather than running beside it.
 */
export function webSearchRuntimeScope(
  settings: IntegrationSettingsSlice,
  copilotBuiltInEnabled: boolean
): {
  canonicalActive: boolean;
  copilotBuiltInActive: boolean;
  reason: string | null;
} {
  const canonicalActive = isWebSearchUsable(settings.webSearch);
  return {
    canonicalActive,
    copilotBuiltInActive: copilotBuiltInEnabled && !canonicalActive,
    reason: canonicalActive
      ? null
      : (settings.webSearch.enabled
          ? "Web search is enabled but not usable yet."
          : null),
  };
}

/** One sentence for the picker about where MCP tools will and will not appear. */
export function describeMcpScope(scope: McpRuntimeScope): string {
  if (!scope.hasActiveServers) {
    return "No MCP server is enabled and trusted, so no MCP tools are offered.";
  }
  const names = scope.activeServerNames.join(", ");
  const excluded =
    scope.excludedModelIds.length > 0
      ? ` Models on their own API (${scope.excludedModelIds.length}) do not see them.`
      : "";
  return `MCP tools from ${names} are offered to GitHub Copilot and Copilot SDK BYOK options only.${excluded}`;
}

/** Human-readable label for a selected id, for hints and warnings. */
export function describeSelectionEntry(entry: string): string {
  const parsed = parseByokSelectionId(entry);
  // Mirrors the backend's own catalog label, so Settings, the picker and a
  // warning all name a custom endpoint model the same way.
  if (parsed) {
    return `${parsed.wireModel ?? parsed.baseModelId} via ${parsed.provider}`;
  }
  return entry;
}

/** The BYOK identity for a base model on the configured connection. */
export function byokIdForBaseModel(
  settings: ByokMcpSettingsSlice,
  baseModelId: string
): string {
  return byokSelectionId(settings.copilotSdkByok.provider, baseModelId);
}

/* -------------------------------------------------------------------------- */
/* MCP activity                                                                */
/* -------------------------------------------------------------------------- */

export const MCP_TOOL_PREFIX = "MCP · ";

export interface McpToolName {
  server: string;
  tool: string;
}

/**
 * Split the `MCP · <server> · <tool>` name the backend streams.
 *
 * Returns null for shot2code's own tools so the activity list can keep its
 * existing rendering untouched.
 */
export function parseMcpToolName(
  toolName: string | undefined
): McpToolName | null {
  if (!toolName || !toolName.startsWith(MCP_TOOL_PREFIX)) return null;
  const parts = toolName.slice(MCP_TOOL_PREFIX.length).split(" · ");
  if (parts.length < 2) return null;
  const server = parts[0].trim();
  const tool = parts.slice(1).join(" · ").trim();
  if (!server || !tool) return null;
  return { server, tool };
}

export function isMcpToolName(toolName: string | undefined): boolean {
  return parseMcpToolName(toolName) !== null;
}
