import {
  canZoomPreviewIn,
  canZoomPreviewOut,
  clampPreviewZoom,
  computePreviewCanvasLayout,
  DESKTOP_VIEWPORT_WIDTH,
  formatPreviewZoomPercent,
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  MOBILE_VIEWPORT_WIDTH,
  stepPreviewZoom,
} from "./preview-layout";

describe("preview canvas layout", () => {
  it("keeps the canvas narrower than the viewport at 100%, so it can be centred", () => {
    const layout = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "actual",
      viewportWidth: 1536,
      viewportHeight: 900,
    });

    expect(layout.scale).toBe(1);
    expect(layout.canvasWidth).toBe(DESKTOP_VIEWPORT_WIDTH);
    // 1536 - 1366 = 170px of backdrop, 85px on each side once centred.
    expect(layout.canvasWidth).toBeLessThan(1536);
    expect(layout.iframeWidth).toBe(DESKTOP_VIEWPORT_WIDTH);
    expect(layout.iframeHeight).toBe(900);
  });

  it("never upscales the desktop canvas above its own width", () => {
    const layout = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "fit",
      viewportWidth: 1900,
      viewportHeight: 1000,
    });

    expect(layout.scale).toBe(1);
    expect(layout.canvasWidth).toBe(DESKTOP_VIEWPORT_WIDTH);
  });

  it("fills the viewport exactly when fitting a narrower window", () => {
    const layout = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "fit",
      viewportWidth: 1056,
      viewportHeight: 800,
    });

    expect(layout.scale).toBeCloseTo(1056 / DESKTOP_VIEWPORT_WIDTH);
    expect(layout.canvasWidth).toBeCloseTo(1056);
    expect(layout.canvasHeight).toBe(800);
    // The document still renders at full width and is scaled down.
    expect(layout.iframeWidth).toBe(DESKTOP_VIEWPORT_WIDTH);
    expect(layout.iframeHeight).toBeCloseTo(800 / layout.scale);
  });

  it("scales the mobile frame down rather than clipping it on a narrow window", () => {
    const layout = computePreviewCanvasLayout({
      device: "mobile",
      viewMode: "actual",
      viewportWidth: 352,
      viewportHeight: 600,
    });

    expect(layout.iframeWidth).toBe(MOBILE_VIEWPORT_WIDTH);
    expect(layout.scale).toBeCloseTo(352 / MOBILE_VIEWPORT_WIDTH);
    expect(layout.canvasWidth).toBeCloseTo(352);
  });

  it("keeps the mobile frame at its real width when there is room", () => {
    const layout = computePreviewCanvasLayout({
      device: "mobile",
      viewMode: "fit",
      viewportWidth: 1200,
      viewportHeight: 900,
    });

    expect(layout.scale).toBe(1);
    expect(layout.canvasWidth).toBe(MOBILE_VIEWPORT_WIDTH);
  });

  it("survives a hidden tab reporting a zero-sized viewport", () => {
    const layout = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "fit",
      viewportWidth: 0,
      viewportHeight: 0,
    });

    expect(layout.scale).toBe(1);
    expect(layout.canvasWidth).toBe(DESKTOP_VIEWPORT_WIDTH);
    expect(layout.iframeHeight).toBe(0);
  });

  it("magnifies the canvas past the viewport at a custom zoom, so the container pans", () => {
    const layout = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "custom",
      customScale: 2,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(layout.scale).toBe(2);
    expect(layout.canvasWidth).toBe(DESKTOP_VIEWPORT_WIDTH * 2);
    expect(layout.canvasWidth).toBeGreaterThan(1200);
    // The document still renders at its own width; only the transform grows.
    expect(layout.iframeWidth).toBe(DESKTOP_VIEWPORT_WIDTH);
    expect(layout.iframeHeight).toBe(400);
  });

  it("shrinks the canvas below the fit ratio when asked to", () => {
    const layout = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "custom",
      customScale: 0.25,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(layout.scale).toBe(0.25);
    expect(layout.canvasWidth).toBeCloseTo(DESKTOP_VIEWPORT_WIDTH * 0.25);
    expect(layout.iframeHeight).toBe(3200);
  });

  it("clamps an out-of-range custom zoom instead of rendering it", () => {
    const tooSmall = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "custom",
      customScale: 0.01,
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    const tooLarge = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "custom",
      customScale: 12,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(tooSmall.scale).toBe(MIN_PREVIEW_ZOOM);
    expect(tooLarge.scale).toBe(MAX_PREVIEW_ZOOM);
  });

  it("falls back to 100% for a missing or unusable custom zoom", () => {
    const missing = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "custom",
      viewportWidth: 1200,
      viewportHeight: 800,
    });
    const broken = computePreviewCanvasLayout({
      device: "desktop",
      viewMode: "custom",
      customScale: Number.NaN,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(missing.scale).toBe(1);
    expect(broken.scale).toBe(1);
  });

  it("ignores a custom zoom on mobile, which always fits", () => {
    const layout = computePreviewCanvasLayout({
      device: "mobile",
      viewMode: "custom",
      customScale: 2,
      viewportWidth: 352,
      viewportHeight: 600,
    });

    expect(layout.scale).toBeCloseTo(352 / MOBILE_VIEWPORT_WIDTH);
    expect(layout.canvasWidth).toBeCloseTo(352);
  });
});

describe("preview zoom stepping", () => {
  it("clamps to the safe range and keeps whole percents", () => {
    expect(clampPreviewZoom(0.1)).toBe(MIN_PREVIEW_ZOOM);
    expect(clampPreviewZoom(5)).toBe(MAX_PREVIEW_ZOOM);
    expect(clampPreviewZoom(0.7000000000000001)).toBe(0.7);
    expect(clampPreviewZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampPreviewZoom(Number.NaN)).toBe(1);
  });

  it("moves a whole 10% step from a value already on the grid", () => {
    expect(stepPreviewZoom(1, 1)).toBe(1.1);
    expect(stepPreviewZoom(1, -1)).toBe(0.9);
    expect(stepPreviewZoom(0.5, -1)).toBe(0.4);
  });

  it("snaps an off-grid fitted scale onto the grid", () => {
    // 1056/1366 ≈ 0.773: stepping should land on 80% and 70%, not 87%/67%.
    const fitted = 1056 / DESKTOP_VIEWPORT_WIDTH;
    expect(stepPreviewZoom(fitted, 1)).toBe(0.8);
    expect(stepPreviewZoom(fitted, -1)).toBe(0.7);
  });

  it("never steps outside the range", () => {
    expect(stepPreviewZoom(MAX_PREVIEW_ZOOM, 1)).toBe(MAX_PREVIEW_ZOOM);
    expect(stepPreviewZoom(MIN_PREVIEW_ZOOM, -1)).toBe(MIN_PREVIEW_ZOOM);
  });

  it("does not drift after repeated stepping", () => {
    let zoom = 1;
    for (let index = 0; index < 5; index += 1) zoom = stepPreviewZoom(zoom, -1);
    expect(zoom).toBe(0.5);
    for (let index = 0; index < 5; index += 1) zoom = stepPreviewZoom(zoom, 1);
    expect(zoom).toBe(1);
  });

  it("reports whether each direction is still available", () => {
    expect(canZoomPreviewOut(MIN_PREVIEW_ZOOM)).toBe(false);
    expect(canZoomPreviewOut(0.3)).toBe(true);
    expect(canZoomPreviewIn(MAX_PREVIEW_ZOOM)).toBe(false);
    expect(canZoomPreviewIn(1.9)).toBe(true);
    // A fitted scale below the range still cannot zoom out any further.
    expect(canZoomPreviewOut(0.1)).toBe(false);
  });

  it("formats a readout for fitted scales outside the zoom range", () => {
    expect(formatPreviewZoomPercent(0.7734)).toBe(77);
    expect(formatPreviewZoomPercent(1)).toBe(100);
    expect(formatPreviewZoomPercent(0.1)).toBe(10);
    expect(formatPreviewZoomPercent(0)).toBe(100);
    expect(formatPreviewZoomPercent(Number.NaN)).toBe(100);
  });
});
