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
    onUpdateState: (
      callback: (state: Shot2CodeUpdateState) => void
    ) => () => void;
  };
}
