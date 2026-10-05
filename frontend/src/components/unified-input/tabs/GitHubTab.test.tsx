jest.mock("../../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { Stack } from "../../../lib/stacks";
import GitHubTab from "./GitHubTab";
import { githubImportActionLabel } from "./github-import-mode";

describe("GitHub repository input tab", () => {
  it("keeps public imports keyless and explains the private-repo boundary", () => {
    const html = renderToStaticMarkup(
      <GitHubTab
        token={null}
        fallbackStack={Stack.HTML_CSS}
        importDesignProject={jest.fn()}
        designSystem={{
          designSystems: [],
          selectedDesignSystemId: null,
          setSelectedDesignSystemId: jest.fn(),
          onAddNew: jest.fn(),
          onManage: jest.fn(),
        }}
        modelSelector={{
          selectedModels: [],
          setSelectedModels: jest.fn(),
        }}
      />
    );

    expect(html).toContain("Import a GitHub frontend");
    expect(html).toContain("Public repositories work without a token");
    expect(html).toContain("Contents: read");
    expect(html).toContain("Copilot sign-in is not reused");
    expect(html).toContain("Repository stack");
    expect(html).toContain("preserves the repository");
    expect(html).toContain("Models for the first refinement");
    expect(html).toContain("Design system for the first refinement");
    expect(html).toContain("local repository opening remains unchanged");
    expect(html).toContain("Used only when the instruction above is not empty");
    expect(html).toContain("open the picker to see what to configure");
    expect(html).toContain("Leave this blank to inspect and open");
    expect(html).toContain("Inspect &amp; Open Repository");
  });

  it("states when a dedicated repository token is configured", () => {
    const html = renderToStaticMarkup(
      <GitHubTab
        token="github_pat_example"
        fallbackStack={Stack.REACT_TAILWIND}
        importDesignProject={jest.fn()}
        designSystem={{
          designSystems: [],
          selectedDesignSystemId: null,
          setSelectedDesignSystemId: jest.fn(),
          onAddNew: jest.fn(),
          onManage: jest.fn(),
        }}
      />
    );

    expect(html).toContain("dedicated repository token is configured");
    expect(html).not.toContain("github_pat_example");
  });

  it("names local open and model-assisted refinement distinctly", () => {
    expect(githubImportActionLabel("", false)).toBe(
      "Inspect & Open Repository"
    );
    expect(githubImportActionLabel("Modernize the dashboard", false)).toBe(
      "Inspect, Open & Refine"
    );
    expect(githubImportActionLabel("Modernize the dashboard", true)).toBe(
      "Inspecting repository…"
    );
  });
});
