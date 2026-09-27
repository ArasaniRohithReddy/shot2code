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
