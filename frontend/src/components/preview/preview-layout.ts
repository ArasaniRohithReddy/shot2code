export const MOBILE_VIEWPORT_WIDTH = 375;
export const DESKTOP_VIEWPORT_WIDTH = 1366;

/** Smallest zoom the canvas controls offer. Below this a 1366px layout is a
 *  thumbnail rather than a preview. */
export const MIN_PREVIEW_ZOOM = 0.25;
/** Largest zoom the canvas controls offer. Above this the canvas is mostly
 *  scrollbar and the iframe becomes awkward to interact with. */
export const MAX_PREVIEW_ZOOM = 2;
/** Zoom increment for the +/- buttons. */
export const PREVIEW_ZOOM_STEP = 0.1;

export type PreviewDevice = "mobile" | "desktop";
export type PreviewViewMode = "fit" | "actual" | "custom";

export interface PreviewCanvasLayout {
  /** Ratio the iframe is transform-scaled by. `fit` and `actual` never exceed
   *  1, because upscaling a fixed-width layout misrepresents it; `custom` is
   *  an explicit user choice and may magnify up to `MAX_PREVIEW_ZOOM`. */
  scale: number;
  /** Laid-out size of the canvas, which is what gets centred. */
  canvasWidth: number;
  canvasHeight: number;
  /** Unscaled size the document is rendered at inside the iframe. */
  iframeWidth: number;
  iframeHeight: number;
}

export function getPreviewBaseWidth(device: PreviewDevice) {
  return device === "desktop" ? DESKTOP_VIEWPORT_WIDTH : MOBILE_VIEWPORT_WIDTH;
}

/** Rounds to whole percent so repeated stepping cannot drift into values like
 *  0.7000000000000001 that would render as a jittery readout. */
function roundToPercent(scale: number) {
  return Math.round(scale * 100) / 100;
}

/** Keeps a requested zoom inside the safe range, falling back to 100% for
 *  NaN/Infinity rather than producing an invisible canvas. */
export function clampPreviewZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return roundToPercent(
    Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, scale))
  );
}

/**
 * Moves one `PREVIEW_ZOOM_STEP` away from `scale`, snapping onto the step grid
 * first. Stepping up from a fitted 43% therefore lands on 50%, not 53%.
 */
export function stepPreviewZoom(scale: number, direction: 1 | -1): number {
  const steps = clampPreviewZoom(scale) / PREVIEW_ZOOM_STEP;
  // The epsilon stops a value that already sits on the grid from snapping onto
  // itself and swallowing the step.
  const nextSteps =
    direction === 1 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;

  return clampPreviewZoom(nextSteps * PREVIEW_ZOOM_STEP);
}

export function canZoomPreviewIn(scale: number) {
  return clampPreviewZoom(scale) < MAX_PREVIEW_ZOOM;
}

export function canZoomPreviewOut(scale: number) {
  return clampPreviewZoom(scale) > MIN_PREVIEW_ZOOM;
}

/** Whole-percent readout for a scale, including fitted scales that legitimately
 *  sit outside the custom zoom range. */
export function formatPreviewZoomPercent(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 100;
  return Math.max(1, Math.round(scale * 100));
}

/**
 * Works out the canvas geometry for a fixed-width preview.
 *
 * The iframe is scaled from its top-left corner, so its own layout box stays
 * at full width and cannot be centred. The canvas mirrors the visible size
 * instead, which lets flexbox centre it and keeps the backdrop symmetric
 * rather than leaving a blank strip on one side. Once the canvas is wider than
 * the viewport — which a `custom` zoom above the fit ratio makes possible —
 * the scroll container pans instead of clipping.
 */
export function computePreviewCanvasLayout({
  device,
  viewMode,
  customScale,
  viewportWidth,
  viewportHeight,
}: {
  device: PreviewDevice;
  viewMode: PreviewViewMode;
  customScale?: number;
  viewportWidth: number;
  viewportHeight: number;
}): PreviewCanvasLayout {
  const baseWidth = getPreviewBaseWidth(device);
  const width = Math.max(0, viewportWidth);
  const height = Math.max(0, viewportHeight);
  // Mobile always fits: a 375px frame would otherwise scroll sideways on a
  // 352px window, and its zoom controls are never offered.
  const shouldFit = device === "mobile" || viewMode === "fit";

  let scale = 1;
  if (shouldFit) {
    scale = width > 0 ? Math.min(1, width / baseWidth) : 1;
  } else if (viewMode === "custom") {
    scale = clampPreviewZoom(customScale ?? 1);
  }

  return {
    scale,
    canvasWidth: baseWidth * scale,
    canvasHeight: height,
    iframeWidth: baseWidth,
    iframeHeight: scale > 0 ? height / scale : height,
  };
}

/**
 * The raw numbers a DOM element reports about its box.
 *
 * `clientWidth`/`clientHeight` are *rounded* integers, while the real content
 * box is fractional in any window that is not maximised (and on every
 * non-integer Windows display scale). Writing the rounded-up value back as the
 * canvas size overflows the real box by a fraction of a pixel, which summons a
 * scrollbar, shrinks the viewport, changes the fit ratio and starts the loop
 * again — the flicker this type exists to prevent.
 */
export interface PreviewViewportBox {
  /** Fractional border-box size from `getBoundingClientRect()`. */
  rectWidth: number;
  rectHeight: number;
  /** Rounded border-box size; only the gap to `client*` is used. */
  offsetWidth: number;
  offsetHeight: number;
  /** Rounded content-box size, i.e. border-box minus borders and scrollbars. */
  clientWidth: number;
  clientHeight: number;
}

export interface PreviewViewportSize {
  width: number;
  height: number;
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Resolves the usable content box, floored to whole pixels.
 *
 * Flooring guarantees the canvas is never wider or taller than the box that
 * holds it, so a sub-pixel overflow can never create the scrollbar that would
 * feed back into the next measurement.
 */
export function resolvePreviewViewportSize(
  box: PreviewViewportBox
): PreviewViewportSize {
  const gutterX = Math.max(0, finite(box.offsetWidth) - finite(box.clientWidth));
  const gutterY = Math.max(
    0,
    finite(box.offsetHeight) - finite(box.clientHeight)
  );

  return {
    width: Math.max(0, Math.floor(finite(box.rectWidth) - gutterX)),
    height: Math.max(0, Math.floor(finite(box.rectHeight) - gutterY)),
  };
}

const SCALE_PRECISION = 10_000;

/**
 * Snaps a layout to the precision that is actually written to the DOM, so two
 * measurements that differ only in float noise compare equal and no style is
 * rewritten.
 */
export function roundPreviewCanvasLayout(
  layout: PreviewCanvasLayout
): PreviewCanvasLayout {
  const scale = Math.round(layout.scale * SCALE_PRECISION) / SCALE_PRECISION;

  return {
    scale,
    canvasWidth: Math.round(layout.canvasWidth),
    canvasHeight: Math.round(layout.canvasHeight),
    iframeWidth: Math.round(layout.iframeWidth),
    // The document must never be shorter than the canvas it fills; the canvas
    // clips the overhang, so rounding up is free.
    iframeHeight: Math.ceil(layout.iframeHeight),
  };
}

export function isSamePreviewCanvasLayout(
  left: PreviewCanvasLayout,
  right: PreviewCanvasLayout
): boolean {
  return (
    left.scale === right.scale &&
    left.canvasWidth === right.canvasWidth &&
    left.canvasHeight === right.canvasHeight &&
    left.iframeWidth === right.iframeWidth &&
    left.iframeHeight === right.iframeHeight
  );
}

export type PreviewLayoutUpdate =
  | { action: "skip"; reason: "hidden" | "unchanged" }
  | { action: "apply"; layout: PreviewCanvasLayout };

/**
 * Decides what a single resize observation should do.
 *
 * Kept pure and separate from the component so the flicker cases — a hidden
 * tab reporting nothing, a scrollbar appearing and disappearing, a fractional
 * window height — can be driven deterministically in a test.
 */
export function resolvePreviewLayoutUpdate({
  device,
  viewMode,
  customScale,
  box,
  applied,
}: {
  device: PreviewDevice;
  viewMode: PreviewViewMode;
  customScale?: number;
  box: PreviewViewportBox;
  applied: PreviewCanvasLayout | null;
}): PreviewLayoutUpdate {
  const { width, height } = resolvePreviewViewportSize(box);
  // A hidden or not-yet-laid-out pane measures zero. Applying that would
  // collapse the canvas to 0px, or fall back to an unscaled 100% canvas, and
  // then visibly snap back when the pane appears.
  if (width <= 0 || height <= 0) return { action: "skip", reason: "hidden" };

  const layout = roundPreviewCanvasLayout(
    computePreviewCanvasLayout({
      device,
      viewMode,
      customScale,
      viewportWidth: width,
      viewportHeight: height,
    })
  );

  if (applied && isSamePreviewCanvasLayout(applied, layout)) {
    return { action: "skip", reason: "unchanged" };
  }

  return { action: "apply", layout };
}
