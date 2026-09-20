/**
 * MCP (Model Context Protocol) servers the user configures in Settings.
 *
 * These describe programs to spawn or endpoints to call, so every field is
 * bounded and validated here before it is shown, stored or sent. The limits and
 * the name/key rules mirror `backend/integrations/config.py` so the UI can say
 * "that will be refused" before a generation fails.
 *
 * Two switches gate a server, and both are deliberate: `enabled` is the usual
 * on/off, and `trusted` is the separate acknowledgement that shot2code may run
 * the thing and approve its tools. A read-only server stays read-only until
 * `allowWriteTools` is turned on as well.
 *
 * `env` and `headers` can hold tokens. Nothing in this module logs them, and
 * `maskSecretValue` exists so the UI can display a row without echoing one.
 */

import { containsControlCharacters } from "./utils";

export type McpTransport = "stdio" | "http" | "sse";

export const MCP_TRANSPORTS: McpTransport[] = ["stdio", "http", "sse"];

/** All mirrored from backend/integrations/config.py. */
export const MAX_MCP_SERVERS = 8;
export const MAX_MCP_ARGS = 32;
export const MAX_MCP_ENV = 32;
export const MAX_MCP_HEADERS = 16;
export const MAX_MCP_TOOLS = 64;
export const MCP_MAX_NAME_LENGTH = 64;
export const MCP_MAX_VALUE_LENGTH = 4096;
export const MCP_MAX_COMMAND_LENGTH = 512;
export const MCP_MAX_URL_LENGTH = 2048;
export const MIN_MCP_TIMEOUT_MS = 1_000;
export const MAX_MCP_TIMEOUT_MS = 600_000;

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  /** Explicit permission to start this server and approve its tools. */
  trusted: boolean;
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  workingDirectory: string | null;
  url: string | null;
  headers: Record<string, string>;
  /** Allowlist of tool names; empty means every tool the server offers. */
  tools: string[];
  timeoutMs: number | null;
  /** Read-only by default; this opts into tools that can change things. */
  allowWriteTools: boolean;
}

export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = {
  stdio: "Local program (stdio)",
  http: "HTTP",
  sse: "Server-sent events (SSE)",
};

const SAFE_SDK_NAME = /^[a-zA-Z0-9_-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

/** Key names whose values must never be rendered in the clear. */
const SECRET_KEY_HINTS = [
  "token",
  "key",
  "secret",
  "password",
  "passwd",
  "authorization",
  "auth",
  "cookie",
  "credential",
];

export function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SECRET_KEY_HINTS.some((hint) => lowered.includes(hint));
}

/** Whether a map holds a value that must not be shown without being asked for. */
export function hasSecretValues(entries: Record<string, string>): boolean {
  return Object.entries(entries).some(
    ([key, value]) => isSecretKey(key) && value.length > 0
  );
}

/** A fixed-width stand-in. Never derived from the value's own content. */
export function maskSecretValue(value: string): string {
  return value ? "••••••••" : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, limit);
}

/** Mirrors `_normalize_server_key`: the SDK-safe name a server runs under. */
export function mcpServerKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MCP_MAX_NAME_LENGTH);
}

let generatedIdCounter = 0;

/** Stable enough for a list key; the backend only needs it to be unique. */
export function createMcpServerId(): string {
  generatedIdCounter += 1;
  return `mcp-${Date.now().toString(36)}-${generatedIdCounter.toString(36)}`;
}

export function createMcpServer(
  overrides: Partial<McpServerConfig> = {}
): McpServerConfig {
  return {
    id: createMcpServerId(),
    name: "",
    enabled: false,
    trusted: false,
    transport: "stdio",
    command: null,
    args: [],
    env: {},
    workingDirectory: null,
    url: null,
    headers: {},
    tools: [],
    timeoutMs: null,
    allowWriteTools: false,
    ...overrides,
  };
}

function normalizeStringList(raw: unknown, limit: number, valueLimit: number) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => cleanText(entry, valueLimit))
    .filter((entry) => entry.length > 0)
    .slice(0, limit);
}

function normalizeStringMap(raw: unknown, limit: number) {
  if (!isPlainObject(raw)) return {};
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = cleanText(key, MCP_MAX_NAME_LENGTH);
    if (!name) continue;
    if (Object.keys(entries).length >= limit) break;
    entries[name] = cleanText(value, MCP_MAX_VALUE_LENGTH);
  }
  return entries;
}

export function normalizeMcpServer(raw: unknown): McpServerConfig {
  if (!isPlainObject(raw)) return createMcpServer();
  const transport = MCP_TRANSPORTS.includes(raw.transport as McpTransport)
    ? (raw.transport as McpTransport)
    : "stdio";
  const timeout =
    typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
      ? Math.round(raw.timeoutMs)
      : null;

  return {
    id: cleanText(raw.id, MCP_MAX_NAME_LENGTH) || createMcpServerId(),
    name: cleanText(raw.name, MCP_MAX_NAME_LENGTH),
    enabled: raw.enabled === true,
    trusted: raw.trusted === true,
    transport,
    command:
      transport === "stdio"
        ? cleanText(raw.command, MCP_MAX_COMMAND_LENGTH) || null
        : null,
    args:
      transport === "stdio"
        ? normalizeStringList(raw.args, MAX_MCP_ARGS, MCP_MAX_VALUE_LENGTH)
        : [],
    env: transport === "stdio" ? normalizeStringMap(raw.env, MAX_MCP_ENV) : {},
    workingDirectory:
      transport === "stdio"
        ? cleanText(raw.workingDirectory, MCP_MAX_VALUE_LENGTH) || null
        : null,
    url: transport === "stdio" ? null : cleanText(raw.url, MCP_MAX_URL_LENGTH) || null,
    headers:
      transport === "stdio"
        ? {}
        : normalizeStringMap(raw.headers, MAX_MCP_HEADERS),
    tools: normalizeStringList(raw.tools, MAX_MCP_TOOLS, MCP_MAX_NAME_LENGTH),
    timeoutMs: timeout,
    allowWriteTools: raw.allowWriteTools === true,
  };
}

export function normalizeMcpServers(raw: unknown): McpServerConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_MCP_SERVERS).map(normalizeMcpServer);
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export type McpField =
  | "name"
  | "command"
  | "args"
  | "env"
  | "workingDirectory"
  | "url"
  | "headers"
  | "tools"
  | "timeoutMs";

export type McpValidationErrors = Partial<Record<McpField, string>>;

function endpointError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Enter a full http:// or https:// URL.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "The URL must start with http:// or https://.";
  }
  if (parsed.username || parsed.password) {
    return "The URL must not embed a username or password.";
  }
  if (!parsed.hostname) return "The URL must include a host name.";
  if (
    parsed.protocol === "http:" &&
    !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  ) {
    return "Use https:// unless the server runs on localhost.";
  }
  return null;
}

/**
 * Everything wrong with one server, keyed by the field that owns the message.
 *
 * `others` is the rest of the list, because two servers whose names normalise
 * to the same SDK key are refused by the backend and that is worth catching in
 * the form rather than at generation time.
 */
export function validateMcpServer(
  server: McpServerConfig,
  others: readonly McpServerConfig[] = []
): McpValidationErrors {
  const errors: McpValidationErrors = {};

  const name = server.name.trim();
  if (!name) {
    errors.name = "Give this server a name.";
  } else if (name.length > MCP_MAX_NAME_LENGTH) {
    errors.name = `Keep the name under ${MCP_MAX_NAME_LENGTH} characters.`;
  } else {
    const key = mcpServerKey(name);
    if (!key || !SAFE_SDK_NAME.test(key)) {
      errors.name = "The name needs at least one letter or digit.";
    } else if (
      others.some(
        (other) => other.id !== server.id && mcpServerKey(other.name) === key
      )
    ) {
      errors.name = `Another server already uses the name "${key}".`;
    }
  }

  if (server.transport === "stdio") {
    const command = (server.command ?? "").trim();
    if (!command) {
      errors.command = "A local server needs a command to run.";
    } else if (command.length > MCP_MAX_COMMAND_LENGTH) {
      errors.command = `Keep the command under ${MCP_MAX_COMMAND_LENGTH} characters.`;
    } else if (containsControlCharacters(command)) {
      errors.command = "The command contains characters that are not allowed.";
    }

    if (server.args.length > MAX_MCP_ARGS) {
      errors.args = `At most ${MAX_MCP_ARGS} arguments.`;
    } else if (server.args.some((arg) => containsControlCharacters(arg))) {
      errors.args = "An argument contains characters that are not allowed.";
    }

    const envNames = Object.keys(server.env);
    if (envNames.length > MAX_MCP_ENV) {
      errors.env = `At most ${MAX_MCP_ENV} environment variables.`;
    } else {
      const bad = envNames.find((key) => !ENV_NAME.test(key));
      if (bad) {
        errors.env = `"${bad}" is not a valid environment variable name.`;
      } else if (
        Object.values(server.env).some((value) =>
          containsControlCharacters(value)
        )
      ) {
        errors.env = "A value contains characters that are not allowed.";
      }
    }

    if (
      server.workingDirectory &&
      server.workingDirectory.length > MCP_MAX_VALUE_LENGTH
    ) {
      errors.workingDirectory = "That path is too long.";
    }
  } else {
    const url = (server.url ?? "").trim();
    if (!url) {
      errors.url = `A ${server.transport.toUpperCase()} server needs a URL.`;
    } else if (url.length > MCP_MAX_URL_LENGTH) {
      errors.url = "That URL is too long.";
    } else {
      const message = endpointError(url);
      if (message) errors.url = message;
    }

    const headerNames = Object.keys(server.headers);
    if (headerNames.length > MAX_MCP_HEADERS) {
      errors.headers = `At most ${MAX_MCP_HEADERS} headers.`;
    } else {
      const bad = headerNames.find((key) => !HEADER_NAME.test(key));
      if (bad) {
        errors.headers = `"${bad}" is not a valid header name.`;
      } else if (
        Object.values(server.headers).some((value) =>
          containsControlCharacters(value)
        )
      ) {
        errors.headers = "A value contains characters that are not allowed.";
      }
    }
  }

  if (server.tools.length > MAX_MCP_TOOLS) {
    errors.tools = `At most ${MAX_MCP_TOOLS} tools.`;
  } else {
    const bad = server.tools.find(
      (tool) => tool !== "*" && !TOOL_NAME.test(tool)
    );
    if (bad) errors.tools = `"${bad}" is not a valid tool name.`;
  }

  if (server.timeoutMs !== null) {
    if (
      !Number.isInteger(server.timeoutMs) ||
      server.timeoutMs < MIN_MCP_TIMEOUT_MS ||
      server.timeoutMs > MAX_MCP_TIMEOUT_MS
    ) {
      errors.timeoutMs = `Use between ${MIN_MCP_TIMEOUT_MS} and ${MAX_MCP_TIMEOUT_MS} milliseconds.`;
    }
  }

  return errors;
}

export function validateMcpServers(
  servers: readonly McpServerConfig[]
): Record<string, McpValidationErrors> {
  const result: Record<string, McpValidationErrors> = {};
  for (const server of servers) {
    const errors = validateMcpServer(server, servers);
    if (Object.keys(errors).length > 0) result[server.id] = errors;
  }
  return result;
}

/** Enabled *and* trusted: the only servers that may actually run. */
export function activeMcpServers(
  servers: readonly McpServerConfig[]
): McpServerConfig[] {
  return servers.filter((server) => server.enabled && server.trusted);
}

/* -------------------------------------------------------------------------- */
/* Text <-> structure for the editor                                           */
/* -------------------------------------------------------------------------- */

export interface KeyValueParseResult {
  entries: Record<string, string>;
  errors: string[];
}

/**
 * Parse `NAME=value` lines (or a JSON object) into a map.
 *
 * Both shapes turn up: people paste a JSON block from a README, or type the
 * lines by hand. Anything else is reported by line so the message can point at
 * what to fix without quoting the value, which may be a token.
 */
export function parseKeyValueText(text: string): KeyValueParseResult {
  const entries: Record<string, string> = {};
  const errors: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { entries, errors };

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        return { entries, errors: ["JSON must be an object of name/value pairs."] };
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") {
          errors.push(`"${key}" must be text.`);
          continue;
        }
        entries[key.trim()] = value.trim();
      }
      return { entries, errors };
    } catch {
      return { entries, errors: ["That is not valid JSON."] };
    }
  }

  trimmed.split(/\r?\n/).forEach((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith("#")) return;
    const separator = value.indexOf("=");
    if (separator <= 0) {
      errors.push(`Line ${index + 1} must look like NAME=value.`);
      return;
    }
    entries[value.slice(0, separator).trim()] = value
      .slice(separator + 1)
      .trim();
  });

  return { entries, errors };
}

/** Render a map back into `NAME=value` lines, masking anything secret-looking. */
export function formatKeyValueText(
  entries: Record<string, string>,
  options: { maskSecrets?: boolean } = {}
): string {
  return Object.entries(entries)
    .map(([key, value]) =>
      options.maskSecrets && isSecretKey(key)
        ? `${key}=${maskSecretValue(value)}`
        : `${key}=${value}`
    )
    .join("\n");
}

/** One argument per line; empty lines are dropped rather than sent as "". */
export function parseArgsText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_MCP_ARGS);
}

export function formatArgsText(args: readonly string[]): string {
  return args.join("\n");
}

/** Comma or newline separated tool names. */
export function parseToolsText(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_MCP_TOOLS);
}

export function formatToolsText(tools: readonly string[]): string {
  return tools.join(", ");
}

/* -------------------------------------------------------------------------- */
/* Wire payload                                                                */
/* -------------------------------------------------------------------------- */

export interface McpServerWirePayload {
  id: string;
  name: string;
  enabled: boolean;
  trusted: boolean;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  workingDirectory?: string;
  url?: string;
  headers?: Record<string, string>;
  tools?: string[];
  timeoutMs?: number;
  allowWriteTools: boolean;
}

/**
 * The list the backend takes.
 *
 * `includeSecrets: false` produces the same shape without env values or header
 * values, which is what a snapshot, a log line or a diagnostic may hold.
 */
export function toMcpWirePayload(
  servers: readonly McpServerConfig[],
  options: { includeSecrets?: boolean } = {}
): McpServerWirePayload[] {
  const includeSecrets = options.includeSecrets !== false;
  return servers.slice(0, MAX_MCP_SERVERS).map((server) => {
    const payload: McpServerWirePayload = {
      id: server.id,
      name: server.name.trim(),
      enabled: server.enabled,
      trusted: server.trusted,
      transport: server.transport,
      allowWriteTools: server.allowWriteTools,
    };
    if (server.transport === "stdio") {
      if (server.command) payload.command = server.command;
      if (server.args.length > 0) payload.args = [...server.args];
      if (Object.keys(server.env).length > 0) {
        payload.env = includeSecrets
          ? { ...server.env }
          : Object.fromEntries(Object.keys(server.env).map((key) => [key, ""]));
      }
      if (server.workingDirectory) {
        payload.workingDirectory = server.workingDirectory;
      }
    } else {
      if (server.url) payload.url = server.url;
      if (Object.keys(server.headers).length > 0) {
        payload.headers = includeSecrets
          ? { ...server.headers }
          : Object.fromEntries(
              Object.keys(server.headers).map((key) => [key, ""])
            );
      }
    }
    if (server.tools.length > 0) payload.tools = [...server.tools];
    if (server.timeoutMs !== null) payload.timeoutMs = server.timeoutMs;
    return payload;
  });
}

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

export function describeMcpServer(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    const command = server.command ?? "";
    const args = server.args.length > 0 ? ` ${server.args.join(" ")}` : "";
    return command ? `${command}${args}` : "No command yet";
  }
  return server.url ?? "No URL yet";
}

export function describeMcpState(server: McpServerConfig): string {
  if (!server.enabled) return "Off";
  if (!server.trusted) return "Not trusted — will not start";
  return server.allowWriteTools ? "Active · write tools allowed" : "Active · read-only";
}

/** Presets that are safe without knowing anything about this machine. */
export interface McpPreset {
  id: string;
  label: string;
  description: string;
  apply: () => McpServerConfig;
}

/**
 * Only servers whose defaults are complete and harmless are offered.
 *
 * A filesystem server is deliberately absent: it needs a directory to expose,
 * and a preset that guesses one would grant access nobody asked for.
 */
export const MCP_PRESETS: McpPreset[] = [
  {
    id: "http-endpoint",
    label: "Remote HTTP server",
    description:
      "An MCP server you already host. Add the https:// URL and any auth header.",
    apply: () =>
      createMcpServer({
        name: "",
        transport: "http",
        tools: [],
      }),
  },
  {
    id: "local-command",
    label: "Local program (stdio)",
    description:
      "A command on this machine. shot2code runs it directly, so review it first.",
    apply: () => createMcpServer({ name: "", transport: "stdio" }),
  },
];
