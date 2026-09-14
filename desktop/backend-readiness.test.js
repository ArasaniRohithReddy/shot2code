"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const { test } = require("node:test");
const {
  DEFAULT_BACKEND_READY_TIMEOUT_MS,
  checkBackendHealth,
  waitForBackend,
} = require("./backend-readiness");

function fakeBackendProcess() {
  const process = new EventEmitter();
  process.exitCode = null;
  process.signalCode = null;
  return process;
}

test("uses a bounded 90 second default readiness target", () => {
  assert.equal(DEFAULT_BACKEND_READY_TIMEOUT_MS, 90_000);
});

test("resolves after the real health payload becomes ready", async () => {
  const backendProcess = fakeBackendProcess();
  let attempts = 0;

  await waitForBackend(7001, {
    backendProcess,
    timeoutMs: 500,
    retryDelayMs: 1,
    checkHealth: async () => {
      attempts += 1;
      return attempts >= 3;
    },
  });

  assert.equal(attempts, 3);
});

test("a hanging health request cannot bypass the overall timeout", async () => {
  const backendProcess = fakeBackendProcess();
  const started = Date.now();

  await assert.rejects(
    waitForBackend(7001, {
      backendProcess,
      timeoutMs: 25,
      checkHealth: () => new Promise(() => {}),
    }),
    /within 25ms/
  );

  assert.ok(Date.now() - started < 250);
});

test("backend exit fails immediately instead of waiting for the timeout", async () => {
  const backendProcess = fakeBackendProcess();
  const readiness = waitForBackend(7001, {
    backendProcess,
    timeoutMs: 1_000,
    checkHealth: () => new Promise(() => {}),
  });

  backendProcess.emit("exit", 7, null);

  await assert.rejects(readiness, /code 7/);
});

test("an already exited backend is rejected", async () => {
  const backendProcess = fakeBackendProcess();
  backendProcess.exitCode = 2;

  await assert.rejects(
    waitForBackend(7001, {
      backendProcess,
      timeoutMs: 1_000,
    }),
    /code 2/
  );
});

test("health requires HTTP 200 with an explicit ok true body", async (t) => {
  let response = {
    status: 200,
    body: JSON.stringify({ ok: true, feature_routes: "not_loaded" }),
  };
  const server = http.createServer((_request, result) => {
    result.writeHead(response.status, { "content-type": "application/json" });
    result.end(response.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();

  assert.equal(await checkBackendHealth(port), true);

  response = { status: 200, body: JSON.stringify({ ok: false }) };
  assert.equal(await checkBackendHealth(port), false);

  response = { status: 204, body: "" };
  assert.equal(await checkBackendHealth(port), false);

  response = { status: 200, body: "not json" };
  assert.equal(await checkBackendHealth(port), false);
});
