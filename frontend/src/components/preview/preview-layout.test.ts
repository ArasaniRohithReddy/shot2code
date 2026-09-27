import {
  canZoomPreviewIn,
  canZoomPreviewOut,
  clampPreviewZoom,
  computePreviewCanvasLayout,
  DESKTOP_VIEWPORT_WIDTH,
  formatPreviewZoomPercent,
  isSamePreviewCanvasLayout,
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  MOBILE_VIEWPORT_WIDTH,
  resolvePreviewLayoutUpdate,
  resolvePreviewViewportSize,
  roundPreviewCanvasLayout,
  stepPreviewZoom,
  type PreviewCanvasLayout,
  type PreviewViewportBox,
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

/** A viewport with no scrollbars and no borders. */
function box(
  rectWidth: number,
  rectHeight: number,
  gutter: { x?: number; y?: number } = {}
): PreviewViewportBox {
  const gutterX = gutter.x ?? 0;
  const gutterY = gutter.y ?? 0;
  return {
    rectWidth,
    rectHeight,
    offsetWidth: Math.round(rectWidth),
    offsetHeight: Math.round(rectHeight),
    // `client*` is the rounded content box, i.e. border box minus the gutter.
    clientWidth: Math.round(rectWidth) - gutterX,
    clientHeight: Math.round(rectHeight) - gutterY,
  };
}

describe("preview viewport measurement", () => {
  it("floors a fractional box so the canvas can never overflow it", () => {
    // A non-maximised window at 125% display scale: the content box is 699.6px
    // tall but `clientHeight` rounds up to 700. Writing 700 back would overflow
    // by 0.4px, raise a scrollbar and change the next measurement.
    expect(resolvePreviewViewportSize(box(1055.4, 699.6))).toEqual({
      width: 1055,
      height: 699,
    });
  });

  it("subtracts the scrollbar gutter from the measured box", () => {
    expect(
      resolvePreviewViewportSize(box(1000, 700, { x: 15, y: 15 }))
    ).toEqual({ width: 985, height: 685 });
  });

  it("reports nothing for a hidden pane or unusable numbers", () => {
    expect(resolvePreviewViewportSize(box(0, 0))).toEqual({
      width: 0,
      height: 0,
    });
    expect(
      resolvePreviewViewportSize({
        rectWidth: Number.NaN,
        rectHeight: Number.NaN,
        offsetWidth: Number.NaN,
        offsetHeight: Number.NaN,
        clientWidth: Number.NaN,
        clientHeight: Number.NaN,
      })
    ).toEqual({ width: 0, height: 0 });
  });
});

describe("preview layout updates", () => {
  const desktopFit = {
    device: "desktop",
    viewMode: "fit",
  } as const;

  function apply(
    boxes: PreviewViewportBox[],
    options: {
      device?: "desktop" | "mobile";
      viewMode?: "fit" | "actual" | "custom";
      customScale?: number;
    } = {}
  ) {
    let applied: PreviewCanvasLayout | null = null;
    const writes: PreviewCanvasLayout[] = [];
    const skips: string[] = [];

    for (const nextBox of boxes) {
      const update = resolvePreviewLayoutUpdate({
        device: options.device ?? "desktop",
        viewMode: options.viewMode ?? "fit",
        customScale: options.customScale,
        box: nextBox,
        applied,
      });
      if (update.action === "skip") {
        skips.push(update.reason);
        continue;
      }
      applied = update.layout;
      writes.push(update.layout);
    }

    return { applied, writes, skips };
  }

  it("skips a hidden pane instead of collapsing the canvas to zero", () => {
    const update = resolvePreviewLayoutUpdate({
      ...desktopFit,
      box: box(0, 0),
      applied: null,
    });

    expect(update).toEqual({ action: "skip", reason: "hidden" });
  });

  it("keeps the last good geometry while the pane is hidden", () => {
    const { applied, writes, skips } = apply([
      box(1200, 800),
      box(0, 0),
      box(0, 0),
    ]);

    expect(writes).toHaveLength(1);
    expect(skips).toEqual(["hidden", "hidden"]);
    expect(applied?.canvasHeight).toBe(800);
  });

  it("writes once for a repeated measurement", () => {
    const { writes, skips } = apply([
      box(1200, 800),
      box(1200, 800),
      box(1200, 800),
    ]);

    expect(writes).toHaveLength(1);
    expect(skips).toEqual(["unchanged", "unchanged"]);
  });

  it("ignores sub-pixel jitter that rounds to the same geometry", () => {
    const { writes } = apply([
      box(1055.4, 699.6),
      box(1055.49, 699.51),
      box(1055.2, 699.9),
    ]);

    expect(writes).toHaveLength(1);
  });

  it("settles instead of oscillating when a scrollbar appears and goes", () => {
    // The classic feedback loop: a scrollbar steals 15px, the fit ratio
    // changes, the canvas shrinks, the scrollbar goes, and round it goes.
    const withScrollbar = box(1200, 800, { y: 15 });
    const withoutScrollbar = box(1200, 800);

    const { writes } = apply([
      withoutScrollbar,
      withScrollbar,
      withoutScrollbar,
      withScrollbar,
      withScrollbar,
      withScrollbar,
    ]);

    // Each distinct measurement is applied once; a repeat of either is a skip,
    // so the loop cannot run away.
    expect(writes).toHaveLength(4);
    expect(writes[1].canvasHeight).toBe(785);
    expect(writes[2].canvasHeight).toBe(800);
    expect(writes[3].canvasHeight).toBe(785);
  });

  it("never produces a canvas larger than the measured content box in fit mode", () => {
    const measurements = [
      box(1055.4, 699.6),
      box(980.2, 651.7),
      box(1366.9, 900.1),
      box(644.5, 720.3),
      box(1200, 800, { x: 15 }),
    ];

    for (const measurement of measurements) {
      const size = resolvePreviewViewportSize(measurement);
      const update = resolvePreviewLayoutUpdate({
        ...desktopFit,
        box: measurement,
        applied: null,
      });
      if (update.action !== "apply") throw new Error("expected a layout");
      expect(update.layout.canvasWidth).toBeLessThanOrEqual(size.width);
      expect(update.layout.canvasHeight).toBeLessThanOrEqual(size.height);
    }
  });

  it("still magnifies past the viewport for an explicit zoom", () => {
    const update = resolvePreviewLayoutUpdate({
      device: "desktop",
      viewMode: "custom",
      customScale: 2,
      box: box(1200, 800),
      applied: null,
    });

    if (update.action !== "apply") throw new Error("expected a layout");
    expect(update.layout.canvasWidth).toBe(DESKTOP_VIEWPORT_WIDTH * 2);
    expect(update.layout.iframeHeight).toBe(400);
  });

  it("re-applies when only the zoom changed, not the measurement", () => {
    const measurement = box(1200, 800);
    const fitted = resolvePreviewLayoutUpdate({
      ...desktopFit,
      box: measurement,
      applied: null,
    });
    if (fitted.action !== "apply") throw new Error("expected a layout");

    const zoomed = resolvePreviewLayoutUpdate({
      device: "desktop",
      viewMode: "custom",
      customScale: 0.5,
      box: measurement,
      applied: fitted.layout,
    });

    expect(zoomed.action).toBe("apply");
  });

  it("rounds geometry to what the DOM actually receives", () => {
    const rounded = roundPreviewCanvasLayout({
      scale: 0.7723279648609077,
      canvasWidth: 1054.99999999,
      canvasHeight: 699.0000001,
      iframeWidth: 1366,
      iframeHeight: 905.0001,
    });

    expect(rounded).toEqual({
      scale: 0.7723,
      canvasWidth: 1055,
      canvasHeight: 699,
      iframeWidth: 1366,
      iframeHeight: 906,
    });
    expect(isSamePreviewCanvasLayout(rounded, { ...rounded })).toBe(true);
    expect(
      isSamePreviewCanvasLayout(rounded, { ...rounded, canvasHeight: 700 })
    ).toBe(false);
  });
});
