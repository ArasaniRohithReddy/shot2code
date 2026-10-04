jest.mock("../../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import BuiltStorybookImport, {
  BuiltStorybookImportResult,
} from "./BuiltStorybookImport";
import ImportTab from "./ImportTab";

const analysis = {
  context: {
    name: "Acme UI",
    file_count: 3,
    analyzed_file_count: 3,
    component_count: 12,
    components: [],
    dependencies: [],
    tokens: [],
    framework_hints: ["Storybook", "React"],
    summary: "## Built Storybook component-library context",
  },
  source_kind: "folder" as const,
  metadata_files: [
    "index.json",
    "manifests/components.json",
    "manifests/docs.json",
  ],
  story_count: 38,
  docs_count: 6,
  warnings: [
    "Storybook manifest schemas are preview APIs; unsupported versions are refused rather than guessed.",
  ],
};

describe("Built Storybook import UI", () => {
  test("states the metadata-only boundary before selection", () => {
    const html = renderToStaticMarkup(
      <BuiltStorybookImport setProjectContext={jest.fn()} />
    );

    expect(html).toContain("Built Storybook metadata");
    expect(html).toContain("Add-on");
    expect(html).toContain("index.json");
    expect(html).toContain("manifests/components.json");
    expect(html).toContain("manifests/docs.json");
    expect(html).toContain("JSON only");
    expect(html).toContain("CSF modules");
    expect(html).toContain("decorators");
    expect(html).toContain("loaders");
    expect(html).toContain("play functions");
    expect(html).toContain("iframe.html");
    expect(html).toContain("Built folder");
    expect(html).toContain("JSON files");
    expect(html).toContain("Built ZIP");
    expect(html).toContain("Public HTTPS build");
    expect(html).toContain("Only fixed JSON paths are requested");
    expect(html).toContain("query strings");
  });

  test("renders a clear successful-analysis state and context action", () => {
    const html = renderToStaticMarkup(
      <BuiltStorybookImportResult
        analysis={analysis}
        onUse={jest.fn()}
        onClear={jest.fn()}
      />
    );

    expect(html).toContain("Acme UI");
    expect(html).toContain("12 components");
    expect(html).toContain("38 stories");
    expect(html).toContain("6 docs");
    expect(html).toContain("3 JSON files");
    expect(html).toContain("manifests/components.json");
    expect(html).toContain("preview APIs");
    expect(html).toContain("Use as component-library context");
    expect(html).toContain('aria-label="Clear Built Storybook analysis"');
  });

  test("keeps the existing Import choices and adds a third labelled mode", () => {
    const html = renderToStaticMarkup(
      <ImportTab
        importFromCode={jest.fn()}
        importProject={jest.fn()}
        projectContext={null}
        setProjectContext={jest.fn()}
      />
    );

    expect(html).toContain("Paste or drop HTML");
    expect(html).toContain("Folder, ZIP or source files");
    expect(html).toContain("Built Storybook");
    expect(html.match(/role="tab"/g)).toHaveLength(3);
  });
});
