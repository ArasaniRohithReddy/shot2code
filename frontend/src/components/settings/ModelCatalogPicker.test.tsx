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
    catalog: { providers: [], stale_selection: [] },
  });

  expect(html).toContain("No model provider is configured yet");
});
