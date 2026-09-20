import { LuAlertTriangle, LuCheck, LuInfo } from "react-icons/lu";
import {
  credentialSourceLabel,
  groupModelsByProvider,
  hasDeprecatedModels,
  type CatalogModel,
  type CatalogProvider,
  type ModelCatalog,
} from "../../lib/model-selection";
import type { IntegrationDiagnostic } from "../../lib/integrations";
import IntegrationDiagnostics from "./IntegrationDiagnostics";

export interface ModelCatalogPickerProps {
  catalog: ModelCatalog;
  selectedModels: string[];
  onToggleModel: (modelId: string) => void;
  onClearSelection: () => void;
  onRemoveStale?: () => void;
  staleModels?: string[];
  showDeprecated: boolean;
  onShowDeprecatedChange: (show: boolean) => void;
  inputMode?: "image" | "video" | "text";
  /** Rendered under the heading; explains what the current picks will do. */
  hint: string;
  idPrefix: string;
  /** Compact mode drops the per-provider credential blurbs. */
  compact?: boolean;
  /** Why part of the BYOK/MCP configuration is not in play. */
  integrationDiagnostics?: IntegrationDiagnostic[];
  /** One line about where MCP tools appear for this selection. */
  mcpScopeNote?: string | null;
}

function ProviderNote({ provider }: { provider: CatalogProvider }) {
  if (provider.unsupported_model_ids.length === 0) return null;
  const count = provider.unsupported_model_ids.length;
  return (
    <p className="px-2 pt-1 text-[11px] leading-4 text-gray-400 dark:text-zinc-500">
      {count} model{count === 1 ? "" : "s"} your plan offers
      {count === 1 ? " is" : " are"} not supported by this version of shot2code
      yet.
    </p>
  );
}

interface ModelRowsProps {
  models: CatalogModel[];
  selected: Set<string>;
  onToggleModel: (modelId: string) => void;
  idPrefix: string;
}

function ModelRows({
  models,
  selected,
  onToggleModel,
  idPrefix,
}: ModelRowsProps) {
  return (
    <ul className="p-1">
      {models.map((model) => {
        const inputId = `${idPrefix}-${model.id}`;
        const isChecked = selected.has(model.id);
        // A BYOK entry is its own run identity: picking it never picks the
        // direct model whose capabilities it borrows.
        const isByok = model.runtime === "copilot-byok";
        return (
          <li key={model.id}>
            <label
              htmlFor={inputId}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-gray-50 focus-within:ring-2 focus-within:ring-violet-500 dark:hover:bg-zinc-800"
            >
              <input
                id={inputId}
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleModel(model.id)}
                aria-describedby={`${idPrefix}-hint`}
                className="h-4 w-4 shrink-0 accent-violet-600"
              />
              <span
                className="notranslate min-w-0 flex-1 truncate text-gray-700 dark:text-zinc-200"
                translate="no"
              >
                {model.label}
              </span>
              {isByok && (
                <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                  Your endpoint
                </span>
              )}
              {model.recommended && model.status !== "deprecated" && (
                <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                  Recommended
                </span>
              )}
              {model.status === "deprecated" && (
                <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  Deprecated
                </span>
              )}
              {isChecked && (
                <LuCheck
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
                />
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The provider-grouped model list shared by Settings and the composer.
 *
 * Each row is a real checkbox so the whole list is reachable by keyboard and
 * announced correctly; providers are `group`s with an accessible name so a
 * screen reader says which provider a model belongs to.
 */
export default function ModelCatalogPicker({
  catalog,
  selectedModels,
  onToggleModel,
  onClearSelection,
  onRemoveStale,
  staleModels = [],
  showDeprecated,
  onShowDeprecatedChange,
  inputMode,
  hint,
  idPrefix,
  compact = false,
  integrationDiagnostics = [],
  mcpScopeNote = null,
}: ModelCatalogPickerProps) {
  // The BYOK group arrives from the backend like any other provider, so the
  // same grouping applies to it: its entries are picks in their own right,
  // never a rewrite of a direct entry.
  const groups = groupModelsByProvider(catalog, {
    selection: selectedModels,
    includeDeprecated: showDeprecated,
    inputMode,
  });
  const selected = new Set(selectedModels);
  const canShowDeprecatedToggle = hasDeprecatedModels(catalog);

  if (groups.length === 0) {
    return (
      <div className="space-y-2">
        <p className="px-2 py-3 text-xs text-gray-500 dark:text-zinc-400">
          No model provider is configured yet. Add an API key, sign in with
          GitHub to use your Copilot subscription, or add a Copilot SDK BYOK
          profile.
        </p>
        <IntegrationDiagnostics
          diagnostics={integrationDiagnostics}
          idPrefix={idPrefix}
          className="px-2 pb-2"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p
        className="px-2 text-xs text-gray-500 dark:text-zinc-400"
        id={`${idPrefix}-hint`}
      >
        {hint}
      </p>

      {staleModels.length > 0 && (
        <div
          role="status"
          className="mx-2 flex flex-wrap items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <LuAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {staleModels.length} saved model
            {staleModels.length === 1 ? "" : "s"} can no longer run:{" "}
            <span className="notranslate break-words" translate="no">
              {staleModels.join(", ")}
            </span>
            . They are ignored until you remove them.
          </span>
          {onRemoveStale && (
            <button
              type="button"
              onClick={onRemoveStale}
              className="min-h-8 shrink-0 rounded px-2 font-medium underline decoration-dotted underline-offset-2 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-900/40"
            >
              Remove
            </button>
          )}
        </div>
      )}

      <div
        className={`space-y-3 overflow-y-auto ${
          compact ? "max-h-72" : "max-h-[22rem]"
        }`}
      >
        {groups.map(({ provider, models }) => {
          const sourceLabel = credentialSourceLabel(provider.credential_source);
          const isByok = provider.id === "sdk-byok";
          return (
            <section
              key={provider.id}
              role="group"
              aria-labelledby={`${idPrefix}-${provider.id}-label`}
              className={`rounded-md border ${
                isByok
                  ? "border-sky-200 dark:border-sky-900/60"
                  : "border-gray-200 dark:border-zinc-700"
              }`}
            >
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 ${
                  isByok
                    ? "border-sky-100 dark:border-sky-900/60"
                    : "border-gray-100 dark:border-zinc-800"
                }`}
              >
                <h3
                  id={`${idPrefix}-${provider.id}-label`}
                  className={`text-xs font-semibold ${
                    isByok
                      ? "text-sky-800 dark:text-sky-200"
                      : "text-gray-700 dark:text-zinc-200"
                  }`}
                >
                  {provider.label}
                </h3>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {provider.source_kind === "discovered"
                    ? "Live"
                    : provider.source_kind === "configured"
                      ? "Yours"
                      : "Curated"}
                </span>
                {isByok && (
                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                    Experimental
                  </span>
                )}
                {sourceLabel && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      provider.credential_source === "sdk-byok"
                        ? "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                        : "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {sourceLabel}
                  </span>
                )}
              </div>

              {!compact && provider.detail && (
                <p className="px-2 pt-1.5 text-[11px] leading-4 text-gray-500 dark:text-zinc-400">
                  {provider.detail}
                </p>
              )}

              <ModelRows
                models={models}
                selected={selected}
                onToggleModel={onToggleModel}
                idPrefix={idPrefix}
              />

              <ProviderNote provider={provider} />
            </section>
          );
        })}
      </div>

      {mcpScopeNote && (
        <p className="px-2 text-[11px] leading-4 text-gray-500 dark:text-zinc-400">
          {mcpScopeNote}
        </p>
      )}

      <IntegrationDiagnostics
        diagnostics={integrationDiagnostics}
        idPrefix={idPrefix}
        className="px-2"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        {canShowDeprecatedToggle ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={showDeprecated}
              onChange={(event) => onShowDeprecatedChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-violet-600"
            />
            Show deprecated models
          </label>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-zinc-500">
            <LuInfo aria-hidden="true" className="h-3.5 w-3.5" />
            One option per selected model
          </span>
        )}

        {selectedModels.length > 0 && (
          <button
            type="button"
            onClick={onClearSelection}
            className="min-h-8 rounded px-2 text-xs font-medium text-violet-600 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-400 dark:hover:bg-violet-950/30"
          >
            Reset to automatic ({selectedModels.length})
          </button>
        )}
      </div>
    </div>
  );
}
