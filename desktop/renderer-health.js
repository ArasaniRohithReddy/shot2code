"use strict";

const DEFAULT_RENDERER_HEALTH_DELAY_MS = 4000;

function isBlankRendererSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      snapshot.readyState === "complete" &&
      Number(snapshot.rootChildren || 0) === 0 &&
      Number(snapshot.bodyTextLength || 0) === 0
  );
}

function createRendererHealthGuard({
  inspect,
  reload,
  showFallback,
  log,
  delay = DEFAULT_RENDERER_HEALTH_DELAY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let recoveryAttempts = 0;
  let timer = null;
  let disposed = false;

  const verify = async () => {
    timer = null;
    if (disposed) return;
    let snapshot;
    try {
      snapshot = await inspect();
    } catch (error) {
      log(`renderer health inspection failed: ${error?.name || "Error"}`);
      return;
    }
    if (!isBlankRendererSnapshot(snapshot)) return;

    if (recoveryAttempts === 0) {
      recoveryAttempts = 1;
      log("renderer was blank after load; reloading once");
      await reload();
      return;
    }

    log("renderer stayed blank after reload; showing recovery screen");
    await showFallback();
  };

  return {
    onDidFinishLoad() {
      if (disposed) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        void verify();
      }, delay);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

module.exports = {
  DEFAULT_RENDERER_HEALTH_DELAY_MS,
  createRendererHealthGuard,
  isBlankRendererSnapshot,
};
