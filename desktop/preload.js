// Preload runs before the renderer and is the only place with access to both
// Node and the page. The backend port is picked at runtime, but Vite bakes env
// vars at build time, so the resolved URLs are handed to the app here instead.
const { contextBridge, ipcRenderer } = require("electron");
const backendUrls =
  ipcRenderer.sendSync("shot2code:get-backend-urls") || {};
let stitchRequestSequence = 0;

function nextStitchRequestId() {
  stitchRequestSequence += 1;
  return `stitch-${Date.now().toString(36)}-${stitchRequestSequence.toString(36)}`;
}

function invokeStitchWithProgress(channel, payload, onProgress) {
  const requestId = nextStitchRequestId();
  const listener = (_event, progress) => {
    if (progress?.requestId !== requestId || typeof onProgress !== "function") {
      return;
    }
    onProgress(progress);
  };
  ipcRenderer.on("shot2code:stitch-progress", listener);
  return ipcRenderer
    .invoke(channel, { ...payload, requestId })
    .finally(() =>
      ipcRenderer.removeListener("shot2code:stitch-progress", listener)
    );
}

contextBridge.exposeInMainWorld("__SHOT2CODE_BACKEND__", {
  http:
    typeof backendUrls.http === "string"
      ? backendUrls.http
      : process.env.SHOT2CODE_BACKEND_HTTP || "",
  ws:
    typeof backendUrls.ws === "string"
      ? backendUrls.ws
      : process.env.SHOT2CODE_BACKEND_WS || "",
});

contextBridge.exposeInMainWorld("__SHOT2CODE_APP__", {
  openLogs: () => ipcRenderer.invoke("shot2code:open-logs"),
  getAppInfo: () => ipcRenderer.invoke("shot2code:get-app-info"),
  checkForUpdates: () => ipcRenderer.invoke("shot2code:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("shot2code:install-update"),
  testStitchKey: (payload) =>
    ipcRenderer.invoke("shot2code:stitch-test", payload),
  generateStitch: (payload, onProgress) =>
    invokeStitchWithProgress(
      "shot2code:stitch-generate",
      payload,
      onProgress
    ),
  importStitch: (payload, onProgress) =>
    invokeStitchWithProgress("shot2code:stitch-import", payload, onProgress),
  submitFeedback: (payload) =>
    ipcRenderer.invoke("shot2code:submit-feedback", payload),
  startGitHubOAuth: () => ipcRenderer.invoke("shot2code:github-oauth-start"),
  getGitHubOAuthStatus: () =>
    ipcRenderer.invoke("shot2code:github-oauth-status"),
  cancelGitHubOAuth: () =>
    ipcRenderer.invoke("shot2code:github-oauth-cancel"),
  disconnectGitHubOAuth: () =>
    ipcRenderer.invoke("shot2code:github-oauth-disconnect"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("shot2code:update-state", listener);
    return () => ipcRenderer.removeListener("shot2code:update-state", listener);
  },
  // The native menu sends the same typed commands the keyboard shortcuts use,
  // so the renderer runs one dispatcher for both instead of two code paths.
  onMenuCommand: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("shot2code:menu-command", listener);
    return () =>
      ipcRenderer.removeListener("shot2code:menu-command", listener);
  },
  // Tells the menu what it may offer: whether a project is open, whether it
  // can be exported yet, and whether the Chat panel is showing.
  setMenuState: (state) => ipcRenderer.send("shot2code:menu-state", state),
});
