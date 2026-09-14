export const MOBILE_VIEWPORT_WIDTH = 375;
export const DESKTOP_VIEWPORT_WIDTH = 1366;

export type PreviewDevice = "mobile" | "desktop";
export type PreviewViewMode = "fit" | "actual";

export interface PreviewCanvasLayout {
  /** Ratio the iframe is transform-scaled by. Never above 1: upscaling a
   *  fixed-width layout misrepresents it. */
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

/**
 * Works out the canvas geometry for a fixed-width preview.
 *
 * The iframe is scaled from its top-left corner, so its own layout box stays
 * at full width and cannot be centred. The canvas mirrors the visible size
 * instead, which lets flexbox centre it and keeps the backdrop symmetric
 * rather than leaving a blank strip on one side.
 */
export function computePreviewCanvasLayout({
  device,
  viewMode,
  viewportWidth,
  viewportHeight,
}: {
  device: PreviewDevice;
  viewMode: PreviewViewMode;
  viewportWidth: number;
  viewportHeight: number;
}): PreviewCanvasLayout {
  const baseWidth = getPreviewBaseWidth(device);
  const width = Math.max(0, viewportWidth);
  const height = Math.max(0, viewportHeight);
  // Mobile always fits: a 375px frame would otherwise scroll sideways on a
  // 352px window.
  const shouldFit = device === "mobile" || viewMode === "fit";
  const scale = shouldFit && width > 0 ? Math.min(1, width / baseWidth) : 1;

  return {
    scale,
    canvasWidth: baseWidth * scale,
    canvasHeight: height,
    iframeWidth: baseWidth,
    iframeHeight: scale > 0 ? height / scale : height,
  };
}
