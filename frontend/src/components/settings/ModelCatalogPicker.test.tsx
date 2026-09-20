import { renderToStaticMarkup } from "react-dom/server";
import ModelCatalogPicker from "./ModelCatalogPicker";
import type {
  CatalogModel,
  CatalogProvider,
  ModelCatalog,
  ProviderId,
} from "../../lib/model-selection";

function model(
  id: string,
  provider: ProviderId,
  overrides: Partial<CatalogModel> = {}
): CatalogModel {
  return {
    id,
    provider,
    label: id,
    family: id,
    effort: null,
    status: "available",
    recommended: false,
    supports_video: provider === "gemini" || provider === "copilot",
    runtime: provider === "sdk-byok" ? "copilot-byok" : "native",
    base_model_id: null,
    ...overrides,
  };
}

function provider(
  id: ProviderId,
  models: CatalogModel[],
  overrides: Partial<CatalogProvider> = {}
): CatalogProvider {
  return {
    id,
    label: id === "copilot" ? "GitHub Copilot" : "OpenAI",
    available: true,
    credential_label: "OpenAI API key",
    credential_source: "request",
    source_kind: id === "copilot" ? "discovered" : "curated",
    detail: `${id} detail`,
    models,
    unsupported_model_ids: [],
    ...overrides,
  };
}

const catalog: ModelCatalog = {
  providers: [
    provider(
      "copilot",
      [model("copilot/claude-opus-5", "copilot", { label: "Claude Opus 5" })],
      { unsupported_model_ids: ["brand-new-model-9"] }
    ),
    provider("openai", [
      model("gpt-5.5 (high thinking)", "openai", {
        label: "GPT 5.5 (high)",
        recommended: true,
      }),
      model("gpt-5.4-2026-03-05 (low thinking)", "openai", {
        label: "GPT 5.4 (2026-03-05) (low)",
        status: "deprecated",
      }),
    ]),
    provider("anthropic", [], { available: false, label: "Anthropic" }),
  ],
  stale_selection: [],
  integration_diagnostics: [],
};

function render(overrides: Partial<Parameters<typeof ModelCatalogPicker>[0]> = {}) {
  return renderToStaticMarkup(
    <ModelCatalogPicker
      catalog={catalog}
      selectedModels={[]}
      onToggleModel={jest.fn()}
      onClearSelection={jest.fn()}
      showDeprecated={false}
      onShowDeprecatedChange={jest.fn()}
      hint="Automatic: shot2code picks 4 options."
      idPrefix="test"
      {...overrides}
    />
  );
}

test("groups models under an accessible heading per provider", () => {
  const html = render();

  expect(html).toContain('role="group"');
  expect(html).toContain('aria-labelledby="test-copilot-label"');
  expect(html).toContain('id="test-copilot-label"');
  expect(html).toContain("GitHub Copilot");
  expect(html).toContain('aria-labelledby="test-openai-label"');
  expect(html).toContain("OpenAI");
});

test("omits providers without credentials", () => {
  const html = render();

  expect(html).not.toContain("test-anthropic-label");
});

test("renders each model as a labelled checkbox tied to the hint", () => {
  const html = render();

  expect(html).toContain('id="test-gpt-5.5 (high thinking)"');
  expect(html).toContain('for="test-gpt-5.5 (high thinking)"');
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('aria-describedby="test-hint"');
  expect(html).toContain('id="test-hint"');
  expect(html).toContain("Automatic: shot2code picks 4 options.");
});

test("marks the selected models as checked", () => {
  const html = render({ selectedModels: ["gpt-5.5 (high thinking)"] });

  const input = html.match(
    /<input id="test-gpt-5\.5 \(high thinking\)"[^>]*>/
  )?.[0];
  expect(input).toContain('checked=""');
  expect(html).toMatch(
    /<input id="test-copilot\/claude-opus-5"(?:(?!checked)[^>])*>/
  );
  expect(html).toContain("Reset to automatic (1)");
});

test("labels which models are recommended", () => {
  expect(render()).toContain("Recommended");
});

test("hides deprecated models until they are asked for", () => {
  expect(render()).not.toContain("GPT 5.4 (2026-03-05) (low)");

  const shown = render({ showDeprecated: true });
  expect(shown).toContain("GPT 5.4 (2026-03-05) (low)");
  expect(shown).toContain("Deprecated");
});

test("keeps a deprecated model visible while it is still selected", () => {
  const html = render({
    selectedModels: ["gpt-5.4-2026-03-05 (low thinking)"],
  });

  expect(html).toContain("GPT 5.4 (2026-03-05) (low)");
});

test("warns about saved models that can no longer run", () => {
  const html = render({
    selectedModels: ["copilot/grok-4.5"],
    staleModels: ["copilot/grok-4.5"],
    onRemoveStale: jest.fn(),
  });

  expect(html).toContain('role="status"');
  expect(html).toContain("can no longer run");
  expect(html).toContain("copilot/grok-4.5");
  expect(html).toContain(">Remove</button>");
});

test("explains Copilot models this build cannot route to", () => {
  const html = render();

  expect(html).toContain("not supported by this version of shot2code yet");
});

test("says which provider lists are live and which are curated", () => {
  const html = render();

  expect(html).toContain(">Live</span>");
  expect(html).toContain(">Curated</span>");
});

test("hides models that cannot read video in video mode", () => {
  const html = render({ inputMode: "video" });

  expect(html).toContain("Claude Opus 5");
  expect(html).not.toContain("GPT 5.5 (high)");
});

test("explains itself when no provider is configured", () => {
  const html = render({
    catalog: { providers: [], stale_selection: [], integration_diagnostics: [] },
  });

  expect(html).toContain("No model provider is configured yet");
});

/* -------------------------------------------------------------------------- */
/* Copilot SDK BYOK is an additive group, never a rewrite of a direct one      */
/* -------------------------------------------------------------------------- */

/** The catalog with the backend-built BYOK group appended. */
const catalogWithByok: ModelCatalog = {
  ...catalog,
  providers: [
    ...catalog.providers,
    provider(
      "sdk-byok",
      [
        model("sdk-byok/azure/gpt-5.5 (high thinking)", "sdk-byok", {
          label: "Azure prod (GPT 5.5)",
          family: "Azure prod",
          base_model_id: "gpt-5.5 (high thinking)",
          runtime: "copilot-byok",
        }),
      ],
      {
        label: "Copilot SDK (BYOK)",
        credential_label: "BYOK profile with its own endpoint and key",
        credential_source: "sdk-byok",
        source_kind: "configured",
        detail: "Your own endpoints, run through the Copilot SDK.",
      }
    ),
  ],
};

test("renders the BYOK entries in their own group, alongside the direct ones", () => {
  const html = render({ catalog: catalogWithByok });

  expect(html).toContain('aria-labelledby="test-sdk-byok-label"');
  expect(html).toContain("Copilot SDK (BYOK)");
  expect(html).toContain(">Experimental</span>");
  expect(html).toContain(">Yours</span>");
  // The direct OpenAI group is still there, untouched.
  expect(html).toContain('aria-labelledby="test-openai-label"');
});

test("a profile and the direct model it borrows are two independent picks", () => {
  const html = render({
    catalog: catalogWithByok,
    selectedModels: ["sdk-byok/azure/gpt-5.5 (high thinking)"],
  });

  expect(html).toContain('id="test-sdk-byok/azure/gpt-5.5 (high thinking)"');
  // The direct entry for the same base model stays unchecked.
  expect(html).toMatch(
    /<input id="test-gpt-5\.5 \(high thinking\)"(?:(?!checked)[^>])*>/
  );
  expect(html).toContain(">Your endpoint</span>");
});

test("can show both picks selected at once", () => {
  const html = render({
    catalog: catalogWithByok,
    selectedModels: [
      "gpt-5.5 (high thinking)",
      "sdk-byok/azure/gpt-5.5 (high thinking)",
    ],
  });

  const direct = html.match(
    /<input id="test-gpt-5\.5 \(high thinking\)"[^>]*>/
  )?.[0];
  const byok = html.match(
    /<input id="test-sdk-byok\/azure\/gpt-5\.5 \(high thinking\)"[^>]*>/
  )?.[0];
  expect(direct).toContain('checked=""');
  expect(byok).toContain('checked=""');
  expect(html).toContain("Reset to automatic (2)");
});

test("labels which credential a provider group is using", () => {
  const html = render({ catalog: catalogWithByok });

  expect(html).toContain(">Copilot SDK BYOK</span>");
  expect(html).toContain(">Your saved key</span>");
});

test("marks a BYOK row by its runtime, not by its group", () => {
  const html = render({ catalog: catalogWithByok });

  // The badge follows `runtime`, so an entry keeps it even if a future backend
  // files it somewhere else.
  expect(html).toContain(">Your endpoint</span>");
  const nativeRow = html.match(
    /<label for="test-gpt-5\.5 \(high thinking\)"[\s\S]*?<\/label>/
  )?.[0];
  expect(nativeRow).not.toContain("Your endpoint");
});

test("shows the backend's integration diagnostics near the picker", () => {
  const html = render({
    integrationDiagnostics: [
      {
        scope: "byok",
        code: "unusable",
        message: "'Azure prod' needs its own API key.",
        target: "sdk-byok/azure/gpt-5.5 (high thinking)",
      },
      { scope: "mcp", code: "untrusted", message: "Docs is not trusted." },
    ],
  });

  expect(html).toContain('aria-label="Integration notices"');
  expect(html).toContain("&#x27;Azure prod&#x27; needs its own API key.");
  expect(html).toContain("Docs is not trusted.");
});

test("keeps diagnostics visible even with no provider configured", () => {
  const html = render({
    catalog: { providers: [], stale_selection: [], integration_diagnostics: [] },
    integrationDiagnostics: [
      { scope: "byok", code: "invalid", message: "Azure BYOK needs a URL." },
    ],
  });

  expect(html).toContain("Azure BYOK needs a URL.");
});

test("says where MCP tools will and will not appear", () => {
  const html = render({
    mcpScopeNote: "MCP tools from Docs are offered to GitHub Copilot only.",
  });

  expect(html).toContain(
    "MCP tools from Docs are offered to GitHub Copilot only."
  );
});

test("never warns about rerouting, because nothing is rerouted", () => {
  const html = render({
    catalog: catalogWithByok,
    selectedModels: ["gpt-5.5 (high thinking)", "sdk-byok/azure/gpt-5.5 (high thinking)"],
  });

  expect(html).not.toContain("will also run through your BYOK endpoint");
  expect(html).not.toContain("routes a whole provider at once");
});
