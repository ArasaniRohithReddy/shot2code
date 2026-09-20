import { useId, useState } from "react";
import {
  LuAlertTriangle,
  LuCheck,
  LuChevronDown,
  LuEye,
  LuLoader,
  LuPencil,
  LuPlus,
  LuTrash2,
} from "react-icons/lu";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  MAX_MCP_SERVERS,
  MAX_MCP_TIMEOUT_MS,
  MCP_TRANSPORTS,
  MCP_TRANSPORT_LABELS,
  MIN_MCP_TIMEOUT_MS,
  createMcpServer,
  describeMcpServer,
  describeMcpState,
  formatArgsText,
  formatKeyValueText,
  formatToolsText,
  hasSecretValues,
  isSecretKey,
  mcpServerKey,
  parseArgsText,
  parseKeyValueText,
  parseToolsText,
  validateMcpServer,
  type McpServerConfig,
  type McpTransport,
} from "../../lib/mcp-servers";
import { validateIntegrations } from "../../lib/integrations-client";
import type {
  IntegrationSettingsSlice,
  IntegrationValidationResult,
} from "../../lib/integrations";
import IntegrationDiagnostics from "./IntegrationDiagnostics";

export interface McpServersSettingsProps {
  servers: McpServerConfig[];
  /**
   * Applied to the list as it is at the time of the update.
   *
   * An updater rather than a value because a row carries three switches and a
   * card can carry eight rows: two changes landing in one React batch would
   * otherwise both be computed from the same stale array and one would be lost.
   */
  onChange: (update: (current: McpServerConfig[]) => McpServerConfig[]) => void;
  /** Sent alongside the servers so one check covers the whole configuration. */
  copilotSdkByok: IntegrationSettingsSlice["copilotSdkByok"];
  /** One line about which options will actually see these tools. */
  scopeNote?: string | null;
}

const HELP_CLASS = "mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400";
const LABEL_CLASS = "text-sm font-medium text-gray-700 dark:text-zinc-300";
const ERROR_CLASS = "mt-1 text-xs text-red-600 dark:text-red-400";
const SELECT_CLASS =
  "mt-2 h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-zinc-900/40";
const TEXTAREA_CLASS =
  "mt-2 w-full rounded-md border border-input bg-transparent p-3 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-zinc-900/40";

/** Drafts hold text while it is being typed; structure is parsed on change. */
interface DraftText {
  args: string;
  env: string;
  headers: string;
  tools: string;
}

function draftFor(server: McpServerConfig): DraftText {
  return {
    args: formatArgsText(server.args),
    // Values are shown as typed inside the editor; the list view and the
    // masked state below are what keep a token off the screen by default.
    env: formatKeyValueText(server.env),
    headers: formatKeyValueText(server.headers),
    tools: formatToolsText(server.tools),
  };
}

interface KeyValueFieldProps {
  id: string;
  label: string;
  help: React.ReactNode;
  entries: Record<string, string>;
  draft: string;
  error?: string;
  /** False until the user asks to see the values that look like credentials. */
  revealed: boolean;
  onReveal: () => void;
  onChange: (text: string) => void;
}

/**
 * A `NAME=value` editor that keeps credentials off the screen until asked.
 *
 * Existing secret-looking values render masked and read-only, which is what
 * stops a token sitting in plain view while someone edits an unrelated field.
 * Revealing is one explicit click, because the value has to be editable at
 * some point and a permanently masked field would be a trap.
 *
 * Exported so its masking can be tested on its own; the card composes it.
 */
export function KeyValueField({
  id,
  label,
  help,
  entries,
  draft,
  error,
  revealed,
  onReveal,
  onChange,
}: KeyValueFieldProps) {
  const masked = !revealed && hasSecretValues(entries);
  const parseErrors = parseKeyValueText(draft).errors;
  const names =
    Object.keys(entries)
      .map((key) => (isSecretKey(key) ? `${key} (hidden)` : key))
      .join(", ") || "None";

  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={id}>
        {label}
      </label>
      <p className={HELP_CLASS} id={`${id}-help`}>
        {help}
      </p>
      <textarea
        id={id}
        className={TEXTAREA_CLASS}
        rows={3}
        spellCheck={false}
        readOnly={masked}
        value={masked ? formatKeyValueText(entries, { maskSecrets: true }) : draft}
        aria-describedby={`${id}-help`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {masked && (
        <button
          type="button"
          onClick={onReveal}
          aria-controls={id}
          className="mt-2 flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <LuEye aria-hidden="true" className="h-3.5 w-3.5" />
          Show values to edit
        </button>
      )}
      {(error || parseErrors.length > 0) && (
        <p role="alert" className={ERROR_CLASS}>
          {error ?? parseErrors[0]}
        </p>
      )}
      <p className="mt-1 text-[11px] text-gray-500 dark:text-zinc-400">{names}</p>
    </div>
  );
}

/**
 * The MCP servers a Copilot or Copilot SDK BYOK run may call.
 *
 * Two switches gate every server and both are deliberate. `Enabled` is the
 * usual on/off. `Trusted` is the separate acknowledgement that shot2code may
 * start the thing - for a local server that means running a program on this
 * machine - and approve the tools it offers. A trusted server is still
 * read-only until "Allow write tools" is turned on as well.
 *
 * Environment values and request headers often hold tokens. They are typed in
 * password-style fields, masked in the list, and never sent anywhere except the
 * backend that has to use them.
 */
export default function McpServersSettings({
  servers,
  onChange,
  copilotSdkByok,
  scopeNote = null,
}: McpServersSettingsProps) {
  const baseId = useId().replace(/:/g, "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftText>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [isValidating, setIsValidating] = useState(false);
  const [result, setResult] = useState<IntegrationValidationResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const resetChecks = () => {
    setResult(null);
    setRequestError(null);
  };

  const replace = (id: string, patch: Partial<McpServerConfig>) => {
    resetChecks();
    onChange((current) =>
      current.map((server) =>
        server.id === id ? { ...server, ...patch } : server
      )
    );
  };

  const addServer = () => {
    if (servers.length >= MAX_MCP_SERVERS) return;
    const server = createMcpServer();
    resetChecks();
    onChange((current) =>
      current.length >= MAX_MCP_SERVERS ? current : [...current, server]
    );
    setDrafts((current) => ({ ...current, [server.id]: draftFor(server) }));
    setEditingId(server.id);
  };

  const removeServer = (id: string) => {
    resetChecks();
    onChange((current) => current.filter((server) => server.id !== id));
    setPendingDeleteId(null);
    if (editingId === id) setEditingId(null);
  };

  const startEditing = (server: McpServerConfig) => {
    setDrafts((current) => ({
      ...current,
      [server.id]: current[server.id] ?? draftFor(server),
    }));
    setEditingId((current) => (current === server.id ? null : server.id));
  };

  const setDraft = (id: string, patch: Partial<DraftText>) =>
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { args: "", env: "", headers: "", tools: "" }), ...patch },
    }));

  const runValidation = async () => {
    setIsValidating(true);
    setRequestError(null);
    try {
      setResult(await validateIntegrations({ copilotSdkByok, mcpServers: servers }));
    } catch (caught) {
      setRequestError(
        caught instanceof Error
          ? caught.message
          : "Could not check this configuration."
      );
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">
            MCP servers
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
            {servers.length} of {MAX_MCP_SERVERS} configured
          </p>
        </div>
        <button
          type="button"
          onClick={addServer}
          disabled={servers.length >= MAX_MCP_SERVERS}
          className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <LuPlus aria-hidden="true" className="h-3.5 w-3.5" />
          Add server
        </button>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-xs leading-5 text-gray-500 dark:text-zinc-400">
          MCP tools are offered to GitHub Copilot options and Copilot SDK BYOK
          options only. Models running on their own OpenAI, Anthropic or Gemini
          key never see them. Everything you enter here is stored on this device.
        </p>
        {scopeNote && (
          <p className="text-xs leading-5 text-gray-600 dark:text-zinc-300">
            {scopeNote}
          </p>
        )}

        {servers.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500 dark:border-zinc-700 dark:text-zinc-400">
            No MCP server yet. Add one to give Copilot runs extra tools.
          </p>
        ) : (
          <ul className="space-y-3">
            {servers.map((server) => {
              const errors = validateMcpServer(server, servers);
              const hasErrors = Object.keys(errors).length > 0;
              const isEditing = editingId === server.id;
              const draft = drafts[server.id] ?? draftFor(server);
              const rowId = `${baseId}-${server.id}`;
              const title = server.name.trim() || "Untitled server";

              return (
                <li
                  key={server.id}
                  className="rounded-md border border-gray-200 dark:border-zinc-700"
                >
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-800 dark:text-zinc-100">
                        <span className="notranslate truncate" translate="no">
                          {title}
                        </span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {server.transport}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            server.enabled && server.trusted
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {describeMcpState(server)}
                        </span>
                        {server.allowWriteTools && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            Write tools
                          </span>
                        )}
                      </p>
                      <p className="notranslate mt-1 truncate text-xs text-gray-500 dark:text-zinc-400" translate="no">
                        {describeMcpServer(server)}
                      </p>
                      {hasErrors && (
                        <p role="alert" className={ERROR_CLASS}>
                          {Object.values(errors)[0]}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditing(server)}
                        aria-expanded={isEditing}
                        aria-controls={`${rowId}-editor`}
                        aria-label={`Edit ${title}`}
                        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        <LuPencil aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(server.id)}
                        aria-label={`Delete ${title}`}
                        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                      >
                        <LuTrash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {pendingDeleteId === server.id && (
                    <div
                      role="alertdialog"
                      aria-label={`Delete ${title}?`}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                    >
                      <span>Delete this server and its stored values?</span>
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="min-h-11 rounded-lg px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => removeServer(server.id)}
                          className="min-h-11 rounded-lg bg-red-600 px-3 font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-gray-100 px-3 py-3 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${rowId}-enabled`}
                        checked={server.enabled}
                        onCheckedChange={(checked) =>
                          replace(server.id, { enabled: checked })
                        }
                      />
                      <label
                        htmlFor={`${rowId}-enabled`}
                        className="text-xs text-gray-600 dark:text-zinc-300"
                      >
                        Enabled
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${rowId}-trusted`}
                        checked={server.trusted}
                        onCheckedChange={(checked) =>
                          replace(server.id, { trusted: checked })
                        }
                        aria-describedby={`${rowId}-trusted-help`}
                      />
                      <label
                        htmlFor={`${rowId}-trusted`}
                        className="text-xs text-gray-600 dark:text-zinc-300"
                      >
                        Trusted
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${rowId}-write`}
                        checked={server.allowWriteTools}
                        onCheckedChange={(checked) =>
                          replace(server.id, { allowWriteTools: checked })
                        }
                        aria-describedby={`${rowId}-write-help`}
                      />
                      <label
                        htmlFor={`${rowId}-write`}
                        className="text-xs text-gray-600 dark:text-zinc-300"
                      >
                        Allow write tools
                      </label>
                    </div>
                  </div>

                  <p
                    id={`${rowId}-trusted-help`}
                    className="px-3 pb-2 text-[11px] leading-4 text-gray-500 dark:text-zinc-400"
                  >
                    A server only starts when it is both enabled and trusted.
                    {server.transport === "stdio"
                      ? " Trusting a local server lets shot2code run that program on this device."
                      : " Trusting a remote server lets shot2code call it and approve its tools."}
                  </p>
                  <p
                    id={`${rowId}-write-help`}
                    className="px-3 pb-3 text-[11px] leading-4 text-red-700 dark:text-red-300"
                  >
                    Servers are read-only by default. Allowing write tools lets
                    this server change files, data or remote state on your
                    behalf during a generation.
                  </p>

                  {isEditing && (
                    <div
                      id={`${rowId}-editor`}
                      className="space-y-4 border-t border-gray-100 p-3 dark:border-zinc-800"
                    >
                      <div>
                        <label className={LABEL_CLASS} htmlFor={`${rowId}-name`}>
                          Name
                        </label>
                        <p className={HELP_CLASS} id={`${rowId}-name-help`}>
                          Shown in the activity list. Runs as{" "}
                          <span className="notranslate" translate="no">
                            {mcpServerKey(server.name) || "…"}
                          </span>
                          .
                        </p>
                        <Input
                          id={`${rowId}-name`}
                          className="mt-2"
                          autoComplete="off"
                          value={server.name}
                          onChange={(event) =>
                            replace(server.id, { name: event.target.value })
                          }
                          aria-describedby={`${rowId}-name-help`}
                          aria-invalid={errors.name ? true : undefined}
                        />
                        {errors.name && (
                          <p role="alert" className={ERROR_CLASS}>
                            {errors.name}
                          </p>
                        )}
                      </div>

                      <div>
                        <label
                          className={LABEL_CLASS}
                          htmlFor={`${rowId}-transport`}
                        >
                          Transport
                        </label>
                        <select
                          id={`${rowId}-transport`}
                          className={SELECT_CLASS}
                          value={server.transport}
                          onChange={(event) =>
                            replace(server.id, {
                              transport: event.target.value as McpTransport,
                            })
                          }
                        >
                          {MCP_TRANSPORTS.map((value) => (
                            <option key={value} value={value}>
                              {MCP_TRANSPORT_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </div>

                      {server.transport === "stdio" ? (
                        <>
                          <div>
                            <label
                              className={LABEL_CLASS}
                              htmlFor={`${rowId}-command`}
                            >
                              Command
                            </label>
                            <p className={HELP_CLASS} id={`${rowId}-command-help`}>
                              The program to run. It is executed directly, not
                              through a shell.
                            </p>
                            <Input
                              id={`${rowId}-command`}
                              className="mt-2"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="npx"
                              value={server.command ?? ""}
                              onChange={(event) =>
                                replace(server.id, {
                                  command: event.target.value || null,
                                })
                              }
                              aria-describedby={`${rowId}-command-help`}
                              aria-invalid={errors.command ? true : undefined}
                            />
                            {errors.command && (
                              <p role="alert" className={ERROR_CLASS}>
                                {errors.command}
                              </p>
                            )}
                          </div>

                          <div>
                            <label className={LABEL_CLASS} htmlFor={`${rowId}-args`}>
                              Arguments
                            </label>
                            <p className={HELP_CLASS} id={`${rowId}-args-help`}>
                              One per line, in order.
                            </p>
                            <textarea
                              id={`${rowId}-args`}
                              className={TEXTAREA_CLASS}
                              rows={3}
                              spellCheck={false}
                              value={draft.args}
                              aria-describedby={`${rowId}-args-help`}
                              aria-invalid={errors.args ? true : undefined}
                              onChange={(event) => {
                                setDraft(server.id, { args: event.target.value });
                                replace(server.id, {
                                  args: parseArgsText(event.target.value),
                                });
                              }}
                            />
                            {errors.args && (
                              <p role="alert" className={ERROR_CLASS}>
                                {errors.args}
                              </p>
                            )}
                          </div>

                          <KeyValueField
                            id={`${rowId}-env`}
                            label="Environment variables"
                            help={
                              <>
                                One <code>NAME=value</code> per line, or a JSON
                                object. Values that look like credentials stay
                                hidden until you ask to edit them.
                              </>
                            }
                            entries={server.env}
                            draft={draft.env}
                            error={errors.env}
                            revealed={revealedIds[server.id] === true}
                            onReveal={() =>
                              setRevealedIds((current) => ({
                                ...current,
                                [server.id]: true,
                              }))
                            }
                            onChange={(text) => {
                              setDraft(server.id, { env: text });
                              replace(server.id, {
                                env: parseKeyValueText(text).entries,
                              });
                            }}
                          />

                          <div>
                            <label
                              className={LABEL_CLASS}
                              htmlFor={`${rowId}-cwd`}
                            >
                              Working directory (optional)
                            </label>
                            <Input
                              id={`${rowId}-cwd`}
                              className="mt-2"
                              autoComplete="off"
                              spellCheck={false}
                              value={server.workingDirectory ?? ""}
                              onChange={(event) =>
                                replace(server.id, {
                                  workingDirectory: event.target.value || null,
                                })
                              }
                              aria-invalid={
                                errors.workingDirectory ? true : undefined
                              }
                            />
                            {errors.workingDirectory && (
                              <p role="alert" className={ERROR_CLASS}>
                                {errors.workingDirectory}
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <label className={LABEL_CLASS} htmlFor={`${rowId}-url`}>
                              URL
                            </label>
                            <p className={HELP_CLASS} id={`${rowId}-url-help`}>
                              https:// is required unless the server runs on
                              localhost.
                            </p>
                            <Input
                              id={`${rowId}-url`}
                              className="mt-2"
                              type="url"
                              inputMode="url"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="https://mcp.example.com/sse"
                              value={server.url ?? ""}
                              onChange={(event) =>
                                replace(server.id, {
                                  url: event.target.value || null,
                                })
                              }
                              aria-describedby={`${rowId}-url-help`}
                              aria-invalid={errors.url ? true : undefined}
                            />
                            {errors.url && (
                              <p role="alert" className={ERROR_CLASS}>
                                {errors.url}
                              </p>
                            )}
                          </div>

                          <KeyValueField
                            id={`${rowId}-headers`}
                            label="Request headers"
                            help={
                              <>
                                One <code>Name=value</code> pair per line, or a
                                JSON object. Values that look like credentials
                                stay hidden until you ask to edit them.
                              </>
                            }
                            entries={server.headers}
                            draft={draft.headers}
                            error={errors.headers}
                            revealed={revealedIds[server.id] === true}
                            onReveal={() =>
                              setRevealedIds((current) => ({
                                ...current,
                                [server.id]: true,
                              }))
                            }
                            onChange={(text) => {
                              setDraft(server.id, { headers: text });
                              replace(server.id, {
                                headers: parseKeyValueText(text).entries,
                              });
                            }}
                          />
                        </>
                      )}

                      <div>
                        <label className={LABEL_CLASS} htmlFor={`${rowId}-tools`}>
                          Tool allowlist (optional)
                        </label>
                        <p className={HELP_CLASS} id={`${rowId}-tools-help`}>
                          Comma separated. Leave empty to allow every tool the
                          server offers.
                        </p>
                        <Input
                          id={`${rowId}-tools`}
                          className="mt-2"
                          autoComplete="off"
                          spellCheck={false}
                          value={draft.tools}
                          aria-describedby={`${rowId}-tools-help`}
                          aria-invalid={errors.tools ? true : undefined}
                          onChange={(event) => {
                            setDraft(server.id, { tools: event.target.value });
                            replace(server.id, {
                              tools: parseToolsText(event.target.value),
                            });
                          }}
                        />
                        {errors.tools && (
                          <p role="alert" className={ERROR_CLASS}>
                            {errors.tools}
                          </p>
                        )}
                      </div>

                      <div>
                        <label
                          className={LABEL_CLASS}
                          htmlFor={`${rowId}-timeout`}
                        >
                          Timeout (ms, optional)
                        </label>
                        <p className={HELP_CLASS} id={`${rowId}-timeout-help`}>
                          Between {MIN_MCP_TIMEOUT_MS} and {MAX_MCP_TIMEOUT_MS}.
                        </p>
                        <Input
                          id={`${rowId}-timeout`}
                          className="mt-2"
                          type="number"
                          inputMode="numeric"
                          min={MIN_MCP_TIMEOUT_MS}
                          max={MAX_MCP_TIMEOUT_MS}
                          value={server.timeoutMs ?? ""}
                          aria-describedby={`${rowId}-timeout-help`}
                          aria-invalid={errors.timeoutMs ? true : undefined}
                          onChange={(event) =>
                            replace(server.id, {
                              timeoutMs: event.target.value
                                ? Number(event.target.value)
                                : null,
                            })
                          }
                        />
                        {errors.timeoutMs && (
                          <p role="alert" className={ERROR_CLASS}>
                            {errors.timeoutMs}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <LuChevronDown aria-hidden="true" className="h-3.5 w-3.5 rotate-180" />
                        Done editing
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {servers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runValidation()}
              disabled={isValidating}
              className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {isValidating ? (
                <LuLoader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LuCheck aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              Validate servers
            </button>
            <span className="text-xs text-gray-500 dark:text-zinc-400">
              Checks the settings only. No server is started.
            </span>
          </div>
        )}

        <div aria-live="polite" className="space-y-2">
          {requestError && (
            <p role="alert" className={ERROR_CLASS}>
              {requestError}
            </p>
          )}
          {result && result.valid && (
            <p className="flex items-start gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100">
              <LuCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {result.activeMcpServers.length > 0
                  ? `Ready: ${result.activeMcpServers.join(", ")}.`
                  : "Accepted, but no server is enabled and trusted yet."}
              </span>
            </p>
          )}
          {result && !result.valid && result.error && (
            <p
              role="alert"
              className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              <LuAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{result.error}</span>
            </p>
          )}
          {result && (
            <IntegrationDiagnostics
              diagnostics={result.diagnostics}
              idPrefix={`${baseId}-validation`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
