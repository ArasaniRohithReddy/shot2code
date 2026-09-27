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

type Shot2CodeStitchPhase =
  | "connecting"
  | "creating-project"
  | "generating-screen"
  | "loading-screen"
  | "downloading-output"
  | "complete";

interface Shot2CodeStitchProgress {
  requestId: string;
  phase: Shot2CodeStitchPhase;
  message: string;
  elapsedMs: number;
}

type Shot2CodeFeedbackType = "bug" | "feature" | "feedback";

interface Shot2CodeFeedbackPayload {
  type: Shot2CodeFeedbackType;
  title: string;
  details: string;
  steps?: string;
  expected?: string;
  actual?: string;
  includeSystemDetails: boolean;
}

type Shot2CodeFeedbackResult =
  | {
      kind: "submitted";
      message: string;
      url: string;
      title: string;
      body: string;
      issueUrl: string;
    }
  | {
      kind: "fallback";
      reason: string;
      title: string;
      body: string;
      issueUrl: string;
    };

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
    generateStitch: (
      payload: {
        apiKey: string;
        prompt: string;
        deviceType?: "MOBILE" | "DESKTOP" | "TABLET" | "AGNOSTIC";
        stack?: string;
      },
      onProgress?: (progress: Shot2CodeStitchProgress) => void
    ) => Promise<Shot2CodeStitchResult>;
    importStitch: (
      payload: {
        apiKey: string;
        url: string;
      },
      onProgress?: (progress: Shot2CodeStitchProgress) => void
    ) => Promise<Shot2CodeStitchResult>;
    submitFeedback: (
      payload: Shot2CodeFeedbackPayload
    ) => Promise<Shot2CodeFeedbackResult>;
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
