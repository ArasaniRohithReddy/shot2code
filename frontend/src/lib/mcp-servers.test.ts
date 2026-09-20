import {
  MAX_MCP_SERVERS,
  MAX_MCP_TIMEOUT_MS,
  MIN_MCP_TIMEOUT_MS,
  activeMcpServers,
  createMcpServer,
  describeMcpServer,
  describeMcpState,
  formatArgsText,
  formatKeyValueText,
  formatToolsText,
  hasSecretValues,
  isSecretKey,
  maskSecretValue,
  mcpServerKey,
  normalizeMcpServer,
  normalizeMcpServers,
  parseArgsText,
  parseKeyValueText,
  parseToolsText,
  toMcpWirePayload,
  validateMcpServer,
  validateMcpServers,
  type McpServerConfig,
} from "./mcp-servers";

function stdio(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return createMcpServer({
    id: "server-1",
    name: "Local docs",
    enabled: true,
    trusted: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@example/mcp-docs"],
    env: { API_TOKEN: "env-secret", LOG_LEVEL: "info" },
    ...overrides,
  });
}

function remote(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return createMcpServer({
    id: "server-2",
    name: "Company MCP",
    enabled: true,
    trusted: true,
    transport: "http",
    url: "https://mcp.example.com/messages",
    headers: { Authorization: "Bearer header-secret", "X-Team": "design" },
    ...overrides,
  });
}

describe("defaults and normalisation", () => {
  test("a new server is off, untrusted and read-only", () => {
    const server = createMcpServer();
    expect(server.enabled).toBe(false);
    expect(server.trusted).toBe(false);
    expect(server.allowWriteTools).toBe(false);
    expect(server.transport).toBe("stdio");
    expect(server.id).not.toHaveLength(0);
  });

  test("an absent list becomes an empty one", () => {
    expect(normalizeMcpServers(undefined)).toEqual([]);
    expect(normalizeMcpServers("nonsense")).toEqual([]);
    expect(normalizeMcpServers({})).toEqual([]);
  });

  test("caps a stored list at the backend's limit", () => {
    const stored = Array.from({ length: MAX_MCP_SERVERS + 4 }, (_, index) => ({
      id: `s${index}`,
      name: `Server ${index}`,
      transport: "stdio",
      command: "run",
    }));
    expect(normalizeMcpServers(stored)).toHaveLength(MAX_MCP_SERVERS);
  });

  test("keeps only the fields the chosen transport uses", () => {
    const normalized = normalizeMcpServer({
      name: "Mixed",
      transport: "http",
      url: "https://mcp.example.com",
      command: "npx",
      env: { A: "1" },
      headers: { "X-A": "1" },
    });
    expect(normalized.command).toBeNull();
    expect(normalized.env).toEqual({});
    expect(normalized.headers).toEqual({ "X-A": "1" });
  });

  test("defaults an unknown transport to stdio rather than trusting it", () => {
    expect(normalizeMcpServer({ transport: "ftp" }).transport).toBe("stdio");
  });

  test("a stored server stays off unless it was explicitly on", () => {
    const normalized = normalizeMcpServer({ name: "x", enabled: "yes" });
    expect(normalized.enabled).toBe(false);
    expect(normalized.trusted).toBe(false);
  });
});

describe("server keys", () => {
  test("normalises a name the way the backend does", () => {
    expect(mcpServerKey("My Docs Server!")).toBe("my-docs-server");
    expect(mcpServerKey("  --Weird__Name--  ")).toBe("weird__name");
  });

  test("returns nothing usable for a name with no letters or digits", () => {
    expect(mcpServerKey("!!!")).toBe("");
  });
});

describe("validation", () => {
  test("accepts a complete stdio server", () => {
    expect(validateMcpServer(stdio())).toEqual({});
  });

  test("accepts a complete https server", () => {
    expect(validateMcpServer(remote())).toEqual({});
  });

  test("requires a name", () => {
    expect(validateMcpServer(stdio({ name: "  " })).name).toContain("name");
  });

  test("refuses two servers whose names collide after normalising", () => {
    const servers = [stdio(), stdio({ id: "server-3", name: "local docs" })];
    const errors = validateMcpServers(servers);
    expect(errors["server-3"]?.name).toContain("already uses the name");
  });

  test("requires a command for a local server", () => {
    expect(validateMcpServer(stdio({ command: null })).command).toContain(
      "command"
    );
  });

  test("requires a url for a remote server", () => {
    expect(validateMcpServer(remote({ url: null })).url).toContain("URL");
  });

  test("requires https unless the host is localhost", () => {
    expect(
      validateMcpServer(remote({ url: "http://mcp.example.com" })).url
    ).toContain("https://");
    expect(
      validateMcpServer(remote({ url: "http://localhost:3000/sse" })).url
    ).toBeUndefined();
    expect(
      validateMcpServer(remote({ url: "http://127.0.0.1:3000/sse" })).url
    ).toBeUndefined();
  });

  test("refuses a url with embedded credentials", () => {
    expect(
      validateMcpServer(remote({ url: "https://a:b@mcp.example.com" })).url
    ).toContain("username or password");
  });

  test("refuses an invalid environment variable name", () => {
    expect(
      validateMcpServer(stdio({ env: { "not a name": "x" } })).env
    ).toContain("not a valid environment variable name");
  });

  test("refuses an invalid header name", () => {
    expect(
      validateMcpServer(remote({ headers: { "Bad Header": "x" } })).headers
    ).toContain("not a valid header name");
  });

  test("refuses an invalid tool name but allows the wildcard", () => {
    expect(validateMcpServer(stdio({ tools: ["search docs"] })).tools).toContain(
      "not a valid tool name"
    );
    expect(validateMcpServer(stdio({ tools: ["*"] })).tools).toBeUndefined();
  });

  test("bounds the timeout to the backend's range", () => {
    expect(
      validateMcpServer(stdio({ timeoutMs: MIN_MCP_TIMEOUT_MS - 1 })).timeoutMs
    ).toBeDefined();
    expect(
      validateMcpServer(stdio({ timeoutMs: MAX_MCP_TIMEOUT_MS + 1 })).timeoutMs
    ).toBeDefined();
    expect(
      validateMcpServer(stdio({ timeoutMs: 30_000 })).timeoutMs
    ).toBeUndefined();
  });

  test("refuses control characters in a command or value", () => {
    expect(validateMcpServer(stdio({ command: "np\u0000x" })).command).toContain(
      "not allowed"
    );
    expect(
      validateMcpServer(stdio({ env: { TOKEN: "a\u0007b" } })).env
    ).toContain("not allowed");
  });
});

describe("activation", () => {
  test("only an enabled and trusted server is active", () => {
    const servers = [
      stdio(),
      stdio({ id: "b", name: "Off", enabled: false }),
      stdio({ id: "c", name: "Untrusted", trusted: false }),
    ];
    expect(activeMcpServers(servers).map((entry) => entry.name)).toEqual([
      "Local docs",
    ]);
  });

  test("describes the gating state in words", () => {
    expect(describeMcpState(stdio({ enabled: false }))).toBe("Off");
    expect(describeMcpState(stdio({ trusted: false }))).toContain("Not trusted");
    expect(describeMcpState(stdio())).toContain("read-only");
    expect(describeMcpState(stdio({ allowWriteTools: true }))).toContain(
      "write tools allowed"
    );
  });

  test("summarises a server without quoting its secrets", () => {
    expect(describeMcpServer(stdio())).toBe("npx -y @example/mcp-docs");
    expect(describeMcpServer(stdio())).not.toContain("env-secret");
    expect(describeMcpServer(remote())).toBe("https://mcp.example.com/messages");
  });
});

describe("text parsing", () => {
  test("parses NAME=value lines", () => {
    expect(parseKeyValueText("A=1\nB = two \n\n# comment")).toEqual({
      entries: { A: "1", B: "two" },
      errors: [],
    });
  });

  test("parses a pasted JSON object", () => {
    expect(parseKeyValueText('{"A": "1", "B": "2"}')).toEqual({
      entries: { A: "1", B: "2" },
      errors: [],
    });
  });

  test("reports broken JSON without echoing it back", () => {
    const result = parseKeyValueText('{"A": ');
    expect(result.entries).toEqual({});
    expect(result.errors).toEqual(["That is not valid JSON."]);
  });

  test("reports the line number of a malformed pair", () => {
    expect(parseKeyValueText("A=1\nnope").errors[0]).toBe(
      "Line 2 must look like NAME=value."
    );
  });

  test("names a non-text JSON value without printing it", () => {
    const result = parseKeyValueText('{"A": 7}');
    expect(result.errors[0]).toBe('"A" must be text.');
    expect(result.errors[0]).not.toContain("7");
  });

  test("round-trips args and tools", () => {
    expect(parseArgsText("-y\n\n@example/mcp\n")).toEqual([
      "-y",
      "@example/mcp",
    ]);
    expect(formatArgsText(["-y", "@example/mcp"])).toBe("-y\n@example/mcp");
    expect(parseToolsText("search, fetch\nlist")).toEqual([
      "search",
      "fetch",
      "list",
    ]);
    expect(formatToolsText(["search", "fetch"])).toBe("search, fetch");
  });
});

describe("secret handling", () => {
  test("recognises credential-looking key names", () => {
    expect(isSecretKey("API_TOKEN")).toBe(true);
    expect(isSecretKey("Authorization")).toBe(true);
    expect(isSecretKey("x-secret-thing")).toBe(true);
    expect(isSecretKey("LOG_LEVEL")).toBe(false);
  });

  test("spots a map that holds a credential worth hiding", () => {
    expect(hasSecretValues({ API_TOKEN: "abc", LOG_LEVEL: "info" })).toBe(true);
    expect(hasSecretValues({ LOG_LEVEL: "info" })).toBe(false);
    // An empty credential is nothing to hide.
    expect(hasSecretValues({ API_TOKEN: "" })).toBe(false);
    expect(hasSecretValues({})).toBe(false);
  });

  test("masks a value with a fixed stand-in, not its own content", () => {
    expect(maskSecretValue("env-secret")).toBe("••••••••");
    expect(maskSecretValue("a-much-longer-secret-value")).toBe("••••••••");
    expect(maskSecretValue("")).toBe("");
  });

  test("formats a map with secret values masked", () => {
    const text = formatKeyValueText(
      { API_TOKEN: "env-secret", LOG_LEVEL: "info" },
      { maskSecrets: true }
    );
    expect(text).not.toContain("env-secret");
    expect(text).toContain("LOG_LEVEL=info");
    expect(text).toContain("API_TOKEN=••••••••");
  });
});

describe("wire payload", () => {
  test("sends only the fields the transport uses", () => {
    const [payload] = toMcpWirePayload([stdio()]);
    expect(payload).toEqual({
      id: "server-1",
      name: "Local docs",
      enabled: true,
      trusted: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/mcp-docs"],
      env: { API_TOKEN: "env-secret", LOG_LEVEL: "info" },
      allowWriteTools: false,
    });
    expect(payload).not.toHaveProperty("url");
    expect(payload).not.toHaveProperty("headers");
  });

  test("keeps the header names but drops every value when asked", () => {
    const [payload] = toMcpWirePayload([remote()], { includeSecrets: false });
    expect(JSON.stringify(payload)).not.toContain("header-secret");
    expect(Object.keys(payload.headers ?? {})).toEqual([
      "Authorization",
      "X-Team",
    ]);
  });

  test("keeps the env names but drops every value when asked", () => {
    const [payload] = toMcpWirePayload([stdio()], { includeSecrets: false });
    expect(JSON.stringify(payload)).not.toContain("env-secret");
    expect(Object.keys(payload.env ?? {})).toEqual(["API_TOKEN", "LOG_LEVEL"]);
  });

  test("never sends more servers than the backend accepts", () => {
    const servers = Array.from({ length: MAX_MCP_SERVERS + 3 }, (_, index) =>
      stdio({ id: `s${index}`, name: `Server ${index}` })
    );
    expect(toMcpWirePayload(servers)).toHaveLength(MAX_MCP_SERVERS);
  });

  test("carries the trust and write flags through untouched", () => {
    const [payload] = toMcpWirePayload([
      stdio({ trusted: false, allowWriteTools: true }),
    ]);
    expect(payload.trusted).toBe(false);
    expect(payload.allowWriteTools).toBe(true);
  });
});
