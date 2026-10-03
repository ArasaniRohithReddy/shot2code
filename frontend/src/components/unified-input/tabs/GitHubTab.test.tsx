jest.mock("../../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { Stack } from "../../../lib/stacks";
import GitHubTab from "./GitHubTab";

describe("GitHub repository input tab", () => {
  it("keeps public imports keyless and explains the private-repo boundary", () => {
    const html = renderToStaticMarkup(
      <GitHubTab
        token={null}
        fallbackStack={Stack.HTML_CSS}
        importDesignProject={jest.fn()}
      />
    );

    expect(html).toContain("Import a GitHub frontend");
    expect(html).toContain("Public repositories work without a token");
    expect(html).toContain("Contents: read");
    expect(html).toContain("Copilot sign-in is not reused");
    expect(html).toContain("Inspect &amp; Open Repository");
  });

  it("states when a dedicated repository token is configured", () => {
    const html = renderToStaticMarkup(
      <GitHubTab
        token="github_pat_example"
        fallbackStack={Stack.REACT_TAILWIND}
        importDesignProject={jest.fn()}
      />
    );

    expect(html).toContain("dedicated repository token is configured");
    expect(html).not.toContain("github_pat_example");
  });
});
