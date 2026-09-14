import {
  computePreviewCanvasLayout,
  DESKTOP_VIEWPORT_WIDTH,
  MOBILE_VIEWPORT_WIDTH,
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
});
