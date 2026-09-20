import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchModelCatalog } from "../lib/model-catalog-client";
import {
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  toByokWirePayload,
  type CopilotSdkByokSettings,
} from "../lib/copilot-sdk-byok";
import type { IntegrationDiagnostic } from "../lib/integrations";
import { byokSelectionIdsIn } from "../lib/integrations";
import {
  EMPTY_CATALOG,
  byokProviderGroup,
  partitionSelection,
  type CatalogCredentials,
  type CatalogProvider,
  type ModelCatalog,
} from "../lib/model-selection";

interface UseModelCatalogOptions {
  credentials: CatalogCredentials;
  selectedModels: string[];
  /** Skip the request entirely (e.g. a closed dialog). */
  enabled?: boolean;
  /**
   * The Copilot SDK BYOK connection, when one is configured.
   *
   * It is additive: a usable connection adds the `sdk-byok` group, and no
   * native provider entry changes because of it.
   */
  copilotSdkByok?: CopilotSdkByokSettings;
}

export interface UseModelCatalogResult {
  catalog: ModelCatalog;
  isLoading: boolean;
  /** Set when the backend could not be reached; the UI stays usable. */
  error: string | null;
  /** Saved picks nothing recognises any more. */
  staleModels: string[];
  /** The backend-built BYOK group, or undefined when none is offered. */
  byokGroup: CatalogProvider | undefined;
  /** Why part of the integration configuration is not in play. */
  integrationDiagnostics: IntegrationDiagnostic[];
  refresh: () => Promise<void>;
}

/**
 * Load the provider/model catalog for the credentials this browser holds.
 *
 * Credentials are the only trigger for a refetch, so typing a key in Settings
 * re-evaluates availability without any other coupling. A failed request keeps
 * the previous catalog rather than emptying the picker.
 *
 * A BYOK pick whose connection is configured but incomplete is deliberately not
 * called stale: the fix is to finish the connection, not to delete the pick.
 */
export function useModelCatalog({
  credentials,
  selectedModels,
  enabled = true,
  copilotSdkByok = DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
}: UseModelCatalogOptions): UseModelCatalogResult {
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY_CATALOG);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    openAiApiKey,
    anthropicApiKey,
    geminiApiKey,
    copilotGithubToken,
  } = credentials;

  // Serialising the connection keeps the effect keyed on its contents rather
  // than on a fresh object identity every render. Secrets are excluded from the
  // key and replaced by a presence flag, so a credential never reaches a
  // dependency array while still triggering a refetch when one is added.
  const byokKey = JSON.stringify(
    toByokWirePayload(copilotSdkByok, { includeSecrets: false })
  );
  const byokHasCredential = Boolean(
    copilotSdkByok.apiKey || copilotSdkByok.bearerToken
  );

  const load = useCallback(
    async (refresh: boolean, signal?: AbortSignal) => {
      setIsLoading(true);
      try {
        const next = await fetchModelCatalog(
          {
            openAiApiKey,
            anthropicApiKey,
            geminiApiKey,
            copilotGithubToken,
          },
          {
            refresh,
            signal,
            copilotSdkByok: toByokWirePayload(copilotSdkByok),
          }
        );
        if (signal?.aborted) return;
        setCatalog(next);
        setError(null);
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load the model list."
        );
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      openAiApiKey,
      anthropicApiKey,
      geminiApiKey,
      copilotGithubToken,
      byokKey,
      byokHasCredential,
    ]
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [enabled, load]);

  // Ids the connection would offer if it were complete: a saved BYOK pick that
  // is merely waiting on a key is a repair job, not a stale selection.
  const configuredByokIds = useMemo(
    () => new Set(byokSelectionIdsIn(selectedModels)),
    [selectedModels]
  );

  const staleModels = useMemo(
    () => partitionSelection(selectedModels, catalog, configuredByokIds).stale,
    [selectedModels, catalog, configuredByokIds]
  );

  const refresh = useCallback(() => load(true), [load]);

  return {
    catalog,
    isLoading,
    error,
    staleModels,
    byokGroup: byokProviderGroup(catalog),
    integrationDiagnostics: catalog.integration_diagnostics,
    refresh,
  };
}
