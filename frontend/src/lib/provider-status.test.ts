import {
  formatProviderList,
  getConfiguredProviders,
  summarizeProviderStatus,
  type ProviderSettings,
} from "./provider-status";

const EMPTY: ProviderSettings = {
  copilotGithubToken: null,
  openAiApiKey: null,
  anthropicApiKey: null,
  geminiApiKey: null,
};

describe("getConfiguredProviders", () => {
  it("returns nothing when no credential is saved", () => {
    expect(getConfiguredProviders(EMPTY)).toEqual([]);
  });

  it("ignores blank values", () => {
    expect(
      getConfiguredProviders({ ...EMPTY, openAiApiKey: "   " })
    ).toEqual([]);
  });

  it("lists providers in a stable order", () => {
    const providers = getConfiguredProviders({
      copilotGithubToken: "gho_x",
      openAiApiKey: "sk-x",
      anthropicApiKey: null,
      geminiApiKey: "g-x",
    });
    expect(providers.map((provider) => provider.id)).toEqual([
      "copilot",
      "openai",
      "gemini",
    ]);
  });
});

describe("formatProviderList", () => {
  it("joins one, two, and many labels readably", () => {
    expect(formatProviderList([])).toBe("");
    expect(formatProviderList([{ id: "openai", label: "OpenAI" }])).toBe(
      "OpenAI"
    );
    expect(
      formatProviderList([
        { id: "openai", label: "OpenAI" },
        { id: "gemini", label: "Gemini" },
      ])
    ).toBe("OpenAI and Gemini");
    expect(
      formatProviderList([
        { id: "copilot", label: "GitHub Copilot" },
        { id: "openai", label: "OpenAI" },
        { id: "gemini", label: "Gemini" },
      ])
    ).toBe("GitHub Copilot, OpenAI, and Gemini");
  });
});

describe("summarizeProviderStatus", () => {
  it("never claims generation will fail when nothing is saved locally", () => {
    const summary = summarizeProviderStatus(EMPTY);
    expect(summary.hasLocalCredentials).toBe(false);
    expect(summary.title).toBe("No model provider saved in this browser");
    expect(summary.detail).toContain("backend/.env");
    expect(summary.detail).not.toMatch(/cannot generate|will fail|unavailable/i);
  });

  it("never claims a saved key has been verified", () => {
    const summary = summarizeProviderStatus({
      ...EMPTY,
      anthropicApiKey: "sk-ant",
    });
    expect(summary.hasLocalCredentials).toBe(true);
    expect(summary.title).toBe("Anthropic saved on this device");
    expect(summary.detail).toContain("only sent to the provider you select");
    expect(summary.title).not.toMatch(/connected|verified|ready|working/i);
  });

  it("names every saved provider", () => {
    const summary = summarizeProviderStatus({
      copilotGithubToken: "gho_x",
      openAiApiKey: "sk-x",
      anthropicApiKey: null,
      geminiApiKey: null,
    });
    expect(summary.title).toBe("GitHub Copilot and OpenAI saved on this device");
  });
});
