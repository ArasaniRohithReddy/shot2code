jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import McpServersSettings, { KeyValueField } from "./McpServersSettings";
import { DEFAULT_COPILOT_SDK_BYOK_SETTINGS } from "../../lib/copilot-sdk-byok";
import {
  MAX_MCP_SERVERS,
  createMcpServer,
  type McpServerConfig,
} from "../../lib/mcp-servers";

const ENV_SECRET = "mcp-env-token-value";
const HEADER_SECRET = "mcp-header-token-value";

function stdio(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return createMcpServer({
    id: "docs",
    name: "Docs",
    enabled: true,
    trusted: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@example/mcp-docs"],
    env: { API_TOKEN: ENV_SECRET, LOG_LEVEL: "info" },
    ...overrides,
  });
}

function remote(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return createMcpServer({
    id: "remote",
    name: "Remote",
    enabled: true,
    trusted: true,
    transport: "http",
    url: "https://mcp.example.com/messages",
    headers: { Authorization: HEADER_SECRET },
    ...overrides,
  });
}

function render(
  overrides: Partial<Parameters<typeof McpServersSettings>[0]> = {}
) {
  return renderToStaticMarkup(
    <McpServersSettings
      servers={[stdio()]}
      onChange={jest.fn()}
      copilotSdkByok={DEFAULT_COPILOT_SDK_BYOK_SETTINGS}
      {...overrides}
    />
  );
}

/** Markup with every form value removed; see the BYOK card's test for why. */
function renderWithoutFieldValues(
  overrides: Partial<Parameters<typeof McpServersSettings>[0]> = {}
) {
  return render(overrides).replace(/ value="[^"]*"/g, "");
}

test("explains itself and says nothing is configured yet", () => {
  const html = render({ servers: [] });

  expect(html).toContain("No MCP server yet");
  expect(html).toContain(`0 of ${MAX_MCP_SERVERS} configured`);
});

test("states the runtime scope: Copilot and BYOK options only", () => {
  const html = render();

  expect(html).toContain("GitHub Copilot options and Copilot SDK BYOK");
  expect(html).toContain("never see them");
});

test("says the values are stored on this device", () => {
  expect(render()).toContain("stored on this device");
});

test("stops offering new servers at the backend's limit", () => {
  const servers = Array.from({ length: MAX_MCP_SERVERS }, (_, index) =>
    stdio({ id: `s${index}`, name: `Server ${index}` })
  );
  const full = render({ servers });

  expect(full).toContain(`${MAX_MCP_SERVERS} of ${MAX_MCP_SERVERS} configured`);
  // "Add server" is the only control that can be disabled at rest.
  expect(full).toContain('disabled=""');
  expect(render({ servers: [stdio()] })).not.toContain('disabled=""');
});

test("gates a server behind separate enable and trust switches", () => {
  const html = render();

  expect(html).toMatch(/for="[^"]*-enabled"/);
  expect(html).toMatch(/for="[^"]*-trusted"/);
  expect(html).toContain("only starts when it is both enabled and trusted");
});

test("warns that trusting a local server runs a program on this device", () => {
  expect(render()).toContain(
    "lets shot2code run that program on this device"
  );
});

test("warns differently for a remote server", () => {
  const html = render({ servers: [remote()] });

  expect(html).toContain("lets shot2code call it and approve its tools");
  expect(html).not.toContain("run that program on this device");
});

test("is read-only by default with its own write switch and danger copy", () => {
  const html = render();

  expect(html).toContain("Allow write tools");
  expect(html).toContain("Servers are read-only by default");
  expect(html).toContain("change files, data or remote state");
  expect(html).toContain("read-only");
});

test("shows the trusted and write state visibly", () => {
  expect(render()).toContain("Active · read-only");
  expect(render({ servers: [stdio({ allowWriteTools: true })] })).toContain(
    "Write tools"
  );
  expect(render({ servers: [stdio({ trusted: false })] })).toContain(
    "Not trusted"
  );
  expect(render({ servers: [stdio({ enabled: false })] })).toContain(">Off<");
});

test("never prints an env value or header value in the list", () => {
  const html = renderWithoutFieldValues({ servers: [stdio(), remote()] });

  expect(html).not.toContain(ENV_SECRET);
  expect(html).not.toContain(HEADER_SECRET);
  expect(html).toContain("npx -y @example/mcp-docs");
  expect(html).toContain("https://mcp.example.com/messages");
});

test("asks for confirmation before deleting, with an accessible dialog", () => {
  const html = render();

  expect(html).toMatch(/aria-label="Delete Docs"/);
  expect(html).not.toContain('role="alertdialog"');
});

test("gives every row control a 44px target and an accessible name", () => {
  const html = render();

  expect(html).toMatch(/aria-label="Edit Docs"/);
  expect(html).toContain("h-11 w-11");
  expect(html).toContain("min-h-11");
});

test("keeps the editor collapsed behind a disclosure until asked for", () => {
  const html = render();

  expect(html).toMatch(/aria-expanded="false"/);
  expect(html).toMatch(/aria-controls="[^"]*-editor"/);
  expect(html).not.toContain("Working directory (optional)");
});

test("surfaces a validation error for the server it belongs to", () => {
  const html = render({ servers: [stdio({ command: null })] });

  expect(html).toContain('role="alert"');
  expect(html).toContain("A local server needs a command to run.");
});

test("reports an http url that is not localhost", () => {
  const html = render({
    servers: [remote({ url: "http://mcp.example.com/messages" })],
  });

  expect(html).toContain("Use https:// unless the server runs on localhost.");
});

test("offers a validate button that promises not to start anything", () => {
  const html = render();

  expect(html).toContain("Validate servers");
  expect(html).toContain("No server is started.");
  expect(html).toContain('aria-live="polite"');
});

test("renders the scope note it is handed", () => {
  const html = render({ scopeNote: "MCP tools from Docs are offered to X." });

  expect(html).toContain("MCP tools from Docs are offered to X.");
});

/* -------------------------------------------------------------------------- */
/* Credentials stay off the screen until they are asked for                    */
/* -------------------------------------------------------------------------- */

function renderField(
  overrides: Partial<Parameters<typeof KeyValueField>[0]> = {}
) {
  return renderToStaticMarkup(
    <KeyValueField
      id="row-headers"
      label="Request headers"
      help="One Name=value pair per line."
      entries={{ Authorization: HEADER_SECRET, "X-Team": "design" }}
      draft={`Authorization=${HEADER_SECRET}\nX-Team=design`}
      revealed={false}
      onReveal={jest.fn()}
      onChange={jest.fn()}
      {...overrides}
    />
  );
}

test("masks an existing credential and makes the field read-only", () => {
  const html = renderField();

  expect(html).not.toContain(HEADER_SECRET);
  expect(html).toContain("••••••••");
  expect(html).toContain("readonly=\"\"");
  expect(html).toContain("Show values to edit");
  expect(html).toContain('aria-controls="row-headers"');
});

test("shows the values once they have been revealed", () => {
  const html = renderField({ revealed: true });

  expect(html).toContain(HEADER_SECRET);
  expect(html).not.toContain("Show values to edit");
  expect(html).not.toContain("readonly=\"\"");
});

test("never masks a value whose name is not credential-like", () => {
  const html = renderField({
    entries: { "X-Team": "design" },
    draft: "X-Team=design",
  });

  expect(html).toContain("X-Team=design");
  expect(html).not.toContain("Show values to edit");
});

test("names the keys, marking which ones are hidden", () => {
  const html = renderField();

  expect(html).toContain("Authorization (hidden), X-Team");
});

test("reports a malformed line without quoting the value", () => {
  const html = renderField({ revealed: true, draft: "Authorization" });

  expect(html).toContain('role="alert"');
  expect(html).toContain("Line 1 must look like NAME=value.");
});

test("never prints a credential in a collapsed row", () => {
  const html = render({ servers: [stdio(), remote()] });

  expect(html).not.toContain(ENV_SECRET);
  expect(html).not.toContain(HEADER_SECRET);
  expect(html).toContain("npx -y @example/mcp-docs");
});
