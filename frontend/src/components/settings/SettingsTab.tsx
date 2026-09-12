import React, { useEffect, useRef, useState } from "react";
import { BsCheckCircleFill, BsExclamationTriangleFill } from "react-icons/bs";
import { LuFolderOpen, LuRefreshCw, LuTrash2 } from "react-icons/lu";
import { AppTheme, EditorTheme, Settings } from "../../types";
import { capitalize } from "../../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../ui/select";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { HTTP_BACKEND_URL } from "../../config";
import toast from "react-hot-toast";

interface Props {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  appTheme: AppTheme;
  setAppTheme: React.Dispatch<React.SetStateAction<AppTheme>>;
}

function SettingsTab({ settings, setSettings, appTheme, setAppTheme }: Props) {
  // null = not yet known (loading / unreachable); otherwise the backend's answer.
  const [screenshotPreviewAvailable, setScreenshotPreviewAvailable] = useState<
    boolean | null
  >(null);
  const [copilotAvailable, setCopilotAvailable] = useState<boolean | null>(null);
  const [copilotLogin, setCopilotLogin] = useState<string | null>(null);
  const [copilotModels, setCopilotModels] = useState<
    { id: string; vision: boolean }[]
  >([]);
  const [isRefreshingCopilot, setIsRefreshingCopilot] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] =
    useState<Shot2CodeUpdateState | null>(null);
  const initialCopilotToken = useRef(settings.copilotGithubToken);

  useEffect(() => {
    let cancelled = false;
    const token = initialCopilotToken.current?.trim();
    fetch(
      token
        ? `${HTTP_BACKEND_URL}/api/copilot/capabilities`
        : `${HTTP_BACKEND_URL}/api/capabilities`,
      token
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }
        : undefined
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.screenshot_preview === "boolean") {
          setScreenshotPreviewAvailable(data.screenshot_preview);
        }
        if (!cancelled && data && typeof data.copilot === "boolean") {
          setCopilotAvailable(data.copilot);
          setCopilotLogin(data.copilot_login ?? null);
          setCopilotModels(
            Array.isArray(data.copilot_models) ? data.copilot_models : []
          );
        }
      })
      .catch(() => {
        /* leave as null — don't show a false alarm if the backend is unreachable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const desktop = window.__SHOT2CODE_APP__;
    if (!desktop) return;

    let active = true;
    void desktop
      .getAppInfo()
      .then((info) => {
        if (!active) return;
        setAppVersion(info.version);
        setUpdateState(info.update);
      })
      .catch((error) => {
        console.error("Could not load desktop app information", error);
      });
    const unsubscribe = desktop.onUpdateState((state) => {
      if (active) setUpdateState(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refreshCopilotModels = async () => {
    setIsRefreshingCopilot(true);
    try {
      const token = settings.copilotGithubToken?.trim();
      const response = await fetch(
        token
          ? `${HTTP_BACKEND_URL}/api/copilot/capabilities`
          : `${HTTP_BACKEND_URL}/api/capabilities?refresh=true`,
        token
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            }
          : undefined
      );
      if (!response.ok) return;
      const data = await response.json();
      setCopilotAvailable(Boolean(data.copilot));
      setCopilotLogin(data.copilot_login ?? null);
      setCopilotModels(
        Array.isArray(data.copilot_models) ? data.copilot_models : []
      );
    } catch {
      toast.error("Could not refresh Copilot models");
    } finally {
      setIsRefreshingCopilot(false);
    }
  };

  const handleThemeChange = (theme: EditorTheme) => {
    setSettings((s) => ({
      ...s,
      editorTheme: theme,
    }));
  };

  const checkForUpdates = async () => {
    const desktop = window.__SHOT2CODE_APP__;
    if (!desktop) return;
    setUpdateState((current) =>
      current
        ? { ...current, status: "checking", message: null }
        : current
    );
    try {
      const state = await desktop.checkForUpdates();
      setUpdateState(state);
    } catch {
      toast.error("Could not check for updates");
    }
  };

  const installDownloadedUpdate = async () => {
    const installed = await window.__SHOT2CODE_APP__?.installUpdate();
    if (installed === false) {
      toast.error("The downloaded update is no longer available");
    }
  };

  const updateStatusText = (() => {
    if (!updateState) return "";
    switch (updateState.status) {
      case "checking":
        return "Checking for updates…";
      case "current":
        return "You are up to date.";
      case "downloading":
        return `Downloading v${updateState.version ?? ""}${
          updateState.progress === null ? "" : ` · ${updateState.progress}%`
        }`;
      case "downloaded":
        return `v${updateState.version} is ready to install.`;
      case "error":
        return updateState.message || "Could not check for updates.";
      case "unavailable":
        return updateState.message || "Updates are unavailable.";
      default:
        return "Updates are checked automatically when shot2code starts.";
    }
  })();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-4 lg:px-6 lg:py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            Settings
          </h1>
        </div>

        <div className="mx-auto max-w-lg space-y-6">
          {appVersion && updateState && (
            <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
              <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
                <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                  Version and updates
                </h2>
              </div>
              <div className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-zinc-100">
                    shot2code v{appVersion}
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      updateState.status === "error"
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-500 dark:text-zinc-400"
                    }`}
                  >
                    {updateStatusText}
                  </p>
                </div>
                {updateState.status === "downloaded" ? (
                  <button
                    type="button"
                    onClick={() => void installDownloadedUpdate()}
                    className="min-h-11 cursor-pointer rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors duration-200 hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                  >
                    Restart & install
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={
                      updateState.status === "checking" ||
                      updateState.status === "downloading"
                    }
                    onClick={() => void checkForUpdates()}
                    className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors duration-200 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <LuRefreshCw
                      className={`h-3.5 w-3.5 ${
                        updateState.status === "checking" ? "animate-spin" : ""
                      }`}
                    />
                    Check now
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Theme */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Theme
              </h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-zinc-700">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm text-gray-700 dark:text-zinc-300">
                    App Theme
                  </span>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
                    System default, with optional light/dark override
                  </p>
                </div>
                <Select
                  name="app-theme"
                  value={appTheme}
                  onValueChange={(value) => setAppTheme(value as AppTheme)}
                >
                  <SelectTrigger className="w-[140px]">
                    {capitalize(appTheme)}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AppTheme.SYSTEM}>System</SelectItem>
                    <SelectItem value={AppTheme.LIGHT}>Light</SelectItem>
                    <SelectItem value={AppTheme.DARK}>Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm text-gray-700 dark:text-zinc-300">
                    Code Editor Theme
                  </span>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
                    Requires page refresh to update
                  </p>
                </div>
                <Select
                  name="editor-theme"
                  value={settings.editorTheme}
                  onValueChange={(value) =>
                    handleThemeChange(value as EditorTheme)
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <span className="notranslate" translate="no">
                      {capitalize(settings.editorTheme)}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cobalt">
                      <span className="notranslate" translate="no">Cobalt</span>
                    </SelectItem>
                    <SelectItem value="espresso">
                      <span className="notranslate" translate="no">Espresso</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {settings.projectContext && (
            <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
              <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
                <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                  Existing project context
                </h2>
              </div>
              <div className="flex items-start gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300">
                  <LuFolderOpen className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-zinc-100">
                    {settings.projectContext.name}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400">
                    {settings.projectContext.analyzed_file_count} source files,{" "}
                    {settings.projectContext.component_count} components and{" "}
                    {settings.projectContext.tokens.length} tokens/classes are
                    guiding new generations and edits.
                  </p>
                  {settings.projectContext.framework_hints.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                      {settings.projectContext.framework_hints.join(" · ")}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSettings((previous) => ({
                      ...previous,
                      projectContext: null,
                    }))
                  }
                  aria-label="Clear imported project context"
                  title="Clear project context"
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                >
                  <LuTrash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* GitHub Copilot */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                GitHub Copilot
              </h2>
            </div>
            <div className="space-y-4 p-4">
              {copilotAvailable === true ? (
                <div className="flex items-start gap-2.5">
                  <BsCheckCircleFill className="mt-0.5 shrink-0 text-emerald-500" />
                  <div>
                    <p className="text-sm text-gray-700 dark:text-zinc-300">
                      Signed in{copilotLogin ? ` as ${copilotLogin}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                      shot2code can generate using your GitHub Copilot
                      subscription — no API key needed. Pick any{" "}
                      <span className="notranslate" translate="no">
                        Copilot:
                      </span>{" "}
                      model below.
                    </p>
                  </div>
                </div>
              ) : copilotAvailable === false ? (
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Not signed in. Run{" "}
                  <code className="rounded bg-gray-100 px-1 dark:bg-zinc-700">
                    gh auth login
                  </code>{" "}
                  or{" "}
                  <code className="rounded bg-gray-100 px-1 dark:bg-zinc-700">
                    copilot
                  </code>{" "}
                  in a terminal, or paste a token below. Requires an active
                  Copilot subscription.
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Checking GitHub Copilot sign-in…
                </p>
              )}

              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                    Models
                  </p>
                  <button
                    type="button"
                    onClick={() => void refreshCopilotModels()}
                    disabled={isRefreshingCopilot}
                    className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-violet-600 transition-colors duration-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:text-violet-400 dark:hover:bg-violet-950/30"
                  >
                    <LuRefreshCw
                      className={`h-3.5 w-3.5 ${
                        isRefreshingCopilot ? "animate-spin" : ""
                      }`}
                    />
                    Refresh
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  {copilotModels.length > 0
                    ? "Pick which models to generate with. Each generation produces one variant per selected model. Leave all unchecked to let shot2code choose."
                    : copilotAvailable
                      ? "No models are cached yet. Refresh to query the models your Copilot plan currently offers."
                      : "Sign in to see the models your Copilot plan offers."}
                </p>

                {copilotModels.length > 0 && (
                  <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2 dark:border-zinc-700">
                    {copilotModels
                      .filter((m) => m.vision)
                      .map((m) => {
                        const value = `copilot/${m.id}`;
                        const checked = (settings.copilotModels ?? []).includes(value);
                        return (
                          <label
                            key={m.id}
                            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-zinc-800"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSettings((s) => ({
                                  ...s,
                                  copilotModels: e.target.checked
                                    ? [...(s.copilotModels ?? []), value]
                                    : (s.copilotModels ?? []).filter((v) => v !== value),
                                }))
                              }
                            />
                            <span className="notranslate" translate="no">
                              {m.id}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                )}

                {copilotModels.some((m) => !m.vision) && (
                  <p className="mt-2 text-xs text-gray-400 dark:text-zinc-500">
                    {copilotModels.filter((m) => !m.vision).length} model(s)
                    hidden because they can't read images, which shot2code
                    requires.
                  </p>
                )}

                {(settings.copilotModels ?? []).length > 0 && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-violet-600 hover:underline dark:text-violet-400"
                    onClick={() =>
                      setSettings((s) => ({ ...s, copilotModels: [] }))
                    }
                  >
                    Clear selection ({(settings.copilotModels ?? []).length} selected)
                  </button>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                  GitHub token (optional)
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  Only needed if you aren't already signed in. Use a
                  fine-grained token with the "Copilot Requests" permission.
                  Stored on this device only.
                </p>
                <Input
                  id="copilot-github-token"
                  className="mt-2"
                  type="password"
                  placeholder="github_pat_..."
                  value={settings.copilotGithubToken || ""}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      copilotGithubToken: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* API Keys */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                API Keys
              </h2>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                  OpenAI API key
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  Stored on this device only. Overrides
                  your .env config.
                </p>
                <Input
                  id="openai-api-key"
                  className="mt-2"
                  placeholder="OpenAI API key"
                  value={settings.openAiApiKey || ""}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      openAiApiKey: e.target.value,
                    }))
                  }
                />
              </div>

              {(
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                    OpenAI Base URL (optional)
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                    Replace with a proxy URL if you don't want to use the
                    default.
                  </p>
                  <Input
                    id="openai-base-url"
                    className="mt-2"
                    placeholder="OpenAI Base URL"
                    value={settings.openAiBaseURL || ""}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        openAiBaseURL: e.target.value,
                      }))
                    }
                  />
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                  Anthropic API key
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  Stored on this device only. Overrides
                  your .env config.
                </p>
                <Input
                  id="anthropic-api-key"
                  className="mt-2"
                  placeholder="Anthropic API key"
                  value={settings.anthropicApiKey || ""}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      anthropicApiKey: e.target.value,
                    }))
                  }
                />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                  Gemini API key
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                  Stored on this device only. Overrides
                  your .env config.
                </p>
                <Input
                  id="gemini-api-key"
                  className="mt-2"
                  placeholder="Gemini API key"
                  value={settings.geminiApiKey || ""}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      geminiApiKey: e.target.value,
                    }))
                  }
                />
              </div>

              {(
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
                    Replicate API key
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                    Stored on this device only. Overrides
                    your .env config for image generation and editing.
                  </p>
                  <Input
                    id="replicate-api-key"
                    className="mt-2"
                    placeholder="Replicate API key"
                    value={settings.replicateApiKey || ""}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        replicateApiKey: e.target.value,
                      }))
                    }
                  />
                </div>
              )}
            </div>
          </div>

          {/* Image Generation */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Image Generation
              </h2>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-700 dark:text-zinc-300">
                    Placeholder Images
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                    More fun with it but if you want to save money, turn it off.
                  </p>
                </div>
                <Switch
                  id="image-generation"
                  checked={settings.isImageGenerationEnabled}
                  onCheckedChange={(checked) =>
                    setSettings((s) => ({
                      ...s,
                      isImageGenerationEnabled: checked,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Screenshot Preview (agent self-verification) */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Screenshot Preview
              </h2>
            </div>
            <div className="p-4">
              {screenshotPreviewAvailable === false ? (
                <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20">
                  <BsExclamationTriangleFill className="mt-0.5 shrink-0 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Screenshot preview is unavailable
                    </p>
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      Headless Chromium isn't installed on the backend, so the
                      agent can't render and visually verify its own output.
                      Install it with{" "}
                      <code className="rounded bg-amber-100 px-1 py-0.5 font-mono dark:bg-amber-900/40">
                        playwright install chromium
                      </code>{" "}
                      and restart the backend.
                    </p>
                  </div>
                </div>
              ) : screenshotPreviewAvailable === true ? (
                <div className="flex items-start gap-2.5">
                  <BsCheckCircleFill className="mt-0.5 shrink-0 text-emerald-500" />
                  <div>
                    <p className="text-sm text-gray-700 dark:text-zinc-300">
                      Available
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
                      The agent renders your generated page in a headless browser
                      to visually check its work and fix layout issues.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Checking backend capabilities…
                </p>
              )}
            </div>
          </div>

          {/* Screenshot by URL */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Screenshot by URL
              </h2>
            </div>
            <div className="p-4">
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                If you want to use URLs directly instead of taking the screenshot
                yourself, add a ScreenshotOne API key.{" "}
                <a
                  href="https://screenshotone.com?via=screenshot-to-code"
                  className="text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                  target="_blank"
                >
                  Get 100 screenshots/mo for free.
                </a>
              </p>
              <Input
                id="screenshot-one-api-key"
                className="mt-3"
                placeholder="ScreenshotOne API key"
                value={settings.screenshotOneApiKey || ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    screenshotOneApiKey: e.target.value,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsTab;
