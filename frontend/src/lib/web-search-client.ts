import { HTTP_BACKEND_URL } from "../config";
import {
  parseWebSearchSummary,
  parseWebSearchTestResult,
  toWebSearchWirePayload,
  type WebSearchSettings,
  type WebSearchSummary,
  type WebSearchTestResult,
} from "./web-search";

/**
 * Ask the backend whether this web-search block would be accepted.
 *
 * Pure on the backend too: nothing is contacted and no query leaves the
 * machine, so this is safe to run while the user is still typing a key.
 */
export async function validateWebSearch(
  settings: WebSearchSettings,
  options: { signal?: AbortSignal } = {}
): Promise<WebSearchSummary | null> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/web-search/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({ webSearch: toWebSearchWirePayload(settings) }),
  });
  if (!response.ok) {
    throw new Error(`Could not check this configuration (${response.status})`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return parseWebSearchSummary(payload.webSearch);
}

/**
 * Run one real search to prove the credential works.
 *
 * This is the only call in the feature that leaves the machine without a
 * generation, and it costs one provider credit, so it is wired to an explicit
 * button and never to a keystroke. The query is fixed and says nothing about
 * the user's project.
 */
export async function testWebSearchConnection(
  settings: WebSearchSettings,
  options: { signal?: AbortSignal } = {}
): Promise<WebSearchTestResult> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/web-search/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({ webSearch: toWebSearchWirePayload(settings) }),
  });
  if (!response.ok) {
    throw new Error(`Could not reach the backend (${response.status})`);
  }
  return parseWebSearchTestResult(await response.json());
}
