import { renderToStaticMarkup } from "react-dom/server";
import type { Commit } from "../commits/types";
import { Stack } from "../../lib/stacks";
import ConversationThread from "./ConversationThread";
import { buildConversationTurns } from "./conversation-thread";

function commit(
  hash: string,
  parentHash: string | null,
  text: string,
  selectedVariantIndex = 0
): Commit {
  return {
    hash,
    parentHash,
    dateCreated: new Date(),
    isCommitted: false,
    selectedVariantIndex,
    type: parentHash ? "ai_edit" : "ai_create",
    inputs: { text, images: [], videos: [] },
    variants: [
      {
        code: "<main>one</main>",
        history: [
          {
            role: "user",
            text,
            imageAssetIds: [],
            videoAssetIds: [],
          },
          {
            role: "assistant",
            text: "<main>one</main>",
            imageAssetIds: [],
            videoAssetIds: [],
          },
        ],
        status: "complete",
        model: "model-one",
      },
      {
        code: "<main>two</main>",
        history: [],
        status: "complete",
        model: "model-two",
      },
    ],
  };
}

test("builds the complete active branch in chronological order", () => {
  const first = commit("first", null, "Create the dashboard", 0);
  const second = {
    ...commit("second", "first", "Make the chart larger", 1),
    generationContext: {
      inputMode: "text" as const,
      stack: Stack.HTML_TAILWIND,
      selectedModels: ["model-two"],
      baseCommitHash: "first",
      baseVariantIndex: 1,
    },
  };

  const turns = buildConversationTurns(
    { first, second },
    "second"
  );

  expect(turns.map((turn) => turn.prompt)).toEqual([
    "Create the dashboard",
    "Make the chart larger",
  ]);
  expect(turns[0].variantIndex).toBe(1);
  expect(turns[0].model).toBe("model-two");
});

test("renders earlier and latest prompts in the Chat thread", () => {
  const first = commit("first", null, "Create the dashboard");
  const second = commit("second", "first", "Make the chart larger");

  const html = renderToStaticMarkup(
    <ConversationThread
      commits={{ first, second }}
      head="second"
      onOpenImage={jest.fn()}
    />
  );

  expect(html).toContain("Create the dashboard");
  expect(html).toContain("Make the chart larger");
  expect(html).toContain("Generated source response");
  expect(html).toContain("&lt;main&gt;one&lt;/main&gt;");
  expect(html).toContain("Conversation history for the selected branch");
});
