jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import ByokCard from "./CopilotSdkByokSettings";
import {
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  byokSelectionId,
  type CopilotSdkByokSettings,
} from "../../lib/copilot-sdk-byok";

const API_KEY = "byok-dedicated-key-value";
const OPENAI_BASE = "gpt-5.6-sol (high thinking)";

function settings(
  overrides: Partial<CopilotSdkByokSettings> = {}
): CopilotSdkByokSettings {
  return {
    ...DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
    enabled: true,
    provider: "openai",
    baseUrl: "https://gateway.example.com/v1",
    apiKey: API_KEY,
    ...overrides,
  };
}

function render(overrides: Partial<Parameters<typeof ByokCard>[0]> = {}) {
  return renderToStaticMarkup(
    <ByokCard
      settings={settings()}
      onChange={jest.fn()}
      mcpServers={[]}
      selectedModels={[]}
      {...overrides}
    />
  );
}

/**
 * The markup with every form value removed.
 *
 * A controlled password input necessarily carries its own value in the DOM;
 * what matters is that nothing *else* - a label, a summary line, a title - ever
 * prints the credential.
 */
function renderWithoutFieldValues(
  overrides: Partial<Parameters<typeof ByokCard>[0]> = {}
) {
  return render(overrides).replace(/ value="[^"]*"/g, "");
}

test("is a separate card with its own explicit enable switch", () => {
  const html = render({ settings: settings({ enabled: false }) });

  expect(html).toContain("GitHub Copilot SDK BYOK");
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="false"');
});

test("explains that no Copilot subscription is needed and the runtime is experimental", () => {
  const html = render();

  expect(html).toContain("No Copilot subscription is required");
  expect(html).toContain("experimental");
});

test("says each model becomes its own option, comparable side by side", () => {
  const html = render();

  expect(html).toContain("its own option");
  expect(html).toContain("in the same generation and compare them");
});

test("says a native pick is never re-routed and Gemini is unsupported", () => {
  const html = render();

  expect(html).toContain("settings are untouched");
  expect(html).toContain("never re-routed");
  expect(html).toContain("Gemini has no SDK provider");
});

test("keeps the connection fields hidden until it is switched on", () => {
  const html = render({ settings: settings({ enabled: false }) });

  expect(html).not.toContain("API key for this connection");
  expect(html).not.toContain("Validate connection");
});

test("offers all three SDK providers and no Gemini option", () => {
  const html = render();

  expect(html).toContain('value="openai"');
  expect(html).toContain('value="azure"');
  expect(html).toContain('value="anthropic"');
  expect(html).not.toContain('value="gemini"');
});

test("uses password inputs and prints the credential nowhere else", () => {
  const withSecrets = settings({ bearerToken: "bearer-value" });

  expect(render({ settings: withSecrets })).toContain('type="password"');
  const withoutValues = renderWithoutFieldValues({ settings: withSecrets });
  expect(withoutValues).not.toContain(API_KEY);
  expect(withoutValues).not.toContain("bearer-value");
});

test("labels every field and ties its help text to it", () => {
  const html = render();

  expect(html).toMatch(/for="[^"]*-base-url"/);
  expect(html).toMatch(/for="[^"]*-api-key"/);
  expect(html).toMatch(/aria-describedby="[^"]*-api-key-help"/);
  expect(html).toMatch(/id="[^"]*-api-key-help"/);
});

test("says a dedicated key is required, without offering a fallback", () => {
  const html = render();

  expect(html).toContain("will not use your OpenAI or Anthropic key here");
  expect(html).not.toContain("falls back");
});

test("demands a key and reports it as a field error", () => {
  const html = render({ settings: settings({ apiKey: null }) });

  expect(html).toContain('role="alert"');
  expect(html).toContain("Add a dedicated API key");
  expect(html).toMatch(/aria-invalid="true"/);
  expect(html).toMatch(/aria-errormessage="[^"]*-api-key-error"/);
});

test("allows a localhost OpenAI-compatible endpoint with no key", () => {
  const html = render({
    settings: settings({ apiKey: null, baseUrl: "http://localhost:11434/v1" }),
  });

  expect(html).toContain("A local endpoint may be left without one.");
  expect(html).not.toContain("Add a dedicated API key");
});

test("requires the endpoint for Azure", () => {
  const html = render({
    settings: settings({ provider: "azure", baseUrl: null }),
  });

  expect(html).toContain("Azure OpenAI needs the endpoint URL");
  expect(html).toContain("Required. The endpoint of your Azure OpenAI resource.");
});

test("reports an http endpoint that is not localhost", () => {
  const html = render({
    settings: settings({ baseUrl: "http://gateway.example.com/v1" }),
  });

  expect(html).toContain("must use https:// unless it points at localhost");
});

test("shows where a BYOK option goes, by host and never by key", () => {
  const html = renderWithoutFieldValues();

  expect(html).toContain("Where a BYOK option goes");
  expect(html).toContain("gateway.example.com");
  expect(html).not.toContain(API_KEY);
});

test("says why the connection is not ready yet", () => {
  const html = render({ settings: settings({ apiKey: null, baseUrl: null }) });

  expect(html).toContain("Not ready —");
  expect(html).toContain("needs its own API key");
});

test("counts the BYOK options the selection uses", () => {
  expect(render()).toContain("No BYOK option is selected yet");

  const selected = render({
    selectedModels: [byokSelectionId("openai", OPENAI_BASE)],
  });
  expect(selected).toContain("1 BYOK option selected in Models.");
  expect(selected).toContain("sdk-byok/openai/&lt;model&gt;");
});

test("warns when a selected option no longer matches the connection", () => {
  const html = render({
    settings: settings({ provider: "anthropic", apiKey: API_KEY }),
    selectedModels: [byokSelectionId("azure", OPENAI_BASE)],
  });

  expect(html).toContain('role="alert"');
  expect(html).toContain("no longer match this connection");
});

test("never warns about re-routing, because nothing is re-routed", () => {
  const html = render({ selectedModels: [OPENAI_BASE] });

  expect(html).not.toContain("will also run through your BYOK endpoint");
  expect(html).not.toContain("routes a whole provider at once");
});

test("offers a validate button that promises not to call the endpoint", () => {
  const html = render();

  expect(html).toContain("Validate connection");
  expect(html).toContain("Nothing is sent to the endpoint.");
  expect(html).toContain('aria-live="polite"');
});

test("puts the rarely used fields behind a disclosure", () => {
  const html = render();

  expect(html).toContain("Advanced connection options");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toMatch(/aria-controls="[^"]*-advanced"/);
  expect(html).not.toContain("Bearer token (optional)");
});

test("gives its controls a 44px target", () => {
  const html = render();

  expect(html).toContain("min-h-11");
  expect(html).toContain("h-11");
});
