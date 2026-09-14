import {
  CHAT_PANE_MIN_MAIN_WIDTH,
  CHAT_PANE_WIDTH,
  clamp,
  clampChatPaneWidth,
  clampFileExplorerWidth,
  describePaneWidth,
  FILE_EXPLORER_MIN_EDITOR_WIDTH,
  FILE_EXPLORER_WIDTH,
  getChatPaneBounds,
  getFileExplorerBounds,
  PANE_RESIZE_LARGE_STEP,
  PANE_RESIZE_STEP,
  PANE_RESIZER_HIT_WIDTH,
  resizeWidthForKey,
  resolvePaneWidth,
  WORKSPACE_RAIL_WIDTH,
} from "./pane-sizing";

describe("clamp", () => {
  it("keeps a value inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("prefers the minimum when the range is inverted", () => {
    expect(clamp(50, 300, 200)).toBe(300);
  });
});

describe("resolvePaneWidth", () => {
  it("accepts a stored number", () => {
    expect(resolvePaneWidth(412, CHAT_PANE_WIDTH.default)).toBe(412);
  });

  it("accepts a numeric string written by an older build", () => {
    expect(resolvePaneWidth("360", CHAT_PANE_WIDTH.default)).toBe(360);
  });

  it("falls back for anything that is not a usable width", () => {
    for (const stored of [null, undefined, "wide", NaN, 0, -20, {}, []]) {
      expect(resolvePaneWidth(stored, CHAT_PANE_WIDTH.default)).toBe(
        CHAT_PANE_WIDTH.default
      );
    }
  });

  it("rounds fractional widths", () => {
    expect(resolvePaneWidth(320.6, CHAT_PANE_WIDTH.default)).toBe(321);
  });
});

describe("chat pane bounds", () => {
  it("leaves the main area usable at the smallest desktop width", () => {
    const viewport = 1280;
    const { max } = getChatPaneBounds(viewport);
    const mainWidth =
      viewport - WORKSPACE_RAIL_WIDTH - PANE_RESIZER_HIT_WIDTH - max;

    expect(mainWidth).toBeGreaterThanOrEqual(CHAT_PANE_MIN_MAIN_WIDTH);
  });

  it("stops at the design maximum on a wide monitor", () => {
    expect(getChatPaneBounds(2560).max).toBe(CHAT_PANE_WIDTH.max);
  });

  it("never inverts the range on an implausibly narrow viewport", () => {
    const bounds = getChatPaneBounds(700);

    expect(bounds.min).toBe(CHAT_PANE_WIDTH.min);
    expect(bounds.max).toBe(CHAT_PANE_WIDTH.min);
  });

  it("does not constrain when the viewport is unknown", () => {
    expect(getChatPaneBounds(Number.POSITIVE_INFINITY).max).toBe(
      CHAT_PANE_WIDTH.max
    );
  });

  it("clamps a stored width to the current viewport", () => {
    expect(clampChatPaneWidth(1200, 1280)).toBe(getChatPaneBounds(1280).max);
    expect(clampChatPaneWidth(100, 1920)).toBe(CHAT_PANE_WIDTH.min);
    expect(clampChatPaneWidth(400, 1920)).toBe(400);
  });

  it("keeps the default inside the bounds of every supported desktop width", () => {
    for (const viewport of [1280, 1366, 1440, 1920, 2560]) {
      const { min, max } = getChatPaneBounds(viewport);
      expect(CHAT_PANE_WIDTH.default).toBeGreaterThanOrEqual(min);
      expect(CHAT_PANE_WIDTH.default).toBeLessThanOrEqual(max);
    }
  });
});

describe("file explorer bounds", () => {
  it("leaves a readable editor next to the tree", () => {
    const container = 900;
    const { max } = getFileExplorerBounds(container);

    expect(container - max - PANE_RESIZER_HIT_WIDTH).toBeGreaterThanOrEqual(
      FILE_EXPLORER_MIN_EDITOR_WIDTH
    );
  });

  it("stops at the design maximum when there is plenty of room", () => {
    expect(getFileExplorerBounds(1600).max).toBe(FILE_EXPLORER_WIDTH.max);
  });

  it("collapses onto the minimum instead of inverting", () => {
    const bounds = getFileExplorerBounds(420);

    expect(bounds.min).toBe(FILE_EXPLORER_WIDTH.min);
    expect(bounds.max).toBe(FILE_EXPLORER_WIDTH.min);
  });

  it("clamps a stored width to the measured container", () => {
    expect(clampFileExplorerWidth(800, 900)).toBe(
      getFileExplorerBounds(900).max
    );
    expect(clampFileExplorerWidth(10, 1600)).toBe(FILE_EXPLORER_WIDTH.min);
  });

  it("shrinks the tree's ceiling as the chat column grows", () => {
    const wideChat = getFileExplorerBounds(1280 - 620 - WORKSPACE_RAIL_WIDTH);
    const narrowChat = getFileExplorerBounds(1280 - 280 - WORKSPACE_RAIL_WIDTH);

    expect(wideChat.max).toBeLessThan(narrowChat.max);
  });
});

describe("keyboard resizing", () => {
  const options = { width: 320, min: 280, max: 620, defaultWidth: 320 };

  it("moves by one step with the arrow keys", () => {
    expect(resizeWidthForKey("ArrowRight", options)).toBe(
      320 + PANE_RESIZE_STEP
    );
    expect(resizeWidthForKey("ArrowLeft", options)).toBe(320 - PANE_RESIZE_STEP);
  });

  it("moves by a larger step with Shift", () => {
    expect(resizeWidthForKey("ArrowRight", { ...options, shiftKey: true })).toBe(
      320 + PANE_RESIZE_LARGE_STEP
    );
  });

  it("stops at the bounds rather than overshooting", () => {
    expect(resizeWidthForKey("ArrowLeft", { ...options, width: 284 })).toBe(280);
    expect(
      resizeWidthForKey("ArrowRight", {
        ...options,
        width: 610,
        shiftKey: true,
      })
    ).toBe(620);
  });

  it("jumps to the ends with Home and End", () => {
    expect(resizeWidthForKey("Home", options)).toBe(280);
    expect(resizeWidthForKey("End", options)).toBe(620);
  });

  it("restores the default with Enter, inside the current bounds", () => {
    expect(resizeWidthForKey("Enter", { ...options, width: 500 })).toBe(320);
    expect(
      resizeWidthForKey("Enter", {
        ...options,
        width: 400,
        min: 360,
        max: 400,
      })
    ).toBe(360);
  });

  it("leaves other keys to the browser", () => {
    for (const key of ["ArrowUp", "Tab", "a", " ", "Escape"]) {
      expect(resizeWidthForKey(key, options)).toBeNull();
    }
  });
});

describe("describePaneWidth", () => {
  it("reads as a sentence for assistive technology", () => {
    expect(describePaneWidth("Chat panel width", 320.4)).toBe(
      "Chat panel width: 320 pixels"
    );
  });
});
