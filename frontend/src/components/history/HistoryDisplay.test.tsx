import { renderToStaticMarkup } from "react-dom/server";
import { HistoryAncestryLinks } from "./HistoryDisplay";

describe("HistoryDisplay retry ancestry", () => {
  it("shows retry source, descendants, and branch navigation labels", () => {
    const html = renderToStaticMarkup(
      <HistoryAncestryLinks
        retrySource={{ hash: "source", version: 1 }}
        retryDescendants={[
          { hash: "retry-one", version: 2 },
          { hash: "retry-two", version: 3 },
        ]}
        parentLink={{ hash: "branch-parent", version: 4 }}
        onNavigate={jest.fn()}
      />
    );

    expect(html).toContain("Retried from v1");
    expect(html).toContain("Retried as v2");
    expect(html).toContain("Retried as v3");
    expect(html).toContain("Branch from v4");
    expect(html).toContain('aria-label="Go to retry source version 1"');
    expect(html).toContain('aria-label="Go to retry descendant version 2"');
  });
});
