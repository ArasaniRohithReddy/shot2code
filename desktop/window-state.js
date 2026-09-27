"use strict";

const nodeFs = require("fs");
const nodePath = require("path");

/** The same floor `BrowserWindow` is created with. A stored size below it
 *  would be silently grown by Electron anyway, so it is normalised here. */
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;
const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const WINDOW_STATE_FILE_NAME = "window-state.json";
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 400;
const WINDOW_STATE_VERSION = 1;

/** Every key this file is allowed to contain. Window geometry only: no
 *  project, history, settings or credential data ever goes to disk here. */
const WINDOW_STATE_KEYS = Object.freeze([
  "version",
  "width",
  "height",
  "x",
  "y",
  "maximized",
]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultWindowState() {
  return {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    x: null,
    y: null,
    maximized: false,
  };
}

/**
 * Turns whatever is on disk into a usable state, or `null` when it is not
 * geometry at all.
 *
 * A truncated write, a hand edit or a file from another machine must never
 * produce a window that cannot be seen or grabbed, so anything non-numeric is
 * rejected outright and a too-small size is raised to the enforced minimum.
 */
function normalizeWindowState(raw) {
  if (!isRecord(raw)) return null;
  if (!isFiniteNumber(raw.width) || !isFiniteNumber(raw.height)) return null;
  if (raw.width <= 0 || raw.height <= 0) return null;

  const hasPosition = isFiniteNumber(raw.x) && isFiniteNumber(raw.y);

  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(raw.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(raw.height)),
    x: hasPosition ? Math.round(raw.x) : null,
    y: hasPosition ? Math.round(raw.y) : null,
    maximized: raw.maximized === true,
  };
}

function toWorkArea(display) {
  if (!isRecord(display)) return null;
  const area = isRecord(display.workArea) ? display.workArea : display.bounds;
  if (!isRecord(area)) return null;
  if (!isFiniteNumber(area.x) || !isFiniteNumber(area.y)) return null;
  if (!isFiniteNumber(area.width) || !isFiniteNumber(area.height)) return null;
  if (area.width <= 0 || area.height <= 0) return null;
  return {
    x: Math.round(area.x),
    y: Math.round(area.y),
    width: Math.round(area.width),
    height: Math.round(area.height),
  };
}

function intersectionArea(state, area) {
  const overlapX =
    Math.min(state.x + state.width, area.x + area.width) -
    Math.max(state.x, area.x);
  const overlapY =
    Math.min(state.y + state.height, area.y + area.height) -
    Math.max(state.y, area.y);
  if (overlapX <= 0 || overlapY <= 0) return 0;
  return overlapX * overlapY;
}

/**
 * Puts a stored window back onto hardware that still exists.
 *
 * Unplugging a second monitor, or changing the display scale, leaves saved
 * coordinates pointing at nothing; restoring them opens the window off-screen
 * where it cannot be moved back. Anything that no longer overlaps a work area
 * is re-centred on the first display, and the size is capped to what that
 * display can actually show.
 */
function clampWindowStateToDisplays(state, displays) {
  const base = normalizeWindowState(state) ?? defaultWindowState();
  const areas = Array.isArray(displays)
    ? displays.map(toWorkArea).filter(Boolean)
    : [];

  if (areas.length === 0) {
    // No display information: hand the size over and let the OS place it.
    return { ...base, x: null, y: null, recentered: base.x !== null };
  }

  const width = Math.max(
    MIN_WINDOW_WIDTH,
    Math.min(base.width, Math.max(MIN_WINDOW_WIDTH, areas[0].width))
  );
  const height = Math.max(
    MIN_WINDOW_HEIGHT,
    Math.min(base.height, Math.max(MIN_WINDOW_HEIGHT, areas[0].height))
  );

  if (base.x === null || base.y === null) {
    return { width, height, x: null, y: null, maximized: base.maximized, recentered: false };
  }

  const positioned = { ...base, width, height };
  let target = null;
  let bestOverlap = 0;
  for (const area of areas) {
    const overlap = intersectionArea(positioned, area);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      target = area;
    }
  }

  const recentered = target === null;
  const area = target ?? areas[0];
  const cappedWidth = Math.max(
    MIN_WINDOW_WIDTH,
    Math.min(width, Math.max(MIN_WINDOW_WIDTH, area.width))
  );
  const cappedHeight = Math.max(
    MIN_WINDOW_HEIGHT,
    Math.min(height, Math.max(MIN_WINDOW_HEIGHT, area.height))
  );

  if (recentered) {
    return {
      width: cappedWidth,
      height: cappedHeight,
      x: area.x + Math.round((area.width - cappedWidth) / 2),
      y: area.y + Math.round((area.height - cappedHeight) / 2),
      maximized: base.maximized,
      recentered: true,
    };
  }

  const maxX = area.x + Math.max(0, area.width - cappedWidth);
  const maxY = area.y + Math.max(0, area.height - cappedHeight);

  return {
    width: cappedWidth,
    height: cappedHeight,
    x: Math.min(Math.max(base.x, area.x), maxX),
    y: Math.min(Math.max(base.y, area.y), maxY),
    maximized: base.maximized,
    recentered: false,
  };
}

/**
 * Decides whether a sample is worth remembering.
 *
 * Minimising a window reports a zero or off-screen box, and full screen
 * reports the whole display; saving either would restore into a window the
 * user never chose.
 */
function shouldSaveWindowBounds({
  bounds,
  isMinimized = false,
  isFullScreen = false,
} = {}) {
  if (isMinimized === true || isFullScreen === true) return false;
  if (!isRecord(bounds)) return false;
  if (!isFiniteNumber(bounds.x) || !isFiniteNumber(bounds.y)) return false;
  if (!isFiniteNumber(bounds.width) || !isFiniteNumber(bounds.height)) {
    return false;
  }
  return (
    bounds.width >= MIN_WINDOW_WIDTH && bounds.height >= MIN_WINDOW_HEIGHT
  );
}

function toPersistedPayload(state) {
  return {
    version: WINDOW_STATE_VERSION,
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    maximized: state.maximized === true,
  };
}

/**
 * Debounced, atomic store for the native window geometry.
 *
 * All IO is injected so the behaviour can be asserted without Electron, a
 * display server, or a real clock. Nothing in this module requires Electron.
 */
function createWindowStateStore({
  filePath,
  fs = nodeFs,
  debounceMs = WINDOW_STATE_SAVE_DEBOUNCE_MS,
  timers = { setTimeout, clearTimeout },
  log,
} = {}) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new TypeError("A window-state filePath is required");
  }

  let state = defaultWindowState();
  let pending = null;
  let timer = null;

  const report = (message) => {
    if (typeof log === "function") log(message);
  };

  const clearTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  };

  const writeNow = (next) => {
    const payload = toPersistedPayload(next);
    const temporaryPath = `${filePath}.tmp`;
    try {
      fs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
      // Write-then-rename: a crash mid-write leaves the previous good file
      // rather than a truncated one that would be rejected on next start.
      fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(temporaryPath, filePath);
      return true;
    } catch (error) {
      report(`window-state: save failed: ${error.message}`);
      return false;
    }
  };

  const load = (displays) => {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        report(`window-state: unreadable, using defaults (${error.message})`);
      }
      parsed = null;
    }

    const stored = normalizeWindowState(parsed) ?? defaultWindowState();
    const clamped = clampWindowStateToDisplays(stored, displays);
    if (clamped.recentered) {
      report("window-state: saved position is off-screen, re-centring");
    }
    state = {
      width: clamped.width,
      height: clamped.height,
      x: clamped.x,
      y: clamped.y,
      maximized: clamped.maximized,
    };
    return { ...state };
  };

  /** Folds one observation into the next state, or returns `null` when the
   *  sample is transient and must not be remembered. */
  const capture = (sample = {}) => {
    if (!shouldSaveWindowBounds(sample)) return null;
    const { bounds } = sample;
    return {
      width: Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)),
      height: Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height)),
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      maximized: sample.isMaximized === true,
    };
  };

  const scheduleSave = (sample) => {
    const next = capture(sample);
    if (!next) return false;
    state = next;
    pending = next;
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      const queued = pending;
      pending = null;
      if (queued) writeNow(queued);
    }, debounceMs);
    return true;
  };

  const flush = () => {
    clearTimer();
    const queued = pending;
    pending = null;
    if (!queued) return false;
    return writeNow(queued);
  };

  const dispose = () => {
    clearTimer();
    pending = null;
  };

  return {
    load,
    capture,
    scheduleSave,
    flush,
    dispose,
    getState: () => ({ ...state }),
    hasPendingSave: () => pending !== null,
  };
}

module.exports = {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  WINDOW_STATE_FILE_NAME,
  WINDOW_STATE_KEYS,
  WINDOW_STATE_SAVE_DEBOUNCE_MS,
  WINDOW_STATE_VERSION,
  clampWindowStateToDisplays,
  createWindowStateStore,
  defaultWindowState,
  normalizeWindowState,
  shouldSaveWindowBounds,
  toPersistedPayload,
};
