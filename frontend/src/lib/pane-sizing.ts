/**
 * Sizing rules for the resizable workspace panes.
 *
 * Everything here is pure so the constraints can be tested without a DOM: the
 * component layer only translates pointer and key events into calls on these
 * helpers. Widths are CSS pixels.
 */

/** Width of the fixed icon rail on the left of the desktop workspace. */
export const WORKSPACE_RAIL_WIDTH = 64;

/**
 * Pointer target width for a separator.
 *
 * The separator sits in a gutter of exactly this width between two panes, so a
 * comfortable target never overlaps a neighbour: no covered scrollbars, tabs,
 * tree rows, or clicks into the preview iframe. The gutter is plain background
 * at rest - the divider stays the neighbouring pane's hairline border.
 */
export const PANE_RESIZER_HIT_WIDTH = 44;

export interface PaneWidthBounds {
  min: number;
  max: number;
}

export interface PaneWidthPreset extends PaneWidthBounds {
  default: number;
}

/**
 * Chat/History column. The default matches the fixed `xl:w-80` column this
 * replaced, so an upgrade looks identical until the user drags.
 */
export const CHAT_PANE_WIDTH: PaneWidthPreset = {
  default: 320,
  min: 280,
  max: 620,
};

/** The preview/code side is useless below this, so the chat stops growing. */
export const CHAT_PANE_MIN_MAIN_WIDTH = 520;

/** Project file tree in the Code tab. The default matches `md:w-56`. */
export const FILE_EXPLORER_WIDTH: PaneWidthPreset = {
  default: 224,
  min: 176,
  max: 420,
};

/** Keep enough room for a readable line of code next to the tree. */
export const FILE_EXPLORER_MIN_EDITOR_WIDTH = 360;

/** Arrow-key step, and the larger step used while Shift is held. */
export const PANE_RESIZE_STEP = 16;
export const PANE_RESIZE_LARGE_STEP = 64;

/**
 * Where the pane preferences live.
 *
 * They are deliberately their own localStorage keys, outside `setting` and
 * outside anything the project history writes: a drag is a view preference, so
 * it must never reach a commit, a variant, or a saved version, and switching
 * versions must never move a divider.
 */
export const CHAT_PANE_WIDTH_STORAGE_KEY = "workspace-chat-width";
export const FILE_EXPLORER_WIDTH_STORAGE_KEY = "workspace-file-explorer-width";
export const WORKSPACE_PANE_STORAGE_KEYS = [
  CHAT_PANE_WIDTH_STORAGE_KEY,
  FILE_EXPLORER_WIDTH_STORAGE_KEY,
] as const;

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Turn whatever localStorage handed back into a usable width.
 *
 * A preference written by an older build - or by a user editing storage - can
 * be a string, `null`, or `NaN`; none of those may reach a style attribute.
 */
export function resolvePaneWidth(stored: unknown, fallback: number): number {
  const value = typeof stored === "number" ? stored : Number(stored);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

/**
 * Chat bounds for a viewport.
 *
 * The upper bound is whichever is smaller: the design maximum, or the width
 * that still leaves `CHAT_PANE_MIN_MAIN_WIDTH` for the preview. A viewport too
 * narrow for both collapses the range onto the minimum rather than inverting.
 */
export function getChatPaneBounds(viewportWidth: number): PaneWidthBounds {
  const available = Number.isFinite(viewportWidth)
    ? viewportWidth -
      WORKSPACE_RAIL_WIDTH -
      PANE_RESIZER_HIT_WIDTH -
      CHAT_PANE_MIN_MAIN_WIDTH
    : CHAT_PANE_WIDTH.max;
  const max = Math.min(CHAT_PANE_WIDTH.max, Math.floor(available));
  return { min: CHAT_PANE_WIDTH.min, max: Math.max(CHAT_PANE_WIDTH.min, max) };
}

export function clampChatPaneWidth(
  width: number,
  viewportWidth: number
): number {
  const { min, max } = getChatPaneBounds(viewportWidth);
  return clamp(Math.round(width), min, max);
}

/**
 * File-tree bounds for the width the Code tab actually has.
 *
 * `containerWidth` is measured, so it already accounts for the chat column: a
 * narrow chat makes the tree resizable further than a wide one does.
 */
export function getFileExplorerBounds(containerWidth: number): PaneWidthBounds {
  const available = Number.isFinite(containerWidth)
    ? containerWidth -
      FILE_EXPLORER_MIN_EDITOR_WIDTH -
      PANE_RESIZER_HIT_WIDTH
    : FILE_EXPLORER_WIDTH.max;
  const max = Math.min(FILE_EXPLORER_WIDTH.max, Math.floor(available));
  return {
    min: FILE_EXPLORER_WIDTH.min,
    max: Math.max(FILE_EXPLORER_WIDTH.min, max),
  };
}

export function clampFileExplorerWidth(
  width: number,
  containerWidth: number
): number {
  const { min, max } = getFileExplorerBounds(containerWidth);
  return clamp(Math.round(width), min, max);
}

export interface PaneKeyResizeOptions {
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  shiftKey?: boolean;
}

/**
 * Keyboard resizing for a vertical separator whose pane is on the left.
 *
 * Returns `null` when the key is not ours, so the caller knows whether to call
 * `preventDefault`. Left shrinks and Right grows, matching the direction the
 * edge moves; Home/End jump to the ends and Enter restores the default.
 * Escape is deliberately absent: while a drag is in flight it cancels the drag
 * instead of resizing.
 */
export function resizeWidthForKey(
  key: string,
  options: PaneKeyResizeOptions
): number | null {
  const { width, min, max, defaultWidth, shiftKey = false } = options;
  const step = shiftKey ? PANE_RESIZE_LARGE_STEP : PANE_RESIZE_STEP;

  switch (key) {
    case "ArrowLeft":
      return clamp(width - step, min, max);
    case "ArrowRight":
      return clamp(width + step, min, max);
    case "Home":
      return min;
    case "End":
      return max;
    case "Enter":
      return clamp(defaultWidth, min, max);
    default:
      return null;
  }
}

/** Spoken value for the separator, e.g. "Chat panel width: 320 pixels". */
export function describePaneWidth(label: string, width: number): string {
  return `${label}: ${Math.round(width)} pixels`;
}
