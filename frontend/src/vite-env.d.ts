/// <reference types="vite/client" />

type Shot2CodeUpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "downloading"
  | "downloaded"
  | "error"
  | "unavailable";

interface Shot2CodeUpdateState {
  status: Shot2CodeUpdateStatus;
  currentVersion: string;
  version: string | null;
  progress: number | null;
  message: string | null;
}

interface Shot2CodeMenuState {
  hasProject: boolean;
  canExport: boolean;
  isChatPanelVisible: boolean;
}

interface Shot2CodeStitchResult {
  projectId: string;
  screenId: string;
  html: string;
  image: string;
}

interface Window {
  __SHOT2CODE_BACKEND__?: {
    http?: string;
    ws?: string;
  };
  __SHOT2CODE_APP__?: {
    openLogs: () => Promise<string>;
    getAppInfo: () => Promise<{
      version: string;
      update: Shot2CodeUpdateState;
    }>;
    checkForUpdates: () => Promise<Shot2CodeUpdateState>;
    installUpdate: () => Promise<boolean>;
    testStitchKey: (payload: { apiKey: string }) => Promise<{
      ok: boolean;
      toolCount: number;
      message: string;
    }>;
    generateStitch: (payload: {
      apiKey: string;
      prompt: string;
      deviceType?: "MOBILE" | "DESKTOP" | "TABLET" | "AGNOSTIC";
    }) => Promise<Shot2CodeStitchResult>;
    importStitch: (payload: {
      apiKey: string;
      url: string;
    }) => Promise<Shot2CodeStitchResult>;
    startGitHubOAuth: () => Promise<unknown>;
    getGitHubOAuthStatus: () => Promise<unknown>;
    cancelGitHubOAuth: () => Promise<unknown>;
    disconnectGitHubOAuth: () => Promise<unknown>;
    onUpdateState: (
      callback: (state: Shot2CodeUpdateState) => void
    ) => () => void;
    /**
     * Native menu -> renderer. The payload is typed as unknown because it
     * crosses a process boundary; `readDesktopMenuCommand` validates it.
     */
    onMenuCommand: (callback: (payload: unknown) => void) => () => void;
    /** Renderer -> native menu: what the menu may offer right now. */
    setMenuState: (state: Shot2CodeMenuState) => void;
  };
}
