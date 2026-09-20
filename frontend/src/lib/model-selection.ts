import type { Settings } from "../types";
import type { IntegrationDiagnostic } from "./integrations";
import { parseIntegrationDiagnostics } from "./integrations";
import {
  MODEL_RUNTIMES,
  parseByokSelectionId,
  runtimeOfSelectionId,
  type ModelRuntime,
} from "./copilot-sdk-byok";

/**
 * The provider/model catalog the pickers render.
 *
 * The backend owns what exists: GitHub Copilot is discovered live from the
 * signed-in plan, the API-key providers come from a validated list maintained
 * with shot2code, and `sdk-byok` is one run identity per base model a usable
 * BYOK connection can serve. The native groups are completely unaffected by
 * BYOK: they still need their own direct key and their credential source is
 * never `sdk-byok`.
 *
 * This module stays free of I/O and app config so it can be reasoned about on
 * its own; the request itself lives in `model-catalog-client.ts`.
 */

export type ProviderId =
  | "copilot"
  | "openai"
  | "anthropic"
  | "gemini"
  | "sdk-byok";

export type ModelStatus = "available" | "deprecated";

export interface CatalogModel {
  id: string;
  provider: ProviderId;
  label: string;
  family: string;
  effort?: string | null;
  status: ModelStatus;
  recommended: boolean;
  supports_video: boolean;
  /**
   * How this entry executes.
   *
   * A native entry is a direct provider model, exactly as before BYOK existed.
   * A `copilot-byok` entry is a separate run identity that borrows
   * `base_model_id`'s capabilities - picking it never picks the direct model,
   * and both can be picked at once.
   */
  runtime: ModelRuntime;
  base_model_id?: string | null;
}

export interface CatalogProvider {
  id: ProviderId;
  label: string;
  available: boolean;
  credential_label: string;
  credential_source?: CredentialSource | null;
  source_kind: "discovered" | "curated" | "configured";
  detail: string;
  models: CatalogModel[];
  unsupported_model_ids: string[];
}

/**
 * Where a provider's credential came from. Never the credential itself.
 *
 * `sdk-byok` means the backend can reach that provider through a Copilot SDK
 * BYOK connection rather than its own API key.
 */
export type CredentialSource =
  | "request"
  | "environment"
  | "session"
  | "sdk-byok";

const CREDENTIAL_SOURCES: CredentialSource[] = [
  "request",
  "environment",
  "session",
  "sdk-byok",
];

const CREDENTIAL_SOURCE_LABELS: Record<CredentialSource, string> = {
  request: "Your saved key",
  environment: "Backend .env",
  session: "Signed in",
  "sdk-byok": "Copilot SDK BYOK",
};

export function credentialSourceLabel(
  source: CredentialSource | null | undefined
): string | null {
  return source ? CREDENTIAL_SOURCE_LABELS[source] : null;
}

export interface ModelCatalog {
  providers: CatalogProvider[];
  stale_selection: string[];
  /** Why part of the integration configuration is not in play, safely worded. */
  integration_diagnostics: IntegrationDiagnostic[];
}

export const EMPTY_CATALOG: ModelCatalog = {
  providers: [],
  stale_selection: [],
  integration_diagnostics: [],
};

export interface CatalogCredentials {
  openAiApiKey?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
  copilotGithubToken?: string | null;
}

const PROVIDER_IDS: ProviderId[] = [
  "copilot",
  "openai",
  "anthropic",
  "gemini",
  "sdk-byok",
];

function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" && PROVIDER_IDS.includes(value as ProviderId)
  );
}

function parseModel(raw: unknown): CatalogModel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const model = raw as Record<string, unknown>;
  if (typeof model.id !== "string" || !isProviderId(model.provider)) return null;
  return {
    id: model.id,
    provider: model.provider,
    label: typeof model.label === "string" ? model.label : model.id,
    family: typeof model.family === "string" ? model.family : model.id,
    effort: typeof model.effort === "string" ? model.effort : null,
    status: model.status === "deprecated" ? "deprecated" : "available",
    recommended: model.recommended === true,
    supports_video: model.supports_video === true,
    // An older backend omits the runtime; the id still says which it is.
    runtime: MODEL_RUNTIMES.includes(model.runtime as ModelRuntime)
      ? (model.runtime as ModelRuntime)
      : runtimeOfSelectionId(model.id),
    base_model_id:
      typeof model.base_model_id === "string" ? model.base_model_id : null,
  };
}

export function parseModelCatalog(raw: unknown): ModelCatalog {
  if (typeof raw !== "object" || raw === null) return EMPTY_CATALOG;
  const payload = raw as Record<string, unknown>;
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const staleSelection = Array.isArray(payload.stale_selection)
    ? payload.stale_selection.filter(
        (value): value is string => typeof value === "string"
      )
    : [];

  return {
    providers: providers.flatMap((entry): CatalogProvider[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const provider = entry as Record<string, unknown>;
      if (!isProviderId(provider.id)) return [];
      const models = Array.isArray(provider.models) ? provider.models : [];
      return [
        {
          id: provider.id,
          label:
            typeof provider.label === "string" ? provider.label : provider.id,
          available: provider.available === true,
          credential_label:
            typeof provider.credential_label === "string"
              ? provider.credential_label
              : "",
          credential_source: CREDENTIAL_SOURCES.includes(
            provider.credential_source as CredentialSource
          )
            ? (provider.credential_source as CredentialSource)
            : null,
          source_kind:
            provider.source_kind === "discovered" ||
            provider.source_kind === "configured"
              ? provider.source_kind
              : "curated",
          detail: typeof provider.detail === "string" ? provider.detail : "",
          models: models
            .map(parseModel)
            .filter((model): model is CatalogModel => model !== null),
          unsupported_model_ids: Array.isArray(provider.unsupported_model_ids)
            ? provider.unsupported_model_ids.filter(
                (value): value is string => typeof value === "string"
              )
            : [],
        },
      ];
    }),
    stale_selection: staleSelection,
    integration_diagnostics: parseIntegrationDiagnostics(
      payload.integration_diagnostics
    ),
  };
}

export function availableProviders(catalog: ModelCatalog): CatalogProvider[] {
  return catalog.providers.filter((provider) => provider.available);
}

export function catalogModelIds(catalog: ModelCatalog): Set<string> {
  return new Set(
    catalog.providers.flatMap((provider) =>
      provider.models.map((model) => model.id)
    )
  );
}

export function findCatalogModel(
  catalog: ModelCatalog,
  modelId: string
): CatalogModel | undefined {
  for (const provider of catalog.providers) {
    const match = provider.models.find((model) => model.id === modelId);
    if (match) return match;
  }
  return undefined;
}

/**
 * Split a saved selection into picks that still work and picks that do not.
 *
 * A selection is only trusted against a catalog that actually loaded; an empty
 * one means "backend unreachable", and discarding every pick on that basis
 * would quietly reset a user's choices. `knownExtraIds` carries ids the catalog
 * is not offering but the browser still recognises - a BYOK profile that is
 * configured and merely incomplete - so fixing the profile is offered instead
 * of deleting the pick.
 */
export function partitionSelection(
  selection: string[],
  catalog: ModelCatalog,
  knownExtraIds: ReadonlySet<string> = new Set()
): { valid: string[]; stale: string[] } {
  const unique = [...new Set(selection)];
  if (catalog.providers.length === 0) {
    return { valid: unique, stale: [] };
  }
  const known = catalogModelIds(catalog);
  return {
    valid: unique.filter((id) => known.has(id) || knownExtraIds.has(id)),
    stale: unique.filter((id) => !known.has(id) && !knownExtraIds.has(id)),
  };
}

export interface VariantPlanContext {
  generationType: "create" | "update";
  inputMode: "image" | "video" | "text";
}

/** Mirrors `variant_limit` in backend/routes/generate_code.py. */
export function variantLimit(context: VariantPlanContext): number {
  if (context.inputMode === "video") return 2;
  if (context.generationType === "update") return 2;
  return 4;
}

/** How many options a run will produce: one per pick, capped by the limit. */
export function plannedVariantCount(
  selection: string[],
  context: VariantPlanContext
): number {
  const limit = variantLimit(context);
  if (selection.length === 0) return limit;
  return Math.min(selection.length, limit);
}

/** Short trigger text for the compact picker. */
export function describeSelection(
  selection: string[],
  catalog: ModelCatalog
): string {
  if (selection.length === 0) return "Auto";
  if (selection.length === 1) {
    const id = selection[0];
    const model = findCatalogModel(catalog, id);
    if (model) {
      return model.runtime === "copilot-byok"
        ? `BYOK · ${model.family || model.label}`
        : model.label;
    }
    if (runtimeOfSelectionId(id) === "copilot-byok") {
      // A custom identity URL-encodes the endpoint model, so the raw tail can
      // read as an escaped string. Parsing gives back the real name.
      const parsed = parseByokSelectionId(id);
      const name =
        parsed?.wireModel ??
        parsed?.baseModelId ??
        id.slice(id.lastIndexOf("/") + 1);
      return `BYOK · ${name}`;
    }
    return id.replace("copilot/", "");
  }
  return `${selection.length} models`;
}

/** Accessible description of what the current selection will do. */
export function describeSelectionHint(
  selection: string[],
  context: VariantPlanContext
): string {
  const limit = variantLimit(context);
  if (selection.length === 0) {
    return `Automatic: shot2code picks ${limit} option${limit === 1 ? "" : "s"}.`;
  }
  const used = Math.min(selection.length, limit);
  const base = `${used} option${used === 1 ? "" : "s"}, one per selected model.`;
  if (selection.length > limit) {
    return `${base} Only the first ${limit} selected models are used.`;
  }
  return base;
}

export interface ProviderGroup {
  provider: CatalogProvider;
  models: CatalogModel[];
}

/**
 * Providers that can actually be used, each with the models to show.
 *
 * Deprecated models stay hidden unless asked for or already selected, so a
 * saved pick never disappears from the list it was made in.
 */
export function groupModelsByProvider(
  catalog: ModelCatalog,
  options: {
    selection?: string[];
    includeDeprecated?: boolean;
    inputMode?: "image" | "video" | "text";
  } = {}
): ProviderGroup[] {
  const selected = new Set(options.selection ?? []);
  return availableProviders(catalog)
    .map((provider) => ({
      provider,
      models: provider.models.filter((model) => {
        if (options.inputMode === "video" && !model.supports_video) return false;
        if (model.status !== "deprecated") return true;
        return options.includeDeprecated === true || selected.has(model.id);
      }),
    }))
    .filter((group) => group.models.length > 0);
}

export function hasDeprecatedModels(catalog: ModelCatalog): boolean {
  return catalog.providers.some((provider) =>
    provider.models.some((model) => model.status === "deprecated")
  );
}

/* -------------------------------------------------------------------------- */
/* Copilot SDK BYOK entries                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The BYOK group, which the backend builds - one run identity per base model.
 *
 * It sits beside the native providers rather than inside them, and never
 * changes their availability or their credential source. A native model and
 * the BYOK identity that borrows it are two separate entries with two separate
 * ids, so both can be picked for one run and each keeps its own runtime.
 */
export function byokProviderGroup(
  catalog: ModelCatalog
): CatalogProvider | undefined {
  return catalog.providers.find((provider) => provider.id === "sdk-byok");
}

/** Run identities the BYOK group currently offers. */
export function byokCatalogSelectionIds(catalog: ModelCatalog): Set<string> {
  return new Set(byokProviderGroup(catalog)?.models.map((m) => m.id) ?? []);
}

/** The provider a selected id belongs to, BYOK identities included. */
export function selectionProviderOf(
  catalog: ModelCatalog,
  modelId: string
): ProviderId | undefined {
  return findCatalogModel(catalog, modelId)?.provider;
}

/** The runtime a selected id will execute on, from the catalog or its id. */
export function selectionRuntimeOf(
  catalog: ModelCatalog,
  modelId: string
): ModelRuntime {
  return findCatalogModel(catalog, modelId)?.runtime ?? runtimeOfSelectionId(modelId);
}

/**
 * Bring a persisted settings blob onto the current model-selection field.
 *
 * `copilotModels` held the same list of ids under an older name, so it is moved
 * across verbatim. `codeGenerationModel` was a single-model default that every
 * install carried whether or not the user ever chose it, so it is only treated
 * as a real choice when it differs from that historical default - otherwise
 * upgrading would silently pin everyone to one Gemini model.
 */
export const LEGACY_DEFAULT_CODE_GENERATION_MODEL =
  "gemini-3-flash-preview (minimal thinking)";

export interface MigratableSettings {
  selectedModels?: string[] | null;
  copilotModels?: string[] | null;
  codeGenerationModel?: string | null;
}

export function migrateModelSelection(settings: MigratableSettings): string[] {
  const current = (settings.selectedModels ?? []).filter(
    (id) => typeof id === "string" && id.length > 0
  );
  if (current.length > 0) return [...new Set(current)];

  const legacyCopilot = (settings.copilotModels ?? []).filter(
    (id) => typeof id === "string" && id.length > 0
  );
  if (legacyCopilot.length > 0) return [...new Set(legacyCopilot)];

  const single = settings.codeGenerationModel;
  if (
    typeof single === "string" &&
    single.length > 0 &&
    single !== LEGACY_DEFAULT_CODE_GENERATION_MODEL
  ) {
    return [single];
  }

  return [];
}

/** Apply the migration to a settings object, leaving it alone when no-op. */
export function withMigratedModelSelection<T extends MigratableSettings>(
  settings: T
): T {
  const migrated = migrateModelSelection(settings);
  const current = settings.selectedModels ?? [];
  const unchanged =
    migrated.length === current.length &&
    migrated.every((id, index) => id === current[index]);
  if (unchanged && (settings.copilotModels ?? []).length === 0) {
    return settings;
  }
  return { ...settings, selectedModels: migrated, copilotModels: [] };
}

export type ProviderCredentialSettings = Pick<
  Settings,
  "openAiApiKey" | "anthropicApiKey" | "geminiApiKey" | "copilotGithubToken"
>;

export function credentialsFromSettings(
  settings: ProviderCredentialSettings
): CatalogCredentials {
  return {
    openAiApiKey: settings.openAiApiKey,
    anthropicApiKey: settings.anthropicApiKey,
    geminiApiKey: settings.geminiApiKey,
    copilotGithubToken: settings.copilotGithubToken,
  };
}
