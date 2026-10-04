import { renderToStaticMarkup } from "react-dom/server";
import {
  HistoryAncestryLinks,
  HistoryExpandedDetails,
} from "./HistoryDisplay";
import { renderHistory } from "./utils";
import type { Commit } from "../commits/types";
import { Stack } from "../../lib/stacks";

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

  test("expanded project history shows models, messages, attachments and activity", () => {
    const commit: Commit = {
      hash: "version",
      parentHash: null,
      dateCreated: new Date("2026-10-04T12:00:00Z"),
      isCommitted: true,
      selectedVariantIndex: 0,
      type: "ai_edit",
      inputs: {
        text: "Modernize the dashboard",
        images: [],
        videos: [],
      },
      generationContext: {
        inputMode: "text",
        stack: Stack.REACT_TAILWIND,
        selectedModels: ["sdk-byok/openai/custom/local-model"],
      },
      variants: [
        {
          code: "<main>updated</main>",
          history: [
            {
              role: "user",
              text: "Modernize the dashboard",
              imageAssetIds: ["image-1"],
              videoAssetIds: [],
            },
            {
              role: "assistant",
              text: "Updated the dashboard.",
              imageAssetIds: [],
              videoAssetIds: [],
            },
          ],
          status: "complete",
          model: "sdk-byok/openai/custom/local-model",
          completedAt: Date.parse("2026-10-04T12:00:05Z"),
          agentEvents: [
            {
              id: "tool-1",
              type: "tool",
              status: "complete",
              toolName: "edit_file",
              content: "Updated index.html",
              startedAt: Date.parse("2026-10-04T12:00:01Z"),
              endedAt: Date.parse("2026-10-04T12:00:02Z"),
            },
          ],
        },
      ],
    };
    const [item] = renderHistory([commit]);
    const html = renderToStaticMarkup(
      <HistoryExpandedDetails item={item} />
    );

    expect(html).toContain("Requested models");
    expect(html).toContain("sdk-byok/openai/custom/local-model");
    expect(html).toContain("Selected option conversation");
    expect(html).toContain("Modernize the dashboard");
    expect(html).toContain("Updated the dashboard.");
    expect(html).toContain("1 attachment");
    expect(html).toContain("Saved agent activity");
    expect(html).toContain("edit_file");
  });
});
