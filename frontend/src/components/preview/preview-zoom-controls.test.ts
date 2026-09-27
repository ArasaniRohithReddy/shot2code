import * as fs from "fs";
import * as path from "path";

/**
 * The preview toolbar is not covered by a DOM test runner in this project, so
 * the accessibility contract of the zoom cluster is asserted statically:
 * native buttons, 44px targets, explicit labels, and a live percentage.
 */
const PREVIEW_DIR = path.resolve(process.cwd(), "src/components/preview");
const previewPaneSource = fs.readFileSync(
  path.join(PREVIEW_DIR, "PreviewPane.tsx"),
  "utf8"
);
const previewComponentSource = fs.readFileSync(
  path.join(PREVIEW_DIR, "PreviewComponent.tsx"),
  "utf8"
);

/** Returns the opening JSX tag carrying `data-testid`, skipping over `=>` and
 *  other `>` characters that live inside expressions or template literals. */
function readOpeningTag(source: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Missing data-testid="${testId}"`);
  }

  const start = source.lastIndexOf("<", markerIndex);
  let depth = 0;
  let quote: string | null = null;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  throw new Error(`Unterminated tag for data-testid="${testId}"`);
}

describe("preview zoom controls markup", () => {
  const zoomOut = readOpeningTag(previewPaneSource, "preview-zoom-out");
  const zoomIn = readOpeningTag(previewPaneSource, "preview-zoom-in");
  const zoomValue = readOpeningTag(previewPaneSource, "preview-zoom-value");
  const zoomFit = readOpeningTag(previewPaneSource, "preview-zoom-fit");
  const zoomActual = readOpeningTag(previewPaneSource, "preview-zoom-actual");
  const group = readOpeningTag(previewPaneSource, "preview-zoom-controls");

  it("exposes the cluster as a labelled group", () => {
    expect(group).toContain('role="group"');
    expect(group).toContain('aria-label="Desktop preview zoom"');
  });

  it("uses native keyboard-operable buttons for every action", () => {
    for (const tag of [zoomOut, zoomIn, zoomFit, zoomActual]) {
      expect(tag.startsWith("<button")).toBe(true);
      expect(tag).toContain('type="button"');
      expect(tag).toContain("onClick=");
      expect(tag).toContain("aria-label=");
      expect(tag).toContain("title=");
    }
  });

  it("keeps every target at least 44px tall", () => {
    expect(zoomOut).toContain("h-11 w-11");
    expect(zoomIn).toContain("h-11 w-11");
    expect(zoomFit).toContain("min-h-11");
    expect(zoomActual).toContain("min-h-11");
    expect(zoomValue).toContain("min-h-11");
  });

  it("announces the current percentage without stealing focus", () => {
    expect(zoomValue.startsWith("<span")).toBe(true);
    expect(zoomValue).toContain('role="status"');
    expect(zoomValue).toContain('aria-live="polite"');
    expect(zoomValue).not.toContain("onClick=");
    expect(previewPaneSource).toContain("{desktopZoomPercent}%");
  });

  it("disables a direction at the end of the safe range", () => {
    expect(zoomOut).toContain("disabled={!canZoomOut}");
    expect(zoomIn).toContain("disabled={!canZoomIn}");
  });

  it("keeps Fit and 100% as toggle state rather than plain buttons", () => {
    expect(zoomFit).toContain(
      'aria-pressed={effectiveDesktopViewMode === "fit"}'
    );
    expect(zoomActual).toContain(
      'aria-pressed={effectiveDesktopViewMode === "actual"}'
    );
  });

  it("honours reduced motion and the violet focus ring", () => {
    for (const tag of [zoomOut, zoomIn, zoomFit, zoomActual]) {
      expect(tag).toContain("motion-reduce:transition-none");
      expect(tag).toContain("focus-visible:ring-violet-500");
    }
  });

  it("keeps the existing preview affordances alongside the zoom cluster", () => {
    for (const testId of [
      "tab-desktop",
      "tab-mobile",
      "tab-review",
      "tab-code",
    ]) {
      expect(previewPaneSource).toContain(`data-testid="${testId}"`);
    }
    expect(previewPaneSource).toContain("SelectAndEditToolbarButton");
    expect(previewPaneSource).toContain(
      "Open preview artifact in new tab"
    );
    expect(previewPaneSource).toContain('aria-label="Preview source"');
  });

  it("pans a magnified canvas instead of clipping or blocking the iframe", () => {
    expect(previewComponentSource).toContain(
      'className="relative min-h-0 flex-1 overflow-auto'
    );
    expect(previewComponentSource).toContain("w-fit min-w-full");
    expect(previewComponentSource).toContain("customScale");
    // Nothing may sit over the iframe: select-to-edit runs inside the sandbox.
    expect(previewComponentSource).not.toContain("pointer-events-none");
    expect(previewComponentSource).not.toContain("absolute inset-0");
  });
});
