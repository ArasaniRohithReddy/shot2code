import { renderToStaticMarkup } from "react-dom/server";
import { HistoryAncestryLinks } from "./HistoryDisplay";
import { renderHistory } from "./utils";
import type { Commit } from "../commits/types";

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

  test("history records the exact selected option model identity", () => {
    const commit: Commit = {
      hash: "version",
      parentHash: null,
      dateCreated: new Date(),
      isCommitted: true,
      selectedVariantIndex: 1,
      type: "ai_create",
      inputs: { text: "Create", images: [], videos: [] },
      variants: [
        {
          code: "<main>native</main>",
          history: [],
          status: "complete",
          model: "gpt-5.6-sol (high thinking)",
        },
        {
          code: "<main>byok</main>",
          history: [],
          status: "complete",
          model: "sdk-byok/openai/custom/my-model",
        },
      ],
    };

    const [rendered] = renderHistory([commit]);

    expect(rendered.selectedVariantModel).toBe(
      "sdk-byok/openai/custom/my-model"
    );
    expect(rendered.selectedVariantNumber).toBe(2);
  });
});
