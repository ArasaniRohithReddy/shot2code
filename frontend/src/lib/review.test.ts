import type { AuditFinding } from "./source-audit";
import {
  DEFAULT_REVIEW_VIEWPORTS,
  buildFixFindingsInstruction,
  classifyAuditFindings,
  createReviewBinding,
  formatHorizontalOverflowMessage,
  getReviewViewportDimensions,
  hashReviewProjectFiles,
  hashReviewSource,
  isReviewRunStale,
  normalizeReviewViewportPresets,
  serializeReviewReport,
  validateReviewWidth,
  type ReviewRun,
} from "./review";

const finding = (
  severity: AuditFinding["severity"],
  ruleId = "image-alt"
): AuditFinding => ({
  id: `${ruleId}-1`,
  severity,
  ruleId,
  message: "An image has no alt attribute.",
  evidence: "<img.hero> at line 8 omits alt.",
  affectedFile: "src/index.html",
  guidance: 'Add alt="" for a decorative image.',
});

describe("review viewport preferences", () => {
  test.each([
    ["320", 320],
    ["390", 390],
    [1920, 1920],
  ])("accepts %p", (input, expected) => {
    expect(validateReviewWidth(input)).toEqual({
      valid: true,
      width: expected,
    });
  });

  test.each([
    ["", "whole number"],
    ["390.5", "whole number"],
    ["abc", "whole number"],
    ["319", "between 320px and 1920px"],
    ["1921", "between 320px and 1920px"],
  ])("rejects invalid width %p", (input, message) => {
    const result = validateReviewWidth(input);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain(message);
  });

  it("rejects duplicates", () => {
    expect(validateReviewWidth("768", [1440, 768, 390])).toEqual({
      valid: false,
      message: "768px is already in this review.",
    });
  });

  it("bounds and repairs untrusted persisted presets", () => {
    const normalized = normalizeReviewViewportPresets([
      { id: "unsafe", label: " A custom label ", width: 1024 },
      { id: "duplicate", label: "Duplicate", width: 1024 },
      { id: "too-small", label: "No", width: 100 },
      { id: "wide", label: "Wide", width: 1920 },
      { id: "third", label: "Third", width: 640 },
      { id: "fourth", label: "Fourth", width: 480 },
      { id: "fifth", label: "Must not render", width: 360 },
    ]);

    expect(normalized).toHaveLength(4);
    expect(normalized.map((preset) => preset.width)).toEqual([
      1024, 1920, 640, 480,
    ]);
    expect(normalized[0]).toMatchObject({
      id: "viewport-1024",
      label: "A custom label",
    });
    expect(normalizeReviewViewportPresets("bad")).toEqual(
      DEFAULT_REVIEW_VIEWPORTS
    );
  });

  it("derives dimensions and orientation without changing the review width", () => {
    expect(getReviewViewportDimensions(1440)).toEqual({
      width: 1440,
      height: 900,
      orientation: "Landscape",
    });
    expect(getReviewViewportDimensions(768)).toEqual({
      width: 768,
      height: 1024,
      orientation: "Portrait",
    });
  });
});

describe("review binding and staleness", () => {
  const current = createReviewBinding({
    commitHash: "commit-a",
    variantIndex: 1,
    source: "<main>Current</main>",
    viewportWidths: [1440, 390, 768],
  });
  const run = {
    binding: current,
  } as ReviewRun;

  it("hashes identical source identically and changes on edits", () => {
    expect(hashReviewSource("same")).toBe(hashReviewSource("same"));
    expect(hashReviewSource("same")).not.toBe(hashReviewSource("Same"));
    expect(hashReviewSource("same")).toMatch(/^[a-f0-9]{8}-[a-z0-9]+$/);
  });

  it("hashes every selected variant file, including files outside the preview artifact", () => {
    const before = hashReviewProjectFiles({
      "index.html": { content: "<main>Hello</main>" },
      "notes.txt": { content: "first" },
    });
    const after = hashReviewProjectFiles({
      "index.html": { content: "<main>Hello</main>" },
      "notes.txt": { content: "edited" },
    });

    expect(before).not.toBe(after);
    expect(
      hashReviewProjectFiles({
        "notes.txt": { content: "first" },
        "index.html": { content: "<main>Hello</main>" },
      })
    ).toBe(before);
  });

  it("normalizes viewport sets before binding", () => {
    expect(current.viewportWidths).toEqual([390, 768, 1440]);
  });

  it("stays current only for the same commit, variant, code, and viewports", () => {
    expect(isReviewRunStale(run, { ...current })).toBe(false);
    expect(
      isReviewRunStale(run, { ...current, commitHash: "commit-b" })
    ).toBe(true);
    expect(
      isReviewRunStale(run, { ...current, variantIndex: 0 })
    ).toBe(true);
    expect(
      isReviewRunStale(run, { ...current, codeHash: "changed" })
    ).toBe(true);
    expect(
      isReviewRunStale(run, {
        ...current,
        viewportWidths: [390, 768],
      })
    ).toBe(true);
    expect(isReviewRunStale(null, current)).toBe(false);
  });
});

describe("review summaries and messages", () => {
  it("classifies every severity", () => {
    expect(
      classifyAuditFindings([
        finding("error"),
        finding("warning", "document-title"),
        finding("warning", "positive-tabindex"),
        finding("info", "advisory"),
      ])
    ).toEqual({ error: 1, warning: 2, info: 1, total: 4 });
  });

  it("formats pending, passing, and failing overflow states", () => {
    expect(formatHorizontalOverflowMessage(390)).toBe(
      "Checking horizontal overflow at 390px."
    );
    expect(
      formatHorizontalOverflowMessage(390, {
        viewportWidth: 390,
        documentWidth: 390,
        horizontalOverflow: false,
      })
    ).toBe("No horizontal overflow detected at 390px.");
    expect(
      formatHorizontalOverflowMessage(390, {
        viewportWidth: 390,
        documentWidth: 642.2,
        horizontalOverflow: true,
      })
    ).toBe(
      "Horizontal overflow: content is 253px wider than the 390px measured viewport."
    );
  });

  it("groups selected findings into a concise, editable chat instruction", () => {
    const instruction = buildFixFindingsInstruction(
      [
        finding("error"),
        { ...finding("error"), id: "image-alt-2" },
        finding("warning", "document-title"),
      ],
      [1440, 390]
    );

    expect(instruction).toContain("3 selected findings");
    expect(instruction).toContain("[image-alt] 2");
    expect(instruction).toContain("[document-title] 1");
    expect(instruction).toContain("1440px, 390px");
  });

  it("exports metadata and findings without embedding source or absolute paths", () => {
    const run: ReviewRun = {
      binding: createReviewBinding({
        commitHash: "abc123",
        variantIndex: 0,
        source: "<p>private source must not be exported</p>",
        viewportWidths: [390, 768],
      }),
      createdAt: "2026-09-19T10:00:00.000Z",
      artifactPath: "C:\\private\\project\\index.html",
      findings: [finding("error")],
      counts: { error: 1, warning: 0, info: 0, total: 1 },
    };
    const report = serializeReviewReport(run, false);

    expect(report).not.toContain("private source must not be exported");
    expect(report).not.toContain("C:\\\\");
    expect(JSON.parse(report)).toMatchObject({
      schemaVersion: 1,
      kind: "shot2code-local-source-review",
      stale: false,
      target: {
        commitHash: "abc123",
        variantIndex: 0,
        viewportWidths: [390, 768],
      },
      summary: { error: 1, warning: 0, info: 0, total: 1 },
    });
  });
});
