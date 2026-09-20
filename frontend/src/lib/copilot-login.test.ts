jest.mock("../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import {
  IDLE_COPILOT_LOGIN,
  cancelCopilotLogin,
  describeCopilotLoginMethod,
  isPollingLoginStatus,
  isTerminalLoginStatus,
  isTrustedInstallUrl,
  parseCopilotLoginState,
  pollCopilotLogin,
  startCopilotLogin,
} from "./copilot-login";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseCopilotLoginState", () => {
  it("reads the documented shape", () => {
    const state = parseCopilotLoginState({
      status: "waiting",
      method: "copilot-cli",
      message: "Finish signing in in your browser.",
      login: "octocat",
      canCancel: true,
      installUrl: "https://github.com/github/copilot-cli",
    });

    expect(state).toEqual({
      status: "waiting",
      method: "copilot-cli",
      message: "Finish signing in in your browser.",
      login: "octocat",
      canCancel: true,
      installUrl: "https://github.com/github/copilot-cli",
    });
  });

  it("falls back to idle for junk and unknown enum values", () => {
    expect(parseCopilotLoginState(null)).toEqual(IDLE_COPILOT_LOGIN);
    expect(parseCopilotLoginState("nope")).toEqual(IDLE_COPILOT_LOGIN);

    const state = parseCopilotLoginState({
      status: "definitely-not-a-status",
      method: "carrier-pigeon",
    });
    expect(state.status).toBe("idle");
    expect(state.method).toBeNull();
    expect(state.login).toBeNull();
  });

  it("never offers to cancel a flow that already stopped", () => {
    const succeeded = parseCopilotLoginState({
      status: "succeeded",
      canCancel: true,
    });
    expect(succeeded.canCancel).toBe(false);

    const waiting = parseCopilotLoginState({
      status: "waiting",
      canCancel: true,
    });
    expect(waiting.canCancel).toBe(true);
  });

  it("only keeps an https install link", () => {
    expect(isTrustedInstallUrl("https://example.com/install")).toBe(true);
    expect(isTrustedInstallUrl("http://example.com/install")).toBe(false);
    expect(isTrustedInstallUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedInstallUrl("file:///etc/passwd")).toBe(false);
    expect(isTrustedInstallUrl("")).toBe(false);

    expect(
      parseCopilotLoginState({
        status: "unavailable",
        installUrl: "javascript:alert(1)",
      }).installUrl
    ).toBeNull();
  });

  it("classifies polling and terminal statuses", () => {
    expect(isPollingLoginStatus("starting")).toBe(true);
    expect(isPollingLoginStatus("waiting")).toBe(true);
    expect(isPollingLoginStatus("succeeded")).toBe(false);

    expect(isTerminalLoginStatus("succeeded")).toBe(true);
    expect(isTerminalLoginStatus("failed")).toBe(true);
    expect(isTerminalLoginStatus("cancelled")).toBe(true);
    expect(isTerminalLoginStatus("unavailable")).toBe(true);
    expect(isTerminalLoginStatus("waiting")).toBe(false);
  });

  it("names the CLI driving the flow", () => {
    expect(describeCopilotLoginMethod("copilot-cli")).toBe(
      "GitHub Copilot CLI"
    );
    expect(describeCopilotLoginMethod("github-cli")).toBe("GitHub CLI");
    expect(describeCopilotLoginMethod(null)).toBeNull();
  });
});

describe("the login endpoints", () => {
  it("uses POST to start, GET to poll and DELETE to cancel one route", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ status: "waiting", canCancel: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await startCopilotLogin();
    await pollCopilotLogin();
    await cancelCopilotLogin();

    const [urls, methods] = [
      fetchMock.mock.calls.map((call) => call[0]),
      fetchMock.mock.calls.map((call) => call[1]?.method),
    ];
    expect(new Set(urls)).toEqual(
      new Set(["http://127.0.0.1:7001/api/copilot/login"])
    );
    expect(methods).toEqual(["POST", "GET", "DELETE"]);
  });

  it("never sends a credential of any kind", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ status: "starting" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await startCopilotLogin();

    // The whole point of delegating to the CLI is that shot2code has no token
    // to send and none to receive.
    expect(fetchMock.mock.calls[0][1]?.body).toBe("{}");
  });

  it("degrades to unavailable on a backend without the route", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;

    const state = await startCopilotLogin();
    expect(state.status).toBe("unavailable");
    expect(state.message).toContain("gh auth login");
  });

  it("prefers the backend's own wording on an error response", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(
        { status: "failed", message: "The Copilot CLI exited with code 1." },
        500
      )
    ) as unknown as typeof fetch;

    const state = await startCopilotLogin();
    expect(state.status).toBe("failed");
    expect(state.message).toBe("The Copilot CLI exited with code 1.");
  });

  it("throws when an error response carries nothing readable", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    }) as unknown as typeof fetch;

    await expect(startCopilotLogin()).rejects.toThrow("502");
  });
});
