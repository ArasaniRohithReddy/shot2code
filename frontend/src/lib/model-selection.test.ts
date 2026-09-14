import {
  EMPTY_CATALOG,
  LEGACY_DEFAULT_CODE_GENERATION_MODEL,
  availableProviders,
  catalogModelIds,
  describeSelection,
  describeSelectionHint,
  findCatalogModel,
  groupModelsByProvider,
  hasDeprecatedModels,
  migrateModelSelection,
  parseModelCatalog,
  partitionSelection,
  plannedVariantCount,
  variantLimit,
  withMigratedModelSelection,
  type CatalogModel,
  type CatalogProvider,
  type ModelCatalog,
  type ProviderId,
} from "./model-selection";

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
    label: id,
    available: true,
    credential_label: `${id} key`,
    credential_source: "request",
    source_kind: id === "copilot" ? "discovered" : "curated",
    detail: "",
    models,
    unsupported_model_ids: [],
    ...overrides,
  };
}

const catalog: ModelCatalog = {
  providers: [
    provider("copilot", [model("copilot/claude-opus-5", "copilot")]),
    provider("openai", [
      model("gpt-5.5 (high thinking)", "openai", {
        label: "GPT 5.5 (high)",
        recommended: true,
      }),
      model("gpt-5.4-2026-03-05 (low thinking)", "openai", {
        status: "deprecated",
      }),
    ]),
    provider("anthropic", [], { available: false }),
    provider("gemini", [model("gemini-3.6-flash (low thinking)", "gemini")]),
  ],
  stale_selection: [],
};

describe("parseModelCatalog", () => {
  it("reads a well-formed payload", () => {
    const parsed = parseModelCatalog({
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          available: true,
          credential_label: "OpenAI API key",
          credential_source: "request",
          source_kind: "curated",
          detail: "Validated list",
          models: [
            {
              id: "gpt-5.5 (high thinking)",
              provider: "openai",
              label: "GPT 5.5 (high)",
              family: "GPT 5.5",
              effort: "high",
              status: "available",
              recommended: true,
              supports_video: false,
            },
          ],
          unsupported_model_ids: [],
        },
      ],
      stale_selection: ["ghost"],
    });

    expect(parsed.providers).toHaveLength(1);
    expect(parsed.providers[0].models[0].label).toBe("GPT 5.5 (high)");
    expect(parsed.providers[0].models[0].recommended).toBe(true);
    expect(parsed.stale_selection).toEqual(["ghost"]);
  });

  it("drops entries it cannot understand instead of throwing", () => {
    const parsed = parseModelCatalog({
      providers: [
        { id: "not-a-provider", models: [] },
        null,
        { id: "gemini", models: [{ id: "x" }, null, { provider: "gemini" }] },
      ],
      stale_selection: ["ok", 5],
    });

    expect(parsed.providers.map((entry) => entry.id)).toEqual(["gemini"]);
    expect(parsed.providers[0].models).toEqual([]);
    expect(parsed.stale_selection).toEqual(["ok"]);
  });

  it("returns an empty catalog for junk", () => {
    expect(parseModelCatalog(null)).toEqual(EMPTY_CATALOG);
    expect(parseModelCatalog("nope")).toEqual(EMPTY_CATALOG);
    expect(parseModelCatalog({}).providers).toEqual([]);
  });
});

describe("availability", () => {
  it("lists only providers with credentials", () => {
    expect(availableProviders(catalog).map((entry) => entry.id)).toEqual([
      "copilot",
      "openai",
      "gemini",
    ]);
  });

  it("collects every offered model id", () => {
    expect(catalogModelIds(catalog)).toEqual(
      new Set([
        "copilot/claude-opus-5",
        "gpt-5.5 (high thinking)",
        "gpt-5.4-2026-03-05 (low thinking)",
        "gemini-3.6-flash (low thinking)",
      ])
    );
  });

  it("finds a model across providers", () => {
    expect(findCatalogModel(catalog, "gpt-5.5 (high thinking)")?.provider).toBe(
      "openai"
    );
    expect(findCatalogModel(catalog, "nope")).toBeUndefined();
  });
});

describe("partitionSelection", () => {
  it("separates runnable picks from stale ones", () => {
    const result = partitionSelection(
      ["gpt-5.5 (high thinking)", "copilot/grok-4.5", "ghost"],
      catalog
    );

    expect(result.valid).toEqual(["gpt-5.5 (high thinking)"]);
    expect(result.stale).toEqual(["copilot/grok-4.5", "ghost"]);
  });

  it("removes duplicates", () => {
    const result = partitionSelection(
      ["gpt-5.5 (high thinking)", "gpt-5.5 (high thinking)"],
      catalog
    );

    expect(result.valid).toEqual(["gpt-5.5 (high thinking)"]);
  });

  it("keeps every pick when the catalog has not loaded", () => {
    const result = partitionSelection(["anything"], EMPTY_CATALOG);

    expect(result.valid).toEqual(["anything"]);
    expect(result.stale).toEqual([]);
  });
});

describe("variant planning", () => {
  it("mirrors the backend limits", () => {
    expect(variantLimit({ generationType: "create", inputMode: "image" })).toBe(4);
    expect(variantLimit({ generationType: "create", inputMode: "text" })).toBe(4);
    expect(variantLimit({ generationType: "update", inputMode: "image" })).toBe(2);
    expect(variantLimit({ generationType: "create", inputMode: "video" })).toBe(2);
  });

  it("produces one option per selected model, capped by the limit", () => {
    const context = { generationType: "create", inputMode: "image" } as const;

    expect(plannedVariantCount([], context)).toBe(4);
    expect(plannedVariantCount(["a"], context)).toBe(1);
    expect(plannedVariantCount(["a", "b"], context)).toBe(2);
    expect(plannedVariantCount(["a", "b", "c", "d", "e"], context)).toBe(4);
  });

  it("caps an edit at two options", () => {
    expect(
      plannedVariantCount(["a", "b", "c"], {
        generationType: "update",
        inputMode: "image",
      })
    ).toBe(2);
  });
});

describe("selection descriptions", () => {
  it("labels the trigger", () => {
    expect(describeSelection([], catalog)).toBe("Auto");
    expect(describeSelection(["gpt-5.5 (high thinking)"], catalog)).toBe(
      "GPT 5.5 (high)"
    );
    expect(describeSelection(["a", "b"], catalog)).toBe("2 models");
  });

  it("falls back to a readable id for a model the catalog lacks", () => {
    expect(describeSelection(["copilot/grok-4.5"], catalog)).toBe("grok-4.5");
  });

  it("explains what the picks will do", () => {
    const context = { generationType: "create", inputMode: "image" } as const;

    expect(describeSelectionHint([], context)).toContain("Automatic");
    expect(describeSelectionHint(["a"], context)).toContain("1 option");
    expect(describeSelectionHint(["a", "b"], context)).toContain("2 options");
    expect(
      describeSelectionHint(["a", "b", "c", "d", "e"], context)
    ).toContain("Only the first 4");
  });
});

describe("groupModelsByProvider", () => {
  it("groups by available provider and hides deprecated models", () => {
    const groups = groupModelsByProvider(catalog);

    expect(groups.map((group) => group.provider.id)).toEqual([
      "copilot",
      "openai",
      "gemini",
    ]);
    expect(groups[1].models.map((entry) => entry.id)).toEqual([
      "gpt-5.5 (high thinking)",
    ]);
  });

  it("shows deprecated models on request", () => {
    const groups = groupModelsByProvider(catalog, { includeDeprecated: true });

    expect(groups[1].models).toHaveLength(2);
  });

  it("keeps a deprecated model that is already selected", () => {
    const groups = groupModelsByProvider(catalog, {
      selection: ["gpt-5.4-2026-03-05 (low thinking)"],
    });

    expect(groups[1].models.map((entry) => entry.id)).toContain(
      "gpt-5.4-2026-03-05 (low thinking)"
    );
  });

  it("hides models that cannot read video in video mode", () => {
    const groups = groupModelsByProvider(catalog, { inputMode: "video" });

    expect(groups.map((group) => group.provider.id)).toEqual([
      "copilot",
      "gemini",
    ]);
  });

  it("reports whether anything is deprecated", () => {
    expect(hasDeprecatedModels(catalog)).toBe(true);
    expect(hasDeprecatedModels(EMPTY_CATALOG)).toBe(false);
  });
});

describe("migrateModelSelection", () => {
  it("keeps an existing selection", () => {
    expect(
      migrateModelSelection({
        selectedModels: ["gpt-5.5 (high thinking)"],
        copilotModels: ["copilot/claude-opus-5"],
      })
    ).toEqual(["gpt-5.5 (high thinking)"]);
  });

  it("adopts the legacy Copilot-only list", () => {
    expect(
      migrateModelSelection({
        copilotModels: ["copilot/claude-opus-5", "copilot/gpt-5.6-sol"],
      })
    ).toEqual(["copilot/claude-opus-5", "copilot/gpt-5.6-sol"]);
  });

  it("adopts a deliberately changed single-model setting", () => {
    expect(
      migrateModelSelection({
        codeGenerationModel: "claude-opus-5 (max effort)",
      })
    ).toEqual(["claude-opus-5 (max effort)"]);
  });

  it("ignores the historical default single model", () => {
    expect(
      migrateModelSelection({
        codeGenerationModel: LEGACY_DEFAULT_CODE_GENERATION_MODEL,
      })
    ).toEqual([]);
  });

  it("prefers the legacy list over the single-model setting", () => {
    expect(
      migrateModelSelection({
        copilotModels: ["copilot/claude-opus-5"],
        codeGenerationModel: "claude-opus-5 (max effort)",
      })
    ).toEqual(["copilot/claude-opus-5"]);
  });

  it("returns nothing for a blank settings blob", () => {
    expect(migrateModelSelection({})).toEqual([]);
    expect(
      migrateModelSelection({ selectedModels: [], copilotModels: [] })
    ).toEqual([]);
  });

  it("drops duplicates", () => {
    expect(
      migrateModelSelection({ selectedModels: ["a", "a", "b"] })
    ).toEqual(["a", "b"]);
  });
});

describe("withMigratedModelSelection", () => {
  it("moves the legacy list across and clears it", () => {
    const migrated = withMigratedModelSelection({
      selectedModels: [],
      copilotModels: ["copilot/claude-opus-5"],
      codeGenerationModel: LEGACY_DEFAULT_CODE_GENERATION_MODEL,
    });

    expect(migrated.selectedModels).toEqual(["copilot/claude-opus-5"]);
    expect(migrated.copilotModels).toEqual([]);
  });

  it("leaves an already-migrated blob untouched", () => {
    const settings = {
      selectedModels: ["gpt-5.5 (high thinking)"],
      copilotModels: [],
    };

    expect(withMigratedModelSelection(settings)).toBe(settings);
  });
});
