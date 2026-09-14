"use strict";

const ZOOM_COMMANDS = Object.freeze({
  IN: "in",
  OUT: "out",
  RESET: "reset",
});

const ZOOM_MIN_FACTOR = 0.5;
const ZOOM_MAX_FACTOR = 3;
const ZOOM_STEP_FACTOR = 0.1;
const ZOOM_RESET_FACTOR = 1;
const ZOOM_PERCENT_SCALE = 100;

function getZoomCommand(input, platform = process.platform) {
  if (!input || input.type !== "keyDown" || input.isComposing) {
    return null;
  }

  const hasPrimaryModifier =
    platform === "darwin"
      ? input.meta === true && input.control !== true
      : input.control === true && input.meta !== true;

  // AltGr is exposed as Control+Alt on Windows. Never consume it, otherwise
  // entering layout-specific characters in an editor can unexpectedly zoom.
  if (!hasPrimaryModifier || input.alt === true) {
    return null;
  }

  const key = typeof input.key === "string" ? input.key : "";
  const code = typeof input.code === "string" ? input.code : "";

  if (
    key === "+" ||
    key === "=" ||
    code === "Equal" ||
    code === "NumpadAdd"
  ) {
    return ZOOM_COMMANDS.IN;
  }

  if (
    key === "-" ||
    code === "NumpadSubtract" ||
    (code === "Minus" && input.shift !== true)
  ) {
    return ZOOM_COMMANDS.OUT;
  }

  if (
    key === "0" ||
    (input.shift !== true && (code === "Digit0" || code === "Numpad0"))
  ) {
    return ZOOM_COMMANDS.RESET;
  }

  return null;
}

function normalizeZoomFactor(factor) {
  if (!Number.isFinite(factor) || factor <= 0) {
    return ZOOM_RESET_FACTOR;
  }

  return Math.round(factor * ZOOM_PERCENT_SCALE) / ZOOM_PERCENT_SCALE;
}

function clampZoomFactor(factor) {
  return Math.min(ZOOM_MAX_FACTOR, Math.max(ZOOM_MIN_FACTOR, factor));
}

function getNextZoomFactor(currentFactor, command) {
  if (command === ZOOM_COMMANDS.RESET) {
    return ZOOM_RESET_FACTOR;
  }

  if (command !== ZOOM_COMMANDS.IN && command !== ZOOM_COMMANDS.OUT) {
    throw new RangeError(`Unknown zoom command: ${command}`);
  }

  const currentPercent = Math.round(
    normalizeZoomFactor(currentFactor) * ZOOM_PERCENT_SCALE
  );
  const stepPercent = Math.round(ZOOM_STEP_FACTOR * ZOOM_PERCENT_SCALE);
  const direction = command === ZOOM_COMMANDS.IN ? 1 : -1;
  const nextFactor =
    (currentPercent + direction * stepPercent) / ZOOM_PERCENT_SCALE;

  return clampZoomFactor(nextFactor);
}

function applyZoomCommand(webContents, command) {
  if (
    !webContents ||
    typeof webContents.getZoomFactor !== "function" ||
    typeof webContents.setZoomFactor !== "function"
  ) {
    throw new TypeError("A webContents zoom API is required");
  }

  const previousFactor = normalizeZoomFactor(webContents.getZoomFactor());
  const nextFactor = getNextZoomFactor(previousFactor, command);

  if (nextFactor !== previousFactor) {
    webContents.setZoomFactor(nextFactor);
  }

  const factor = normalizeZoomFactor(webContents.getZoomFactor());
  return {
    command,
    previousFactor,
    factor,
    changed: factor !== previousFactor,
  };
}

function createZoomInputHandler(
  webContents,
  { platform = process.platform, onZoom } = {}
) {
  return (event, input) => {
    const command = getZoomCommand(input, platform);
    if (!command) {
      return false;
    }

    // This also suppresses Electron's default menu/Chromium accelerator, so
    // each physical key press changes zoom exactly once.
    event.preventDefault();
    const result = applyZoomCommand(webContents, command);
    if (typeof onZoom === "function") {
      onZoom(result);
    }
    return true;
  };
}

function installZoomControls(webContents, options) {
  const handler = createZoomInputHandler(webContents, options);
  webContents.on("before-input-event", handler);
  return handler;
}

module.exports = {
  ZOOM_COMMANDS,
  ZOOM_MAX_FACTOR,
  ZOOM_MIN_FACTOR,
  ZOOM_RESET_FACTOR,
  ZOOM_STEP_FACTOR,
  applyZoomCommand,
  createZoomInputHandler,
  getNextZoomFactor,
  getZoomCommand,
  installZoomControls,
};
