jest.mock("../config", () => ({ HTTP_BACKEND_URL: "http://default" }));

import {
  HistoryHttpError,
  HistoryNetworkError,
  HistoryResponseError,
  createHistoryClient,
  historyEndpoints,
  type HistoryFetch,
} from "./history-client";

const timestamp = "2026-09-12T20:00:00.000Z";

function summaryResponse() {
  return {
    id: "project-1",
    title: "Landing page",
    stack: null,
    input_mode: "text",
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
    head_commit_id: null,
    selected_commit_id: null,
    selected_variant_index: null,
    commit_count: 0,
    variant_count: 0,
  };
}

function projectResponse() {
  return {
    ...summaryResponse(),
    root_commit_ids: [],
    commits: [],
  };
}

function healthResponse() {
  return {
    status: "ok",
    database_path: "C:\\data\\history.sqlite3",
    schema_version: 2,
    latest_schema_version: 2,
    foreign_keys_enabled: true,
    journal_mode: "wal",
    migrations: [
      {
        version: 1,
        name: "initial_history_schema",
        applied_at: timestamp,
      },
    ],
  };
}

function response(
  status: number,
  body?: unknown,
  statusText = ""
): Response {
  const text =
    body === undefined
      ? ""
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => text,
  } as unknown as Response;
}

describe("history endpoint builders", () => {
  it("builds health and list endpoints", () => {
    expect(historyEndpoints.health()).toBe("/api/history/health");
    expect(historyEndpoints.projects()).toBe("/api/history/projects");
    expect(historyEndpoints.projects({ limit: 25, offset: 50 })).toBe(
      "/api/history/projects?limit=25&offset=50"
    );
  });

  it("builds encoded project, append, and selection endpoints", () => {
    expect(historyEndpoints.project(" project one ")).toBe(
      "/api/history/projects/project%20one"
    );
    expect(historyEndpoints.versions("project one")).toBe(
      "/api/history/projects/project%20one/versions"
    );
    expect(historyEndpoints.selection("project one")).toBe(
      "/api/history/projects/project%20one/selection"
    );
  });

  it("rejects invalid identifiers and pagination before fetching", () => {
    expect(() => historyEndpoints.project("   ")).toThrow(
      "projectId must not be blank"
    );
    expect(() => historyEndpoints.projects({ limit: 0 })).toThrow(
      "limit must be an integer"
    );
    expect(() => historyEndpoints.projects({ limit: 501 })).toThrow(
      "limit must be less than or equal to 500"
    );
    expect(() => historyEndpoints.projects({ offset: -1 })).toThrow(
      "offset must be an integer"
    );
  });
});

describe("history HTTP client", () => {
  it("calls every endpoint with the expected method, body, and abort signal", async () => {
    const responses = [
      response(200, healthResponse()),
      response(200, { projects: [summaryResponse()] }),
      response(200, projectResponse()),
      response(200, projectResponse()),
      response(200, projectResponse()),
      response(200, projectResponse()),
      response(204),
    ];
    const fetcher = jest.fn<
      Promise<Response>,
      [string, RequestInit?]
    >(async (): Promise<Response> => {
      const next = responses.shift();
      if (!next) throw new Error("No mock response remains");
      return next;
    });
    const client = createHistoryClient({
      baseUrl: "http://localhost:7001/",
      fetcher,
    });
    const controller = new AbortController();

    const health = await client.health({ signal: controller.signal });
    const listed = await client.listProjects({ limit: 25, offset: 50 });
    const fetched = await client.getProject("project-1");
    await client.upsertProject("project-1", {
      title: "Landing page",
      stack: null,
      inputMode: "text",
    });
    await client.appendVersion("project-1", {
      version: { id: "root" },
      selectedVariantIndex: null,
    });
    await client.selectProject("project-1", {
      headCommitId: "root",
      selectedCommitId: null,
      selectedVariantIndex: null,
    });
    await client.deleteProject("project-1");

    expect(health.databasePath).toBe("C:\\data\\history.sqlite3");
    expect(health.migrations[0].appliedAt).toEqual(new Date(timestamp));
    expect(listed.projects[0].inputMode).toBe("text");
    expect(fetched.id).toBe("project-1");

    const calls = fetcher.mock.calls;
    expect(calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["http://localhost:7001/api/history/health", "GET"],
      [
        "http://localhost:7001/api/history/projects?limit=25&offset=50",
        "GET",
      ],
      ["http://localhost:7001/api/history/projects/project-1", "GET"],
      ["http://localhost:7001/api/history/projects/project-1", "PUT"],
      [
        "http://localhost:7001/api/history/projects/project-1/versions",
        "POST",
      ],
      [
        "http://localhost:7001/api/history/projects/project-1/selection",
        "PATCH",
      ],
      ["http://localhost:7001/api/history/projects/project-1", "DELETE"],
    ]);
    expect(calls[0][1]?.signal).toBe(controller.signal);
    expect(JSON.parse(String(calls[3][1]?.body))).toEqual({
      title: "Landing page",
      stack: null,
      input_mode: "text",
      metadata: {},
      set_as_head: true,
      select_commit: true,
    });
    expect(JSON.parse(String(calls[4][1]?.body))).toEqual({
      version: {
        id: "root",
        version_type: "create",
        inputs: {},
        prompt_metadata: {},
        metadata: {},
        prompts: [],
        variants: [],
      },
      set_as_head: true,
      select_commit: true,
      selected_variant_index: null,
    });
    expect(JSON.parse(String(calls[5][1]?.body))).toEqual({
      head_commit_id: "root",
      selected_commit_id: null,
      selected_variant_index: null,
    });
  });

  it("surfaces FastAPI validation details as an actionable HTTP error", async () => {
    const fetcher: HistoryFetch = async () =>
      response(
        422,
        {
          detail: [
            {
              loc: ["body", "metadata"],
              msg: "Input should be a valid dictionary",
              type: "dict_type",
            },
          ],
        },
        "Unprocessable Entity"
      );
    const client = createHistoryClient({ baseUrl: "http://host", fetcher });

    try {
      await client.upsertProject("project", { title: "Invalid" });
      throw new Error("Expected the request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryHttpError);
      expect(error).toMatchObject({
        status: 422,
        method: "PUT",
        detail: "body.metadata: Input should be a valid dictionary",
      });
      expect((error as Error).message).toContain(
        "PUT http://host/api/history/projects/project failed with HTTP 422"
      );
    }
  });

  it("keeps text error bodies and status metadata", async () => {
    const client = createHistoryClient({
      fetcher: async () => response(500, "database unavailable", "Server Error"),
    });

    await expect(client.health()).rejects.toMatchObject({
      name: "HistoryHttpError",
      status: 500,
      statusText: "Server Error",
      detail: "database unavailable",
    });
  });

  it("rejects invalid JSON and malformed successful payloads", async () => {
    const invalidJson = createHistoryClient({
      fetcher: async () => response(200, "{not-json"),
    });
    await expect(invalidJson.health()).rejects.toBeInstanceOf(
      HistoryResponseError
    );
    await expect(invalidJson.health()).rejects.toThrow(
      "response body was not valid JSON"
    );

    const malformed = createHistoryClient({
      fetcher: async () => response(200, { projects: "not-an-array" }),
    });
    await expect(malformed.listProjects()).rejects.toMatchObject({
      name: "HistoryResponseError",
      cause: expect.objectContaining({ name: "HistoryPayloadError" }),
    });
  });

  it("wraps network failures but preserves cancellation errors", async () => {
    const networkFailure = new Error("connection refused");
    const networkClient = createHistoryClient({
      fetcher: async () => {
        throw networkFailure;
      },
    });
    await expect(networkClient.health()).rejects.toMatchObject({
      name: "HistoryNetworkError",
      cause: networkFailure,
    });
    await expect(networkClient.health()).rejects.toBeInstanceOf(
      HistoryNetworkError
    );

    const abortError = Object.assign(new Error("cancelled"), {
      name: "AbortError",
    });
    const abortClient = createHistoryClient({
      fetcher: async () => {
        throw abortError;
      },
    });
    await expect(abortClient.health()).rejects.toBe(abortError);
  });
});