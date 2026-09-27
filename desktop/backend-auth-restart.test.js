"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createBackendAuthRestarter } = require("./backend-auth-restart");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness() {
  let backendToken = null;
  let githubToken = "signed-token";
  let backendProcess = null;
  const readiness = [];
  const calls = {
    stop: 0,
    start: [],
    setProcess: [],
    setToken: [],
  };
  const restart = createBackendAuthRestarter({
    getBackendPort: () => 7001,
    getBackendToken: () => backendToken,
    setBackendToken: (token) => {
      backendToken = token;
      calls.setToken.push(token);
    },
    getGitHubToken: async () => githubToken,
    stopBackend: () => {
      calls.stop += 1;
      return true;
    },
    startBackend: (port, token) => {
      const process = { port, token, sequence: calls.start.length + 1 };
      calls.start.push(process);
      return process;
    },
    setBackendProcess: (process) => {
      backendProcess = process;
      calls.setProcess.push(process);
    },
    waitForBackend: (_port, { backendProcess: process }) => {
      const ready = deferred();
      readiness.push({ process, ready });
      return ready.promise;
    },
  });
  return {
    restart,
    readiness,
    calls,
    getBackendToken: () => backendToken,
    getBackendProcess: () => backendProcess,
    setGitHubToken: (token) => {
      githubToken = token;
    },
  };
}

test("deduplicates concurrent restarts for the same GitHub token", async () => {
  const state = harness();

  const first = state.restart();
  const second = state.restart();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(state.calls.stop, 1);
  assert.equal(state.calls.start.length, 1);
  assert.equal(state.readiness.length, 1);
  assert.equal(state.getBackendToken(), null);

  state.readiness[0].ready.resolve();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(state.calls.stop, 1);
  assert.deepEqual(state.calls.setToken, ["signed-token"]);
  assert.equal(state.getBackendProcess(), state.calls.start[0]);
});

test("queues a changed token until the in-flight restart is ready", async () => {
  const state = harness();

  const signedIn = state.restart();
  await new Promise((resolve) => setImmediate(resolve));
  state.setGitHubToken(null);
  const disconnected = state.restart();

  state.readiness[0].ready.resolve();
  assert.equal(await signedIn, true);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.calls.start.length, 2);
  assert.equal(state.calls.start[1].token, null);
  state.readiness[1].ready.resolve();

  assert.equal(await disconnected, true);
  assert.deepEqual(state.calls.setToken, ["signed-token", null]);
  assert.equal(state.calls.stop, 2);
});
