import { withDefaults } from "../../hooks/usePersistedState";
import { MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM } from "./preview-layout";
import {
  DEFAULT_PREVIEW_SOURCE,
  DEFAULT_PREVIEW_TAB,
  DEFAULT_PREVIEW_VIEW_MODE,
  DEFAULT_PREVIEW_ZOOM,
  normalizePreviewSource,
  normalizePreviewTab,
  normalizePreviewViewMode,
  normalizePreviewZoom,
  PREVIEW_DESKTOP_VIEW_MODE_STORAGE_KEY,
  PREVIEW_DESKTOP_ZOOM_STORAGE_KEY,
  PREVIEW_PREFERENCE_STORAGE_KEYS,
  PREVIEW_SOURCE_STORAGE_KEY,
  PREVIEW_TAB_STORAGE_KEY,
} from "./preview-preferences";

/** Mirrors what `usePersistedState` does on load: parse, then merge over the
 *  default, then hand the result to the caller. */
function readStored<T>(raw: string | null, defaultValue: T): unknown {
  if (!raw) return defaultValue;
  try {
    return withDefaults(JSON.parse(raw), defaultValue);
  } catch {
    return defaultValue;
  }
}

describe("preview preference keys", () => {
  it("owns exactly the four inert view keys", () => {
    expect([...PREVIEW_PREFERENCE_STORAGE_KEYS]).toEqual([
      "workspace-preview-tab",
      "workspace-preview-source",
      "workspace-preview-desktop-view-mode",
      "workspace-preview-desktop-zoom",
    ]);
  });

  it("does not collide with the settings or project-history keys", () => {
    const reserved = [
      "setting",
      "app-theme",
      "shot2code-active-history-project",
      "workspace-conversation-collapsed",
    ];

    for (const key of PREVIEW_PREFERENCE_STORAGE_KEYS) {
      expect(reserved).not.toContain(key);
    }
  });
});

describe("preview tab persistence", () => {
  it("restores each of the four workspace views", () => {
    for (const tab of ["desktop", "mobile", "review", "code"]) {
      expect(
        normalizePreviewTab(
          readStored(JSON.stringify(tab), DEFAULT_PREVIEW_TAB)
        )
      ).toBe(tab);
    }
  });

  it("falls back to Desktop for a tab this build does not have", () => {
    expect(normalizePreviewTab(readStored('"diff"', DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
    expect(normalizePreviewTab(readStored('"Desktop"', DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
  });

  it("survives corrupt, empty and wrongly typed storage", () => {
    expect(normalizePreviewTab(readStored("{ truncated", DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
    expect(normalizePreviewTab(readStored(null, DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
    expect(normalizePreviewTab(readStored("null", DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
    expect(normalizePreviewTab(readStored("3", DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
    expect(normalizePreviewTab(readStored('["code"]', DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
    expect(normalizePreviewTab(readStored('{"tab":"code"}', DEFAULT_PREVIEW_TAB))).toBe(
      "desktop"
    );
  });
});

describe("preview source persistence", () => {
  it("remembers a stack preview and rejects anything else", () => {
    expect(
      normalizePreviewSource(readStored('"stack"', DEFAULT_PREVIEW_SOURCE))
    ).toBe("stack");
    expect(
      normalizePreviewSource(readStored('"html"', DEFAULT_PREVIEW_SOURCE))
    ).toBe("html");
    expect(
      normalizePreviewSource(readStored('"runtime"', DEFAULT_PREVIEW_SOURCE))
    ).toBe("html");
    expect(normalizePreviewSource(readStored(null, DEFAULT_PREVIEW_SOURCE))).toBe(
      "html"
    );
  });
});

describe("desktop canvas persistence", () => {
  it("restores each view mode and rejects an unknown one", () => {
    for (const mode of ["fit", "actual", "custom"]) {
      expect(
        normalizePreviewViewMode(
          readStored(JSON.stringify(mode), DEFAULT_PREVIEW_VIEW_MODE)
        )
      ).toBe(mode);
    }
    expect(
      normalizePreviewViewMode(readStored('"zoom"', DEFAULT_PREVIEW_VIEW_MODE))
    ).toBe("fit");
    expect(
      normalizePreviewViewMode(readStored("{}", DEFAULT_PREVIEW_VIEW_MODE))
    ).toBe("fit");
  });

  it("clamps a restored zoom into the safe range", () => {
    expect(normalizePreviewZoom(readStored("0.7", DEFAULT_PREVIEW_ZOOM))).toBe(
      0.7
    );
    expect(normalizePreviewZoom(readStored("9", DEFAULT_PREVIEW_ZOOM))).toBe(
      MAX_PREVIEW_ZOOM
    );
    expect(normalizePreviewZoom(readStored("0.01", DEFAULT_PREVIEW_ZOOM))).toBe(
      MIN_PREVIEW_ZOOM
    );
    expect(normalizePreviewZoom(readStored("-3", DEFAULT_PREVIEW_ZOOM))).toBe(
      MIN_PREVIEW_ZOOM
    );
  });

  it("refuses a zoom that is not a number", () => {
    expect(normalizePreviewZoom(readStored('"0.7"', DEFAULT_PREVIEW_ZOOM))).toBe(
      1
    );
    expect(normalizePreviewZoom(readStored("null", DEFAULT_PREVIEW_ZOOM))).toBe(1);
    expect(normalizePreviewZoom(readStored("true", DEFAULT_PREVIEW_ZOOM))).toBe(1);
    expect(normalizePreviewZoom(readStored("not json", DEFAULT_PREVIEW_ZOOM))).toBe(
      1
    );
    expect(normalizePreviewZoom(Number.NaN)).toBe(1);
  });

  it("round-trips a value written by this build", () => {
    const writtenMode = JSON.stringify("custom");
    const writtenZoom = JSON.stringify(1.3);

    expect(
      normalizePreviewViewMode(readStored(writtenMode, DEFAULT_PREVIEW_VIEW_MODE))
    ).toBe("custom");
    expect(normalizePreviewZoom(readStored(writtenZoom, DEFAULT_PREVIEW_ZOOM))).toBe(
      1.3
    );
  });
});

describe("preview preference wiring", () => {
  it("uses the same key names the components import", () => {
    expect(PREVIEW_TAB_STORAGE_KEY).toBe("workspace-preview-tab");
    expect(PREVIEW_SOURCE_STORAGE_KEY).toBe("workspace-preview-source");
    expect(PREVIEW_DESKTOP_VIEW_MODE_STORAGE_KEY).toBe(
      "workspace-preview-desktop-view-mode"
    );
    expect(PREVIEW_DESKTOP_ZOOM_STORAGE_KEY).toBe(
      "workspace-preview-desktop-zoom"
    );
  });
});
