import { HTTP_BACKEND_URL } from "../config";
import {
  buildIntegrationValidationPayload,
  parseIntegrationValidation,
  type IntegrationSettingsSlice,
  type IntegrationValidationResult,
} from "./integrations";

/**
 * Ask the backend whether a BYOK profile and MCP list would be accepted.
 *
 * Nothing is started and no endpoint is contacted on the way: this is the same
 * validator the generate socket runs, so the Settings dialog can report a
 * problem before a generation fails halfway through. The credential is sent
 * because the backend has to know one is present; the response only ever
 * carries presence flags, host names and diagnostics.
 */
export async function validateIntegrations(
  settings: IntegrationSettingsSlice,
  options: { signal?: AbortSignal } = {}
): Promise<IntegrationValidationResult> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/integrations/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify(buildIntegrationValidationPayload(settings)),
  });
  if (!response.ok) {
    throw new Error(`Could not check this configuration (${response.status})`);
  }
  return parseIntegrationValidation(await response.json());
}
