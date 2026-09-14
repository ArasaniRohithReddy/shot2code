import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchModelCatalog } from "../lib/model-catalog-client";
import {
  EMPTY_CATALOG,
  partitionSelection,
  type CatalogCredentials,
  type ModelCatalog,
} from "../lib/model-selection";

interface UseModelCatalogOptions {
  credentials: CatalogCredentials;
  selectedModels: string[];
  /** Skip the request entirely (e.g. a closed dialog). */
  enabled?: boolean;
}

export interface UseModelCatalogResult {
  catalog: ModelCatalog;
  isLoading: boolean;
  /** Set when the backend could not be reached; the UI stays usable. */
  error: string | null;
  /** Saved picks the catalog no longer offers. */
  staleModels: string[];
  refresh: () => Promise<void>;
}

/**
 * Load the provider/model catalog for the credentials this browser holds.
 *
 * Credentials are the only trigger for a refetch, so typing a key in Settings
 * re-evaluates availability without any other coupling. A failed request keeps
 * the previous catalog rather than emptying the picker.
 */
export function useModelCatalog({
  credentials,
  selectedModels,
  enabled = true,
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
          { refresh, signal }
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
    [openAiApiKey, anthropicApiKey, geminiApiKey, copilotGithubToken]
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [enabled, load]);

  const staleModels = useMemo(
    () => partitionSelection(selectedModels, catalog).stale,
    [selectedModels, catalog]
  );

  const refresh = useCallback(() => load(true), [load]);

  return { catalog, isLoading, error, staleModels, refresh };
}
