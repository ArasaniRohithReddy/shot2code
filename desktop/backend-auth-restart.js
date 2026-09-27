"use strict";

function createBackendAuthRestarter({
  getBackendPort,
  getBackendToken,
  setBackendToken,
  getGitHubToken,
  stopBackend,
  startBackend,
  setBackendProcess,
  waitForBackend,
  log = () => {},
}) {
  let restartPromise = null;

  return async function restartBackendForGitHubAuth() {
    while (true) {
      if (restartPromise) {
        await restartPromise;
        continue;
      }

      const port = getBackendPort();
      if (!port) return false;

      const token = await getGitHubToken();
      if (token === getBackendToken()) return true;

      // Another caller may have entered while the token lookup was pending.
      if (restartPromise) continue;

      const task = (async () => {
        if (!stopBackend()) return false;
        const backendProcess = startBackend(port, token);
        setBackendProcess(backendProcess);
        await waitForBackend(port, { backendProcess });
        setBackendToken(token);
        log("backend restarted for GitHub authentication");
        return true;
      })();
      restartPromise = task;

      try {
        return await task;
      } finally {
        if (restartPromise === task) restartPromise = null;
      }
    }
  };
}

module.exports = { createBackendAuthRestarter };
