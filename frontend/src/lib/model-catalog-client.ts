import { HTTP_BACKEND_URL } from "../config";
import type { CopilotSdkByokWirePayload } from "./copilot-sdk-byok";import {
  parseModelCatalog,
  type CatalogCredentials,
  type ModelCatalog,
} from "./model-selection";

/**
 * Ask the backend which providers and models this browser can use.
 *
 * The keys live in the browser, so they are sent with the request and used only
 * to answer "is this provider usable". They are not stored server-side and the
 * response never contains them.
 *
 * `copilotSdkByok` travels the same way and for the same reason: the backend
 * has to see the profiles to build the `sdk-byok` group and to report why one
 * is not being offered. It comes back only as entries and diagnostics, never
 * as a credential.
 */
export async function fetchModelCatalog(
  credentials: CatalogCredentials,
  options: {
    selectedModels?: string[];
    refresh?: boolean;
    signal?: AbortSignal;
    copilotSdkByok?: CopilotSdkByokWirePayload | null;
  } = {}
): Promise<ModelCatalog> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      openAiApiKey: credentials.openAiApiKey?.trim() || null,
      anthropicApiKey: credentials.anthropicApiKey?.trim() || null,
      geminiApiKey: credentials.geminiApiKey?.trim() || null,
      copilotGithubToken: credentials.copilotGithubToken?.trim() || null,
      selectedModels: options.selectedModels ?? [],
      refresh: options.refresh ?? false,
      ...(options.copilotSdkByok
        ? { copilotSdkByok: options.copilotSdkByok }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not load models (${response.status})`);
  }
  return parseModelCatalog(await response.json());
}
