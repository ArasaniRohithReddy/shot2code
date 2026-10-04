import { renderToStaticMarkup } from "react-dom/server";
import IconSearchSettings from "./IconSearchSettings";
import IconSearchResults from "../agent/IconSearchResults";
import {
  DEFAULT_ICON_SEARCH_SETTINGS,
  ICONIFY_ACCESS_NOTE,
  ICONIFY_API_ORIGIN,
  ICONIFY_METADATA_WARNING,
  ICONIFY_TRADEMARK_WARNING,
  ICON_SEARCH_TOOL_NAME,
  MAX_ICONS,
  PERMISSIVE_LICENSES,
  countIconSearchResults,
  describeIconSearchOutcome,
  iconEventTitle,
  isIconSearchUsable,
  normalizeIconSearchSettings,
  readIconSearchItem,
  toIconSearchWirePayload,
} from "../../lib/icon-search";

const OK_ICON = {
  url: "http://127.0.0.1:7001/local-assets/iconify-lucide-home-abc.svg",
  id: "lucide:home",
  icon: "home",
  collection: "Lucide",
  collection_prefix: "lucide",
  author: "Lucide Contributors",
  author_url: "https://github.com/lucide-icons/lucide",
  source_url: "https://api.iconify.design/lucide/home.svg",
  license_spdx: "ISC",
  license_name: "ISC",
  license_url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE",
  retrieved_at: "2026-10-04",
  brand_or_trademark: false,
  status: "ok",
};

const BRAND_ICON = {
  ...OK_ICON,
  id: "simple-icons:github",
  icon: "github",
  collection: "Simple Icons",
  collection_prefix: "simple-icons",
  brand_or_trademark: true,
};

const REMOTE_ICON = {
  ...OK_ICON,
  url: "https://api.iconify.design/lucide/home.svg",
};

describe("Iconify settings state", () => {
  test("is off until the user explicitly enables it", () => {
    expect(DEFAULT_ICON_SEARCH_SETTINGS).toEqual({ enabled: false });
    expect(isIconSearchUsable(DEFAULT_ICON_SEARCH_SETTINGS)).toBe(false);
    expect(isIconSearchUsable({ enabled: true })).toBe(true);
  });

  test("normalizes stored values and sends only the switch", () => {
    expect(normalizeIconSearchSettings(undefined)).toEqual({ enabled: false });
    expect(normalizeIconSearchSettings({ enabled: "yes" })).toEqual({
      enabled: false,
    });
    expect(normalizeIconSearchSettings({ enabled: true })).toEqual({
      enabled: true,
    });
    const payload = toIconSearchWirePayload({ enabled: true });
    expect(payload).toEqual({ enabled: true });
    expect(Object.keys(payload)).toEqual(["enabled"]);
  });

  test("pins one official origin and a conservative licence allowlist", () => {
    expect(ICONIFY_API_ORIGIN).toBe("https://api.iconify.design");
    expect(PERMISSIVE_LICENSES).toContain("MIT");
    expect(PERMISSIVE_LICENSES).toContain("Apache-2.0");
    expect(PERMISSIVE_LICENSES).not.toContain("GPL-3.0");
    expect(PERMISSIVE_LICENSES).not.toContain("CC-BY-SA-4.0");
    expect(PERMISSIVE_LICENSES).not.toContain("CC-BY-NC-4.0");
  });
});

describe("Iconify consent card", () => {
  const html = renderToStaticMarkup(
    <IconSearchSettings settings={{ enabled: false }} onChange={() => {}} />
  );

  test("describes current keyless access without promising permanence", () => {
    expect(html).toContain("currently accepts requests without an account or API key");
    expect(html).toContain("limits and availability");
    expect(html).toContain("can change");
    for (const phrase of ["permanently free", "always free", "free forever", "unlimited"]) {
      expect(html.toLowerCase()).not.toContain(phrase);
      expect(ICONIFY_ACCESS_NOTE.toLowerCase()).not.toContain(phrase);
    }
  });

  test("makes egress, fixed origin and sanitization explicit", () => {
    expect(html).toContain('data-testid="iconify-egress"');
    expect(html).toContain("api.iconify.design");
    expect(html).toContain("without cookies, authorization");
    expect(html).toContain("cannot use a custom host or follow a redirect");
    for (const term of [
      "scripts",
      "event handlers",
      "foreignObject",
      "animation",
      "external href/url references",
    ]) {
      expect(html).toContain(term);
    }
    expect(html).toContain("/local-assets/");
    expect(html).toContain("does not hotlink icons");
    expect(html).toContain("does not add @iconify/react");
  });

  test("states the licence filter, embedded notice and trademark warning", () => {
    expect(html).toContain('data-testid="iconify-licensing"');
    expect(html).toContain("permissive SPDX");
    expect(html).toContain("Copyleft");
    expect(html).toContain("share-alike");
    expect(html).toContain("attribution-only");
    expect(html).toContain("non-commercial");
    expect(html).toContain("retrieval date");
    expect(html).toContain('data-testid="iconify-trademark-warning"');
    expect(html).toContain("does not grant trademark rights");
  });

  test("labels metadata as third party and links official resources", () => {
    expect(html).toContain('data-testid="iconify-metadata-warning"');
    expect(html).toContain("third-party metadata");
    expect(html).toContain("https://iconify.design/docs/api/");
    expect(html).toContain("https://icon-sets.iconify.design/");
    expect(html).toContain(String(MAX_ICONS));
    expect(html).toContain('aria-label="Find and localize Iconify SVG icons"');
  });
});

describe("Iconify activity", () => {
  test("counts only local persisted SVGs", () => {
    expect(countIconSearchResults({ icons: [OK_ICON, REMOTE_ICON], requested: 2 })).toEqual({
      found: 1,
      requested: 2,
    });
    expect(readIconSearchItem(REMOTE_ICON).status).toBe("error");
  });

  test("drops active or credential-bearing provenance links", () => {
    const item = readIconSearchItem({
      ...OK_ICON,
      author_url: "javascript:alert(1)",
      license_url: "https://user:secret@example.com/license",
    });
    expect(item.authorUrl).toBe("");
    expect(item.licenseUrl).toBe("");
  });

  test("uses distinct honest activity copy", () => {
    expect(
      iconEventTitle({
        toolName: ICON_SEARCH_TOOL_NAME,
        status: "running",
        input: { query: "rounded home" },
      })
    ).toBe('Searching icons for "rounded home"');
    expect(
      iconEventTitle({
        toolName: ICON_SEARCH_TOOL_NAME,
        status: "complete",
        output: { icons: [OK_ICON, REMOTE_ICON], requested: 2 },
      })
    ).toBe("Found 1 of 2 icons");
    expect(describeIconSearchOutcome({ found: 0, requested: 4 })).toBe(
      "No icons found"
    );
  });

  test("shows local previews and complete provenance", () => {
    const result = renderToStaticMarkup(
      <IconSearchResults items={[OK_ICON, BRAND_ICON]} rejected={[{ error: "bad" }]} />
    );
    expect(result).toContain(OK_ICON.url);
    expect(result).not.toContain('src="https://api.iconify.design');
    expect(result).toContain("lucide:home");
    expect(result).toContain("Lucide Contributors");
    expect(result).toContain("ISC");
    expect(result).toContain("retrieved 2026-10-04");
    expect(result).toContain('data-testid="icon-brand-warning"');
    expect(result).toContain('data-testid="icon-search-rejected"');
    expect(result).toContain(ICONIFY_METADATA_WARNING.slice(0, 50));
    expect(result).toContain(ICONIFY_TRADEMARK_WARNING.slice(0, 50));
  });
});