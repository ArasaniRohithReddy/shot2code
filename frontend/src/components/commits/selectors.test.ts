import type { Commit, VariantStatus } from "./types";
import {
  getSelectedVariantState,
  getVariantUpdateUnavailableMessage,
} from "./selectors";

function makeCommit(
  statuses: VariantStatus[],
  selectedVariantIndex: number
): Commit {
  return {
    hash: "commit",
    parentHash: null,
    dateCreated: new Date(1_000),
    isCommitted: false,
    selectedVariantIndex,
    type: "ai_create",
    inputs: { text: "Create", images: [] },
    variants: statuses.map((status, index) => ({
      code: `<main>Option ${index + 1}</main>`,
      history: [
        {
          role: "user",
          text: `Option ${index + 1} history`,
          imageAssetIds: [],
          videoAssetIds: [],
        },
      ],
      status,
      activeFilePath: `option-${index + 1}.html`,
    })),
  };
}

test("option 3 completion enables its composer and exposes its own state", () => {
  const commit = makeCommit(
    ["generating", "generating", "complete", "generating"],
    2
  );

  const selected = getSelectedVariantState(commit);

  expect(selected.index).toBe(2);
  expect(selected.status).toBe("complete");
  expect(selected.canUpdate).toBe(true);
  expect(selected.variant?.history[0].text).toBe("Option 3 history");
  expect(selected.variant?.activeFilePath).toBe("option-3.html");
});

test.each<VariantStatus>(["generating", "error", "cancelled"])(
  "a selected %s option keeps the composer unavailable",
  (status) => {
    const commit = makeCommit(["complete", "complete", status], 2);

    expect(getSelectedVariantState(commit).canUpdate).toBe(false);
  }
);

test("switching between completed options keeps two-option updates working", () => {
  const commit = makeCommit(["complete", "complete"], 0);

  expect(getSelectedVariantState(commit).canUpdate).toBe(true);
  commit.selectedVariantIndex = 1;

  const selected = getSelectedVariantState(commit);
  expect(selected.canUpdate).toBe(true);
  expect(selected.variant?.history[0].text).toBe("Option 2 history");
});

test("returns status-specific feedback when an update is blocked", () => {
  expect(getVariantUpdateUnavailableMessage("generating")).toContain(
    "finish generating"
  );
  expect(getVariantUpdateUnavailableMessage("error")).toContain("failed");
  expect(getVariantUpdateUnavailableMessage("cancelled")).toContain(
    "cancelled"
  );
});
