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

/* -------------------------------------------------------------------------- */
/* Structural validation vs a live model-access test                           */
/* -------------------------------------------------------------------------- */

test("keeps Validate connection honest about contacting nothing", () => {
  const html = render();

  expect(html).toContain('data-testid="byok-validate"');
  expect(html).toContain("Validate connection");
  expect(html).toContain("Checks the settings only. Nothing is sent to the endpoint.");
});

test("offers a separate live test that says it contacts the endpoint", () => {
  const html = render();

  expect(html).toContain('data-testid="byok-test-model-access"');
  expect(html).toContain("Test model access");
  expect(html).toContain("Contacts");
  expect(html).toContain("one tiny");
  expect(html).toContain("small amount of quota");
});

test("the two actions make different promises", () => {
  const html = render();

  // The structural check must never borrow the live wording, or it would
  // imply a reachability guarantee it does not provide.
  const structural = html.slice(
    html.indexOf('data-testid="byok-validate"'),
    html.indexOf('data-testid="byok-test-model-access"')
  );
  expect(structural).toContain("Nothing is sent to the endpoint.");
  expect(structural).not.toContain("small amount of quota");
});

test("names the selected BYOK identity the live test will exercise", () => {
  const selected = byokSelectionId("azure", OPENAI_BASE);
  const html = render({
    settings: settings({ provider: "azure", baseUrl: "https://r.openai.azure.com" }),
    selectedModels: [selected],
  });

  expect(html).toContain(`Tests ${selected}.`);
});

test("falls back to letting the connection choose when nothing is selected", () => {
  const html = render({ selectedModels: [] });

  expect(html).toContain("Tests the first model this connection offers.");
});

test("the live test describes the endpoint without printing the key", () => {
  const html = renderWithoutFieldValues();

  expect(html).toContain("gateway.example.com");
  expect(html).not.toContain(API_KEY);
});

test("the live action has a 44px target and a described-by hint", () => {
  const html = render();

  const button = html.slice(html.indexOf('data-testid="byok-test-model-access"'));
  expect(button.slice(0, 400)).toContain("min-h-11");
  expect(html).toMatch(/aria-describedby="[^"]*-live-help"/);
});

/* -------------------------------------------------------------------------- */
/* Organisation-hosted endpoints with their own models                         */
/* -------------------------------------------------------------------------- */

const CUSTOM_MODEL = "my-model-v1";

function customSettings(overrides: Partial<CopilotSdkByokSettings> = {}) {
  return settings({
    provider: "openai",
    baseUrl: "https://api.example.com/v1",
    wireApi: "completions",
    wireModel: CUSTOM_MODEL,
    ...overrides,
  });
}

test("offers the endpoint model as a primary field, not an advanced one", () => {
  const html = render({ settings: customSettings() });

  // Visible without expanding the disclosure.
  expect(html).toMatch(/aria-expanded="false"/);
  expect(html).toContain("Endpoint model (optional)");
  expect(html).toMatch(/id="[^"]*-wire-model"/);
});

test("names the one truthful option a custom endpoint model produces", () => {
  const html = render({ settings: customSettings() });

  expect(html).toContain('data-testid="byok-custom-entry-note"');
  expect(html).toContain(`${CUSTOM_MODEL} via openai`);
  expect(html).toContain("The catalog models are replaced");
  expect(html).toContain("No thinking level is sent for it.");
  // The whole point: no GPT aliases pretending to be this model.
  const note = html.slice(html.indexOf('data-testid="byok-custom-entry-note"'));
  expect(note.slice(0, 600)).not.toMatch(/gpt-5/i);
});

test("does not claim a custom entry when no endpoint model is set", () => {
  const html = render({ settings: customSettings({ wireModel: null }) });
  expect(html).not.toContain('data-testid="byok-custom-entry-note"');
});

test("states the wire API, vision and tool-calling requirement", () => {
  const html = render({ settings: customSettings() });

  expect(html).toContain("Chat Completions API");
  expect(html).toContain("image input and tool calling");
  expect(html).toContain("a text-only");
});

test("tracks the pinned wire API in that requirement", () => {
  const html = render({ settings: customSettings({ wireApi: "responses" }) });
  expect(html).toContain("Responses API this");
});

test("never infers capability from the endpoint's model list", () => {
  const html = render({ settings: customSettings() });

  expect(html).toContain(
    "neither this check nor the endpoint&#x27;s model list can tell you which models qualify"
  );
  expect(html).toContain("Check the endpoint&#x27;s own documentation.");
});

test("tells an OpenAI-compatible endpoint how to list its models", () => {
  const html = render({ settings: customSettings({ wireModel: null }) });
  expect(html).toContain("Run Test model access to list what the endpoint reports");
  expect(html).toContain("or type the name yourself");
});

test("keeps manual entry for providers that cannot list models", () => {
  const azure = render({
    settings: customSettings({
      provider: "azure",
      baseUrl: "https://r.openai.azure.com",
      wireModel: "my-deployment",
    }),
  });
  expect(azure).toContain("Deployment name (optional)");
  expect(azure).toContain("Azure does not list deployments here");
  expect(azure).toMatch(/id="[^"]*-wire-model"/);
  expect(azure).not.toContain('data-testid="byok-discovered-models"');

  const anthropic = render({
    settings: customSettings({ provider: "anthropic", baseUrl: null }),
  });
  expect(anthropic).toContain("Anthropic does not list models here");
  expect(anthropic).toMatch(/id="[^"]*-wire-model"/);
});

test("the live test targets the configured endpoint model", () => {
  const html = render({ settings: customSettings() });
  expect(html).toContain(`Tests sdk-byok/openai/custom/${CUSTOM_MODEL}.`);
});

test("shows no discovered-model selector before a test has run", () => {
  expect(render({ settings: customSettings() })).not.toContain(
    'data-testid="byok-discovered-models"'
  );
});

test("the endpoint model field never becomes a password input", () => {
  // It is a model name, not a secret; masking it would be misleading.
  const html = render({ settings: customSettings() });
  const field = html.slice(html.indexOf('id="' + html.match(/id="([^"]*-wire-model)"/)![1] + '"'));
  expect(field.slice(0, 200)).not.toContain('type="password"');
});

test("lists what the endpoint reported, as an accessible labelled selector", () => {
  const html = render({
    settings: customSettings({ wireModel: null }),
    initialDiscoveredModels: [CUSTOM_MODEL, "my-model-large", "my-org/my-model:latest"],
  });

  expect(html).toContain('data-testid="byok-discovered-models"');
  expect(html).toContain("Models this endpoint reports (3)");
  expect(html).toMatch(/<label[^>]*for="[^"]*-discovered"/);
  expect(html).toContain("Choose a model…");
  expect(html).toContain(`<option value="${CUSTOM_MODEL}">`);
  expect(html).toContain('<option value="my-model-large">');
  expect(html).toContain("my-org/my-model:latest");
});

test("does not claim the list says anything about capability", () => {
  const html = render({
    settings: customSettings({ wireModel: null }),
    initialDiscoveredModels: [CUSTOM_MODEL],
  });

  expect(html).toContain("list of ids the endpoint returned");
  expect(html).toContain(
    "It does not say which of them can read images or call tools"
  );
  // No claim that discovery proved vision or tools.
  expect(html).not.toMatch(/supports (vision|images)/i);
  expect(html).not.toMatch(/vision[- ]capable/i);
});

test("marks the selector as showing the current endpoint model", () => {
  const html = render({
    settings: customSettings(),
    initialDiscoveredModels: [CUSTOM_MODEL, "my-model-large"],
  });
  expect(html).toContain(`<option value="${CUSTOM_MODEL}" selected=""`);
});

test("leaves the selector unset when the typed model is not in the list", () => {
  const html = render({
    settings: customSettings({ wireModel: "hand-typed-model" }),
    initialDiscoveredModels: [CUSTOM_MODEL],
  });
  // Manual entry stays authoritative; the selector does not silently rewrite it.
  expect(html).toContain('<option value="" selected="">Choose a model…');
  expect(html).toContain('value="hand-typed-model"');
});

test("keeps manual entry available beside the discovered list", () => {
  const html = render({
    settings: customSettings({ wireModel: null }),
    initialDiscoveredModels: [CUSTOM_MODEL],
  });
  expect(html).toContain("You can also");
  expect(html).toMatch(/id="[^"]*-wire-model"/);
});

test("rejects an endpoint model name the backend could not accept", () => {
  const html = render({ settings: customSettings({ wireModel: "my model" }) });
  expect(html).toContain('role="alert"');
  expect(html).toContain("Use the exact model id the endpoint reports");
  expect(html).toContain("but no spaces");
});

test("the discovered selector meets the 44px target", () => {
  const html = render({
    settings: customSettings({ wireModel: null }),
    initialDiscoveredModels: [CUSTOM_MODEL],
  });
  const select = html.slice(html.indexOf('data-testid="byok-discovered-models"'));
  expect(select.slice(0, 300)).toContain("h-11");
});

test("keeps every provider mode, and describes OpenAI-compatible broadly", () => {
  const html = render({ settings: customSettings({ wireModel: null }) });

  // All three connection types survive; none is replaced by a custom mode.
  expect(html).toContain('value="openai"');
  expect(html).toContain('value="azure"');
  expect(html).toContain('value="anthropic"');
  expect(html).toContain("OpenAI-compatible");
  expect(html).toContain("Azure OpenAI");

  // The mode is described by the wire format, not by any one vendor or host.
  expect(html).toContain("any endpoint that speaks the OpenAI wire format");
  expect(html).toContain("self-hosted");
});

test("names no vendor, host or model outside the supported provider list", () => {
  const html = render({
    settings: customSettings({ wireModel: null }),
    initialDiscoveredModels: [],
  });

  // Scope to the endpoint-model section: the card's intro legitimately names
  // Gemini and Replicate when saying the native providers are untouched.
  const section = html.slice(
    html.indexOf("Endpoint model (optional)"),
    html.indexOf("Advanced connection options")
  );
  expect(section.length).toBeGreaterThan(200);

  for (const brand of [
    /qwen/i,
    /llama/i,
    /mistral/i,
    /deepseek/i,
    /\bgrok\b/i,
    /\bgpt-/i,
    /\bclaude\b/i,
  ]) {
    expect(section).not.toMatch(brand);
  }
  // No concrete hostname is suggested for the OpenAI-compatible mode.
  expect(section).not.toMatch(/https?:\/\/[a-z0-9.-]+\.(com|net|io|ai)/i);
});

test("accepts any https base URL, and http only on localhost", () => {
  const remote = render({
    settings: customSettings({ baseUrl: "https://anything.example.net/v1" }),
  });
  expect(remote).not.toContain("must use https");

  const insecure = render({
    settings: customSettings({ baseUrl: "http://anything.example.net/v1" }),
  });
  expect(insecure).toContain("must use https:// unless it points at localhost");

  const local = render({
    settings: customSettings({ baseUrl: "http://localhost:8000/v1" }),
  });
  expect(local).not.toContain("must use https");
});

test("uses a neutral placeholder rather than a real model name", () => {
  const html = render({ settings: customSettings({ wireModel: null }) });
  expect(html).toContain('placeholder="your-model-id"');

  const azure = render({
    settings: customSettings({
      provider: "azure",
      baseUrl: "https://my-resource.openai.azure.com",
      wireModel: null,
    }),
  });
  expect(azure).toContain('placeholder="your-deployment-name"');
});

/* -------------------------------------------------------------------------- */
/* The wire API control                                                        */
/* -------------------------------------------------------------------------- */

function advanced(overrides: Partial<CopilotSdkByokSettings> = {}) {
  // The wire API lives behind the disclosure; render it open.
  return renderToStaticMarkup(
    <ByokCard
      settings={settings(overrides)}
      onChange={jest.fn()}
      mcpServers={[]}
      selectedModels={[]}
      initialShowAdvanced
    />
  );
}

test("offers Automatic alongside both protocols, and defaults to it", () => {
  const html = advanced({ wireApi: null });

  expect(html).toContain('data-testid="byok-wire-api"');
  expect(html).toContain('<option value="" selected="">Automatic (recommended)');
  expect(html).toContain('<option value="responses">Responses API</option>');
  expect(html).toContain(
    '<option value="completions">Chat Completions API</option>'
  );
});

test("shows which protocol Automatic resolves to for this endpoint", () => {
  const custom = advanced({
    wireApi: null,
    baseUrl: "https://api.example.com/v1",
  });
  expect(custom).toContain('data-testid="byok-wire-api-effective"');
  expect(custom).toContain("Chat Completions API, chosen automatically");

  const vendor = advanced({ wireApi: null, baseUrl: null });
  expect(vendor).toContain("Responses API, chosen automatically");
});

test("marks a pinned protocol as selected and stops calling it automatic", () => {
  const html = advanced({
    wireApi: "responses",
    baseUrl: "https://api.example.com/v1",
  });

  expect(html).toContain('<option value="responses" selected="">');
  expect(html).not.toContain("chosen automatically");
});

test("explains that Automatic is provider-neutral, not vendor-specific", () => {
  const html = advanced({ wireApi: null });

  expect(html).toContain("Automatic picks Chat Completions");
  expect(html).toContain("its own base URL");
  expect(html).toContain("Pin one only if");
  // No vendor is named as the reason for the choice.
  expect(html).not.toMatch(/qwen|llama|mistral/i);
});
