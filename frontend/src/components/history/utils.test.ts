import { renderHistory } from "./utils";
import type { Commit } from "../commits/types";

function commit(
  hash: string,
  parentHash: string | null,
  type: Commit["type"],
  text: string,
  minute: number,
  retryOfHash: string | null = null
): Commit {
  const base = {
    hash,
    parentHash,
    retryOfHash,
    dateCreated: new Date(`2026-09-13T00:0${minute}:00.000Z`),
    isCommitted: true,
    variants: [{ code: `<main>${hash}</main>`, history: [] }],
    selectedVariantIndex: 0,
  };
  if (type === "code_create") {
    return { ...base, type, inputs: null };
  }
  return {
    ...base,
    type,
    inputs: { text, images: [], videos: [] },
  };
}

describe("history ancestry rendering", () => {
  it("keeps linear history labels compact", () => {
    const history = [
      commit("root", null, "ai_create", "", 0),
      commit("edit", "root", "ai_edit", "Use better icons", 1),
      commit("next", "edit", "ai_edit", "Make text red", 2),
    ];

    const rendered = renderHistory(history);

    expect(rendered.map((item) => item.version)).toEqual([1, 2, 3]);
    expect(rendered.map((item) => item.type)).toEqual([
      "Create",
      "Edit",
      "Edit",
    ]);
    expect(rendered.every((item) => item.parentLink === null)).toBe(true);
    expect(rendered.every((item) => item.retrySource === null)).toBe(true);
  });

  it("labels branches and repeated retry descendants with navigable targets", () => {
    const history = [
      commit("root", null, "ai_create", "Create", 0),
      commit("edit", "root", "ai_edit", "Use better icons", 1),
      commit("retry-a", "edit", "ai_edit", "Use better icons", 2, "edit"),
      commit("branch", "root", "ai_edit", "Try green", 3),
      commit("retry-b", "edit", "ai_edit", "Use better icons", 4, "edit"),
    ];

    const rendered = renderHistory(history);
    const edit = rendered[1];
    const firstRetry = rendered[2];
    const branch = rendered[3];
    const secondRetry = rendered[4];

    expect(edit.retryDescendants).toEqual([
      { hash: "retry-a", version: 3 },
      { hash: "retry-b", version: 5 },
    ]);
    expect(firstRetry).toEqual(
      expect.objectContaining({
        type: "Retry",
        retrySource: { hash: "edit", version: 2 },
        parentLink: null,
        parentVersion: null,
      })
    );
    expect(secondRetry.retrySource).toEqual({ hash: "edit", version: 2 });
    expect(branch.parentLink).toEqual({ hash: "root", version: 1 });
    expect(branch.parentVersion).toBe(1);
  });
});
