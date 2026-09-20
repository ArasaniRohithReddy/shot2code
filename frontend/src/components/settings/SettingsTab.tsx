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
import ModelCatalogPicker from "./ModelCatalogPicker";
import CopilotSdkByokSettings from "./CopilotSdkByokSettings";
import McpServersSettings from "./McpServersSettings";
import CopilotSignIn from "./CopilotSignIn";
import ProviderConnectionChecks from "./ProviderConnectionChecks";
import { useModelCatalog } from "../../hooks/useModelCatalog";
import {
  credentialsFromSettings,
  describeSelectionHint,
  selectionProviderOf,
} from "../../lib/model-selection";
import { DEFAULT_COPILOT_SDK_BYOK_SETTINGS } from "../../lib/copilot-sdk-byok";
import { describeMcpScope, mcpRuntimeScope } from "../../lib/integrations";
import {
  describePreviewRemediation,
  isPackagedDesktopRuntime,
} from "../../lib/screenshot-preview-help";
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
  const [showDeprecatedModels, setShowDeprecatedModels] = useState(false);
  const [isCheckingCapabilities, setIsCheckingCapabilities] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] =
    useState<Shot2CodeUpdateState | null>(null);
  const initialCopilotToken = useRef(settings.copilotGithubToken);

  const byokSettings =
    settings.copilotSdkByok ?? DEFAULT_COPILOT_SDK_BYOK_SETTINGS;
  const mcpServers = settings.mcpServers ?? [];

  const {
    catalog,
    isLoading: isCatalogLoading,
    error: catalogError,
    staleModels,
    integrationDiagnostics,
    refresh: refreshCatalog,
  } = useModelCatalog({
    credentials: credentialsFromSettings(settings),
    selectedModels: settings.selectedModels ?? [],
    copilotSdkByok: byokSettings,
  });

  const selectedModels = settings.selectedModels ?? [];
  // A native pick always runs on its native provider, so nothing is re-routed
  // and there is no conflict to report. MCP scope is still worth saying,
  // because only the SDK runtimes see those tools.
  const mcpScope = mcpRuntimeScope(
    { copilotSdkByok: byokSettings, mcpServers },
    selectedModels,
    (modelId) => selectionProviderOf(catalog, modelId)
  );
  const mcpScopeNote = mcpScope.hasActiveServers ? describeMcpScope(mcpScope) : null;

  // The fix for a missing preview browser is entirely different when the
  // bundled desktop build cannot start its own copy, so the guidance is chosen
  // from the runtime rather than assuming a source checkout.
  const previewHelp = describePreviewRemediation(isPackagedDesktopRuntime());

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

  // Re-probing Copilot goes through the same refresh so the sign-in line and
  // the model list can never disagree about who is signed in.
  const refreshModelCatalog = async () => {
    try {
      await refreshCatalog();
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
    } catch {
      toast.error("Could not refresh the model list");
    }
  };

  const handleThemeChange = (theme: EditorTheme) => {
    setSettings((s) => ({
      ...s,
      editorTheme: theme,
    }));
  };

  // Re-probe the backend's optional capabilities on demand. The screenshot
  // preview is the one users most often fix outside the app - installing the
  // browser, or restarting after antivirus released it - so it needs a way to
  // re-ask without restarting shot2code itself.
  const recheckCapabilities = async () => {
    setIsCheckingCapabilities(true);
    try {
      const response = await fetch(
        `${HTTP_BACKEND_URL}/api/capabilities?refresh=true`
      );
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (typeof data.screenshot_preview === "boolean") {
        setScreenshotPreviewAvailable(data.screenshot_preview);
      }
      if (typeof data.copilot === "boolean") {
        setCopilotAvailable(data.copilot);
        setCopilotLogin(data.copilot_login ?? null);
      }
    } catch {
      toast.error("Could not reach the backend to check again");
    } finally {
      setIsCheckingCapabilities(false);
    }
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
    <div
      data-testid="settings-scroll-container"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
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

          {/* Models */}
          <div className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
              <h2 className="text-sm font-medium text-gray-900 dark:text-white">
                Models
              </h2>
              <button
                type="button"
                onClick={() => void refreshModelCatalog()}
                disabled={isCatalogLoading}
                className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-violet-600 transition-colors duration-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 dark:text-violet-400 dark:hover:bg-violet-950/30"
              >
                <LuRefreshCw
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 ${
                    isCatalogLoading ? "animate-spin" : ""
                  }`}
                />
                Refresh
              </button>
            </div>
            <div className="space-y-3 p-4">
              {catalogError && (
                <p
                  role="alert"
                  className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                >
                  {catalogError}
                </p>
              )}
              <ModelCatalogPicker
                catalog={catalog}
                selectedModels={settings.selectedModels ?? []}
                onToggleModel={(modelId) =>
                  setSettings((s) => {
                    const current = s.selectedModels ?? [];
                    return {
                      ...s,
                      selectedModels: current.includes(modelId)
                        ? current.filter((entry) => entry !== modelId)
                        : [...current, modelId],
                    };
                  })
                }
                onClearSelection={() =>
                  setSettings((s) => ({ ...s, selectedModels: [] }))
                }
                onRemoveStale={() =>
                  setSettings((s) => ({
                    ...s,
                    selectedModels: (s.selectedModels ?? []).filter(
                      (entry) => !staleModels.includes(entry)
                    ),
                  }))
                }
                staleModels={staleModels}
                showDeprecated={showDeprecatedModels}
                onShowDeprecatedChange={setShowDeprecatedModels}
                hint={describeSelectionHint(settings.selectedModels ?? [], {
                  generationType: "create",
                  inputMode: "image",
                })}
                idPrefix="settings-model"
                integrationDiagnostics={integrationDiagnostics}
                mcpScopeNote={mcpScopeNote}
              />
            </div>
          </div>

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
                      subscription — no API key needed. Its models appear under{" "}
                      <span className="notranslate" translate="no">
                        GitHub Copilot
                      </span>{" "}
                      in Models above.
                    </p>
                  </div>
                </div>
              ) : copilotAvailable === false ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500 dark:text-zinc-400">
                    Not signed in. Sign in below, or run{" "}
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
                  <CopilotSignIn onSignedIn={refreshModelCatalog} />
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Checking GitHub Copilot sign-in…
                </p>
              )}

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
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
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
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
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
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
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
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
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

              <ProviderConnectionChecks
                settings={settings}
                catalog={catalog}
                selectedModels={selectedModels}
              />
            </div>
          </div>

          {/* Copilot SDK BYOK — an additive runtime, never a re-route */}
          <CopilotSdkByokSettings
            settings={byokSettings}
            onChange={(update) =>
              setSettings((s) => ({
                ...s,
                copilotSdkByok: update(
                  s.copilotSdkByok ?? DEFAULT_COPILOT_SDK_BYOK_SETTINGS
                ),
              }))
            }
            mcpServers={mcpServers}
            selectedModels={selectedModels}
          />

          {/* MCP servers — Copilot and Copilot SDK BYOK runs only */}
          <McpServersSettings
            servers={mcpServers}
            onChange={(update) =>
              setSettings((s) => ({ ...s, mcpServers: update(s.mcpServers ?? []) }))
            }
            copilotSdkByok={byokSettings}
            scopeNote={mcpScopeNote}
          />

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
                <div
                  data-testid="screenshot-preview-unavailable"
                  data-runtime={previewHelp.runtime}
                  className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20"
                >
                  <BsExclamationTriangleFill className="mt-0.5 shrink-0 text-amber-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {previewHelp.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">
                      {previewHelp.body}
                    </p>
                    {previewHelp.command && (
                      <code className="mt-1.5 block overflow-x-auto whitespace-pre rounded bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                        {previewHelp.command}
                      </code>
                    )}
                    <p className="mt-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300">
                      {previewHelp.followUp}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void recheckCapabilities()}
                        disabled={isCheckingCapabilities}
                        data-testid="screenshot-preview-recheck"
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-wait disabled:opacity-60 dark:border-amber-700/60 dark:text-amber-100 dark:hover:bg-amber-900/40"
                      >
                        <LuRefreshCw
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 ${
                            isCheckingCapabilities ? "animate-spin" : ""
                          }`}
                        />
                        {isCheckingCapabilities ? "Checking…" : "Check again"}
                      </button>
                      {previewHelp.showLogAction && (
                        <button
                          type="button"
                          onClick={() =>
                            void window.__SHOT2CODE_APP__?.openLogs()
                          }
                          data-testid="screenshot-preview-open-logs"
                          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-700/60 dark:text-amber-100 dark:hover:bg-amber-900/40"
                        >
                          <LuFolderOpen
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                          />
                          Open diagnostic log
                        </button>
                      )}
                    </div>
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
                type="password"
                autoComplete="off"
                spellCheck={false}
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
