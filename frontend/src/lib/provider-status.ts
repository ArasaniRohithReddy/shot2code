import type { Settings } from "../types";

/**
 * What the browser can honestly say about model access.
 *
 * The frontend only sees the keys saved in this browser. Generation can also
 * succeed on credentials it cannot inspect: a `gh auth login` session, a stored
 * Copilot login, or a key in `backend/.env`. So this module never claims a
 * provider is "connected" or "missing" - it reports what is configured here and
 * names the fallbacks, leaving the verdict to the actual generation attempt.
 */

export type ProviderId = "copilot" | "openai" | "anthropic" | "gemini";

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
}

export type ProviderSettings = Pick<
  Settings,
  "copilotGithubToken" | "openAiApiKey" | "anthropicApiKey" | "geminiApiKey"
>;

export interface ProviderStatusSummary {
  /** `true` when at least one credential is saved in this browser. */
  hasLocalCredentials: boolean;
  configured: ProviderDescriptor[];
  title: string;
  detail: string;
}

const PROVIDER_ORDER: Array<{
  id: ProviderId;
  label: string;
  read: (settings: ProviderSettings) => string | null | undefined;
}> = [
  { id: "copilot", label: "GitHub Copilot", read: (s) => s.copilotGithubToken },
  { id: "openai", label: "OpenAI", read: (s) => s.openAiApiKey },
  { id: "anthropic", label: "Anthropic", read: (s) => s.anthropicApiKey },
  { id: "gemini", label: "Gemini", read: (s) => s.geminiApiKey },
];

export function getConfiguredProviders(
  settings: ProviderSettings
): ProviderDescriptor[] {
  return PROVIDER_ORDER.filter(
    (provider) => (provider.read(settings) ?? "").trim().length > 0
  ).map(({ id, label }) => ({ id, label }));
}

export function formatProviderList(providers: ProviderDescriptor[]): string {
  const labels = providers.map((provider) => provider.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function summarizeProviderStatus(
  settings: ProviderSettings
): ProviderStatusSummary {
  const configured = getConfiguredProviders(settings);

  if (configured.length > 0) {
    return {
      hasLocalCredentials: true,
      configured,
      title: `${formatProviderList(configured)} saved on this device`,
      detail:
        "Credentials stay in this browser and are only sent to the provider you select.",
    };
  }

  return {
    hasLocalCredentials: false,
    configured,
    title: "No model provider saved in this browser",
    detail:
      "shot2code will try credentials it cannot see from here first - a GitHub Copilot sign-in or a key in backend/.env. Add your own key if a generation fails.",
  };
}
