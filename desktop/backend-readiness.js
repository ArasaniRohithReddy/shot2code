"use strict";

const http = require("node:http");

const DEFAULT_BACKEND_READY_TIMEOUT_MS = 90_000;
const DEFAULT_HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_HEALTH_BODY_BYTES = 4_096;

function formatTimeout(timeoutMs) {
  return timeoutMs < 1_000
    ? `${timeoutMs}ms`
    : `${Math.round(timeoutMs / 1_000)} seconds`;
}

function checkBackendHealth(
  port,
  {
    httpModule = http,
    requestTimeoutMs = DEFAULT_HEALTH_REQUEST_TIMEOUT_MS,
  } = {}
) {
  return new Promise((resolve) => {
    const request = httpModule.get(
      {
        host: "127.0.0.1",
        port,
        path: "/api/health",
        timeout: requestTimeoutMs,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length <= MAX_HEALTH_BODY_BYTES) body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            resolve(false);
            return;
          }
          try {
            const parsed = JSON.parse(body);
            resolve(parsed && parsed.ok === true);
          } catch {
            resolve(false);
          }
        });
        response.on("error", () => resolve(false));
      }
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => request.destroy());
  });
}

function backendExitError(code, signal) {
  const detail =
    code !== null && code !== undefined
      ? `code ${code}`
      : signal
        ? `signal ${signal}`
        : "an unknown status";
  return new Error(`Backend exited before becoming ready (${detail}).`);
}

function waitForBackend(
  port,
  {
    backendProcess,
    timeoutMs = DEFAULT_BACKEND_READY_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    checkHealth = () => checkBackendHealth(port),
  } = {}
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let retryTimer = null;
    let timeoutTimer = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (retryTimer) clearTimeout(retryTimer);
      backendProcess?.removeListener?.("exit", onExit);
      backendProcess?.removeListener?.("error", onError);
      error ? reject(error) : resolve();
    };

    const onExit = (code, signal) => finish(backendExitError(code, signal));
    const onError = (error) =>
      finish(new Error(`Backend failed to start: ${error.message}`));

    if (
      backendProcess &&
      (backendProcess.exitCode !== null || backendProcess.signalCode !== null)
    ) {
      finish(
        backendExitError(
          backendProcess.exitCode,
          backendProcess.signalCode
        )
      );
      return;
    }

    backendProcess?.once?.("exit", onExit);
    backendProcess?.once?.("error", onError);

    timeoutTimer = setTimeout(() => {
      finish(
        new Error(
          `Backend did not become ready within ${formatTimeout(timeoutMs)}.`
        )
      );
    }, timeoutMs);

    const attempt = async () => {
      if (settled) return;
      let healthy = false;
      try {
        healthy = await checkHealth();
      } catch {
        healthy = false;
      }
      if (settled) return;
      if (healthy) {
        finish();
        return;
      }
      retryTimer = setTimeout(attempt, retryDelayMs);
    };

    void attempt();
  });
}

module.exports = {
  DEFAULT_BACKEND_READY_TIMEOUT_MS,
  checkBackendHealth,
  waitForBackend,
};
