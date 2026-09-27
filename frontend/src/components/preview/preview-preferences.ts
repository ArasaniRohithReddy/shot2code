import {
  clampPreviewZoom,
  type PreviewViewMode,
} from "./preview-layout";

/**
 * Preview workspace preferences that survive a restart.
 *
 * Only inert view state lives here: which tab is open, whether the pane is
 * showing the composed HTML or the stack project, and how the desktop canvas
 * is zoomed. Refresh tokens, the current selection, dialog state, generation
 * status, credentials and anything else transient are deliberately absent —
 * restoring them would either lie about what the app is doing or put a secret
 * in `localStorage`.
 */
export const PREVIEW_TAB_STORAGE_KEY = "workspace-preview-tab";
export const PREVIEW_SOURCE_STORAGE_KEY = "workspace-preview-source";
export const PREVIEW_DESKTOP_VIEW_MODE_STORAGE_KEY =
  "workspace-preview-desktop-view-mode";
export const PREVIEW_DESKTOP_ZOOM_STORAGE_KEY =
  "workspace-preview-desktop-zoom";

/** Every key this module is allowed to own, asserted by its tests. */
export const PREVIEW_PREFERENCE_STORAGE_KEYS = [
  PREVIEW_TAB_STORAGE_KEY,
  PREVIEW_SOURCE_STORAGE_KEY,
  PREVIEW_DESKTOP_VIEW_MODE_STORAGE_KEY,
  PREVIEW_DESKTOP_ZOOM_STORAGE_KEY,
] as const;

export type PreviewTab = "desktop" | "mobile" | "review" | "code";
export type PreviewSource = "html" | "stack";

export const PREVIEW_TABS: readonly PreviewTab[] = [
  "desktop",
  "mobile",
  "review",
  "code",
];
export const PREVIEW_SOURCES: readonly PreviewSource[] = ["html", "stack"];
const PREVIEW_VIEW_MODES: readonly PreviewViewMode[] = [
  "fit",
  "actual",
  "custom",
];

export const DEFAULT_PREVIEW_TAB: PreviewTab = "desktop";
export const DEFAULT_PREVIEW_SOURCE: PreviewSource = "html";
export const DEFAULT_PREVIEW_VIEW_MODE: PreviewViewMode = "fit";
export const DEFAULT_PREVIEW_ZOOM = 1;

/**
 * Stored preferences are normalised on read rather than rewritten on load.
 * A value written by a newer build, a hand edit, or a half-finished write then
 * shows a sane view without silently destroying the preference, which is the
 * same contract the chat pane width already follows.
 */
export function normalizePreviewTab(value: unknown): PreviewTab {
  return PREVIEW_TABS.includes(value as PreviewTab)
    ? (value as PreviewTab)
    : DEFAULT_PREVIEW_TAB;
}

export function normalizePreviewSource(value: unknown): PreviewSource {
  return PREVIEW_SOURCES.includes(value as PreviewSource)
    ? (value as PreviewSource)
    : DEFAULT_PREVIEW_SOURCE;
}

export function normalizePreviewViewMode(value: unknown): PreviewViewMode {
  return PREVIEW_VIEW_MODES.includes(value as PreviewViewMode)
    ? (value as PreviewViewMode)
    : DEFAULT_PREVIEW_VIEW_MODE;
}

/** Clamps into the same safe zoom range the toolbar offers; a string, a null
 *  or a NaN falls back to 100% instead of rendering an invisible canvas. */
export function normalizePreviewZoom(value: unknown): number {
  return typeof value === "number"
    ? clampPreviewZoom(value)
    : DEFAULT_PREVIEW_ZOOM;
}
