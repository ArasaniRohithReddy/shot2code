import { HTTP_BACKEND_URL } from "../config";

/**
 * Browser-side view of the GitHub Copilot sign-in flow.
 *
 * The backend delegates to the official Copilot CLI web flow (falling back to
 * the GitHub CLI), which opens a browser and writes the credential into that
 * tool's own store. shot2code never receives, reads or persists the token - it
 * only learns whether a session now exists. Everything this module can report
 * therefore comes from the poll response, never from a token.
 *
 * Parsing is defensive on purpose: this endpoint is new, so an older backend
 * answers 404 and must degrade to "unavailable" instead of throwing.
 */

export const COPILOT_LOGIN_STATUSES = [
  "idle",
  "starting",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "unavailable",
] as const;

export type CopilotLoginStatus = (typeof COPILOT_LOGIN_STATUSES)[number];

export const COPILOT_LOGIN_METHODS = ["copilot-cli", "github-cli"] as const;

export type CopilotLoginMethod = (typeof COPILOT_LOGIN_METHODS)[number];

export interface CopilotLoginState {
  status: CopilotLoginStatus;
  /** Which CLI is driving the flow, when the backend has chosen one. */
  method: CopilotLoginMethod | null;
  /** Backend-authored, already safe to show. Never contains a token. */
  message: string;
  /** The GitHub account that ended up signed in, when known. */
  login: string | null;
  canCancel: boolean;
  /** Where to get the missing CLI. Only ever an https URL. */
  installUrl: string | null;
}

export const IDLE_COPILOT_LOGIN: CopilotLoginState = {
  status: "idle",
  method: null,
  message: "",
  login: null,
  canCancel: false,
  installUrl: null,
};

const METHOD_LABELS: Record<CopilotLoginMethod, string> = {
  "copilot-cli": "GitHub Copilot CLI",
  "github-cli": "GitHub CLI",
};

export function describeCopilotLoginMethod(
  method: CopilotLoginMethod | null
): string | null {
  return method ? METHOD_LABELS[method] : null;
}

/** Statuses where the flow is live and the UI should keep polling. */
export function isPollingLoginStatus(status: CopilotLoginStatus): boolean {
  return status === "starting" || status === "waiting";
}

/** Statuses where the flow has stopped for good. */
export function isTerminalLoginStatus(status: CopilotLoginStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "unavailable"
  );
}

/**
 * Only https links are ever rendered.
 *
 * The install hint is a link the user is invited to click, so an http or
 * (worse) javascript/file URL coming back from a compromised or simply buggy
 * backend must not become a clickable target.
 */
export function isTrustedInstallUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseCopilotLoginState(raw: unknown): CopilotLoginState {
  if (typeof raw !== "object" || raw === null) return IDLE_COPILOT_LOGIN;
  const payload = raw as Record<string, unknown>;
  const status = COPILOT_LOGIN_STATUSES.includes(
    payload.status as CopilotLoginStatus
  )
    ? (payload.status as CopilotLoginStatus)
    : "idle";
  const method = COPILOT_LOGIN_METHODS.includes(
    payload.method as CopilotLoginMethod
  )
    ? (payload.method as CopilotLoginMethod)
    : null;
  const login = asString(payload.login).trim();

  return {
    status,
    method,
    message: asString(payload.message),
    login: login.length > 0 ? login : null,
    // Cancelling something that has already stopped would be a dead control.
    canCancel: payload.canCancel === true && !isTerminalLoginStatus(status),
    installUrl: isTrustedInstallUrl(payload.installUrl)
      ? payload.installUrl
      : null,
  };
}

/**
 * A backend without this route is not an error the user can act on.
 *
 * It means this build predates browser sign-in, so the existing ladder - `gh
 * auth login`, the `copilot` CLI, or a pasted token - is still the way in.
 */
const MISSING_ROUTE_STATE: CopilotLoginState = {
  status: "unavailable",
  method: null,
  message:
    "This backend does not offer browser sign-in. Run gh auth login or copilot in a terminal, or paste a token below.",
  login: null,
  canCancel: false,
  installUrl: null,
};

async function request(
  method: "POST" | "GET" | "DELETE",
  signal?: AbortSignal
): Promise<CopilotLoginState> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/copilot/login`, {
    method,
    signal,
    ...(method === "POST"
      ? { headers: { "Content-Type": "application/json" }, body: "{}" }
      : {}),
  });
  if (response.status === 404 || response.status === 405) {
    return MISSING_ROUTE_STATE;
  }
  if (!response.ok) {
    // The body is still the backend's own wording when it bothered to send
    // one, which beats a bare status code.
    const fallback = await response
      .json()
      .then((body) => parseCopilotLoginState(body))
      .catch(() => null);
    if (fallback && fallback.message) return fallback;
    throw new Error(`Sign-in could not be started (${response.status})`);
  }
  return parseCopilotLoginState(await response.json());
}

/** Begin the browser flow. The backend opens the CLI's own login page. */
export function startCopilotLogin(
  options: { signal?: AbortSignal } = {}
): Promise<CopilotLoginState> {
  return request("POST", options.signal);
}

/** Ask where the in-flight flow has got to. */
export function pollCopilotLogin(
  options: { signal?: AbortSignal } = {}
): Promise<CopilotLoginState> {
  return request("GET", options.signal);
}

/** Abandon the in-flight flow. */
export function cancelCopilotLogin(
  options: { signal?: AbortSignal } = {}
): Promise<CopilotLoginState> {
  return request("DELETE", options.signal);
}

/** How long to wait between polls while the browser flow is open. */
export const COPILOT_LOGIN_POLL_INTERVAL_MS = 1500;
