import { useState } from "react";
import { LuBrain, LuRefreshCw } from "react-icons/lu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import ModelCatalogPicker from "./ModelCatalogPicker";
import { useModelCatalog } from "../../hooks/useModelCatalog";
import {
  describeSelection,
  describeSelectionHint,
  selectionProviderOf,
  type VariantPlanContext,
} from "../../lib/model-selection";
import {
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  type CopilotSdkByokSettings,
} from "../../lib/copilot-sdk-byok";
import { describeMcpScope, mcpRuntimeScope } from "../../lib/integrations";
import type { McpServerConfig } from "../../lib/mcp-servers";

export interface ModelSelectorProps {
  selectedModels: string[];
  setSelectedModels: (models: string[]) => void;
  githubToken?: string | null;
  openAiApiKey?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
  /** Shapes the option-count hint and hides models the mode cannot use. */
  planContext?: VariantPlanContext;
  /** The additive Copilot SDK BYOK profiles, if any are configured. */
  copilotSdkByok?: CopilotSdkByokSettings;
  /** MCP servers, so the picker can say which options will see their tools. */
  mcpServers?: McpServerConfig[];
}

/**
 * Compact model picker for the composer and update toolbar.
 *
 * Every configured provider appears here, not just Copilot, so models can be
 * switched while iterating instead of only from Settings. Copilot SDK BYOK
 * profiles are entries in their own group with their own ids, so a direct model
 * and a profile based on that same model can both be picked for one run.
 */
function ModelSelector({
  selectedModels,
  setSelectedModels,
  githubToken,
  openAiApiKey,
  anthropicApiKey,
  geminiApiKey,
  planContext = { generationType: "create", inputMode: "image" },
  copilotSdkByok = DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  mcpServers = [],
}: ModelSelectorProps) {
  const [showDeprecated, setShowDeprecated] = useState(false);
  const selected = selectedModels ?? [];
  const {
    catalog,
    isLoading,
    error,
    staleModels,
    integrationDiagnostics,
    refresh,
  } = useModelCatalog({
    credentials: {
      openAiApiKey,
      anthropicApiKey,
      geminiApiKey,
      copilotGithubToken: githubToken,
    },
    selectedModels: selected,
    copilotSdkByok,
  });

  const hasProviders = catalog.providers.some((provider) => provider.available);
  // Nothing to choose from and nothing saved: stay out of the way.
  if (!hasProviders && selected.length === 0) return null;

  const toggle = (value: string) =>
    setSelectedModels(
      selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value]
    );

  const label = describeSelection(selected, catalog);
  const scope = mcpRuntimeScope(
    { copilotSdkByok, mcpServers },
    selected,
    (modelId) => selectionProviderOf(catalog, modelId)
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Models: ${label}. Choose which models generate each option`}
          title="Choose which models generate each option"
          className="flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <LuBrain aria-hidden="true" className="h-[18px] w-[18px]" />
          <span className="notranslate max-w-[140px] truncate" translate="no">
            {label}
          </span>
          {staleModels.length > 0 && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-2 sm:w-96"
      >
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <h2 className="text-xs font-semibold text-gray-700 dark:text-zinc-200">
            Models
          </h2>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isLoading}
            className="flex min-h-8 items-center gap-1.5 rounded px-2 text-xs text-violet-600 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:text-violet-400 dark:hover:bg-violet-950/30"
          >
            <LuRefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mx-2 mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </p>
        )}

        <ModelCatalogPicker
          catalog={catalog}
          selectedModels={selected}
          onToggleModel={toggle}
          onClearSelection={() => setSelectedModels([])}
          onRemoveStale={() =>
            setSelectedModels(
              selected.filter((entry) => !staleModels.includes(entry))
            )
          }
          staleModels={staleModels}
          showDeprecated={showDeprecated}
          onShowDeprecatedChange={setShowDeprecated}
          inputMode={planContext.inputMode}
          hint={describeSelectionHint(selected, planContext)}
          idPrefix="composer-model"
          compact
          integrationDiagnostics={integrationDiagnostics}
          mcpScopeNote={scope.hasActiveServers ? describeMcpScope(scope) : null}
        />
      </PopoverContent>
    </Popover>
  );
}

export default ModelSelector;
