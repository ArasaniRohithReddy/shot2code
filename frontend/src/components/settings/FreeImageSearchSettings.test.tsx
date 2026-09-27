/**
 * Free image search in the UI: licence policy, keyless-ness, and honesty.
 *
 * The invariants worth breaking a build over: only obligation-free licences
 * are ever described as available, nothing implies a key or a payment, the
 * feed distinguishes *found* from *generated*, and an item without a local URL
 * can never count as found.
 */

jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://backend.test",
  WS_BACKEND_URL: "ws://backend.test",
}));

import { renderToStaticMarkup } from "react-dom/server";
import FreeImageSearchSettings from "./FreeImageSearchSettings";
import FreeImageResults from "../agent/FreeImageResults";
import { imageEventTitle } from "../agent/image-results";
import {
  ALLOWED_LICENSES,
  DEFAULT_FREE_IMAGE_SEARCH_SETTINGS,
  EGRESS_NOTICE,
  FREE_IMAGE_SEARCH_TOOL_NAME,
  MAX_IMAGES,
  OPENVERSE_SEARCH_ENDPOINT,
  VERIFY_METADATA_WARNING,
  countFreeImages,
  describeFreeImageOutcome,
  isAllowedLicense,
  isFreeImageSearchUsable,
  licenseLabel,
  normalizeFreeImageSearchSettings,
  readFreeImageItem,
  toFreeImageSearchWirePayload,
} from "../../lib/free-image-search";

const OK_ITEM = {
  url: "http://127.0.0.1:7001/local-assets/asset_abc.png",
  title: "Mountain at dawn",
  creator: "Pat Dryburgh",
  source_page: "https://www.flickr.com/photos/7544495@N02/8339296677",
  provider: "flickr",
  license: "cc0",
  license_name: "CC0 1.0 (public domain dedication)",
  license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  status: "ok",
};

const FAILED_ITEM = {
  url: null,
  title: "Unsaved photo",
  creator: "Someone",
  source_page: "https://example.com/photo",
  provider: "example",
  license: "pdm",
  license_url: "https://creativecommons.org/publicdomain/mark/1.0/",
  status: "error",
  error: "the image server answered 404",
};

describe("the licence policy", () => {
  it("allows only obligation-free licences", () => {
    expect([...ALLOWED_LICENSES]).toEqual(["cc0", "pdm"]);
  });

  it("refuses every licence that would follow an exported project", () => {
    for (const code of ["by", "by-sa", "by-nc", "by-nd", "by-nc-sa", "by-nc-nd"]) {
      expect(isAllowedLicense(code)).toBe(false);
    }
  });

  it("accepts the two that carry nothing", () => {
    expect(isAllowedLicense("cc0")).toBe(true);
    expect(isAllowedLicense("PDM")).toBe(true);
    expect(isAllowedLicense(null)).toBe(false);
  });

  it("names licences in words a non-lawyer can act on", () => {
    expect(licenseLabel("cc0").toLowerCase()).toContain("public domain");
    expect(licenseLabel("pdm")).toContain("Public Domain Mark");
  });
});

describe("the settings block", () => {
  it("is off until the user asks for it", () => {
    expect(DEFAULT_FREE_IMAGE_SEARCH_SETTINGS.enabled).toBe(false);
    expect(isFreeImageSearchUsable(DEFAULT_FREE_IMAGE_SEARCH_SETTINGS)).toBe(false);
  });

  it("is usable with no credential at all once enabled", () => {
    expect(isFreeImageSearchUsable({ enabled: true })).toBe(true);
  });

  it("normalizes anything a stored blob might hold", () => {
    expect(normalizeFreeImageSearchSettings(undefined).enabled).toBe(false);
    expect(normalizeFreeImageSearchSettings({ enabled: "yes" }).enabled).toBe(false);
    expect(normalizeFreeImageSearchSettings({ enabled: true }).enabled).toBe(true);
  });

  it("sends a payload that holds nothing but the switch", () => {
    const payload = toFreeImageSearchWirePayload({ enabled: true });
    expect(payload).toEqual({ enabled: true });
    // No key means no secret means nothing to strip from a snapshot.
    expect(Object.keys(payload)).toEqual(["enabled"]);
  });

  it("points at the one fixed endpoint", () => {
    expect(OPENVERSE_SEARCH_ENDPOINT).toBe("https://api.openverse.org/v1/images/");
  });
});

describe("the settings card", () => {
  const render = (overrides: { enabled?: boolean; paid?: boolean } = {}) =>
    renderToStaticMarkup(
      <FreeImageSearchSettings
        settings={{ enabled: overrides.enabled ?? false }}
        onChange={() => {}}
        hasPaidImageProvider={overrides.paid ?? false}
      />
    );

  it("says plainly that shot2code sends no key, and scopes the claim", () => {
    const html = render();
    expect(html).toContain("shot2code sends no API key and no credential");
    // The allowance is Openverse's, attributed, scoped and changeable — the
    // same rule every other provider's copy follows.
    expect(html).toContain('data-testid="free-image-access-note"');
    expect(html).toContain("set by Openverse");
    expect(html).toContain("can change");
    expect(html).not.toContain("free forever");
    expect(html).not.toContain("always free");
    expect(html).not.toContain("unlimited");
  });

  it("scopes the keyless access with its published rate limits", () => {
    const html = render();
    expect(html).toContain("20 requests a minute");
    expect(html).toContain("200 a day");
  });

  it("discloses that the query leaves the machine, and where it goes", () => {
    const html = render();
    expect(html).toContain('data-testid="free-image-egress"');
    expect(html).toContain("api.openverse.org");
    expect(html).toContain("sent to the Openverse API");
  });

  it("states the licence restriction in the card itself", () => {
    const html = render();
    expect(html).toContain('data-testid="free-image-licensing"');
    expect(html).toContain("CC0 1.0");
    expect(html).toContain("Public Domain Mark");
    expect(html).toContain("share-alike");
    expect(html).toContain("non-commercial");
  });

  it("tells the user to verify the metadata before commercial use", () => {
    const html = render();
    expect(html).toContain('data-testid="free-image-verify-warning"');
    expect(html).toContain("commercially");
    expect(html).toContain("confirm the licence");
  });

  it("promises that nothing is hotlinked", () => {
    expect(render()).toContain("never links to somebody else");
  });

  it("links the official Openverse pages", () => {
    const html = render();
    expect(html).toContain("https://openverse.org/terms");
    expect(html).toContain("https://api.openverse.org/v1/");
  });

  it("explains coexistence rather than replacement when a provider exists", () => {
    const html = render({ paid: true });
    expect(html).toContain("alongside your image-generation provider");
    expect(html).not.toContain("instead of it:</");
  });

  it("explains that it is the only option when no provider is configured", () => {
    const html = render({ paid: false });
    expect(html).toContain("No image-generation provider is configured");
  });

  it("states the per-call bounds", () => {
    expect(render()).toContain(String(MAX_IMAGES));
  });

  it("labels its switch", () => {
    expect(render()).toContain('aria-label="Find free public-domain photos"');
  });
});

describe("counting found images", () => {
  it("counts only items that actually have a local URL", () => {
    expect(
      countFreeImages({ images: [OK_ITEM, FAILED_ITEM], requested: 2 })
    ).toEqual({ found: 1, requested: 2 });
  });

  it("returns null when there is nothing to count", () => {
    expect(countFreeImages(null)).toBeNull();
    expect(countFreeImages({ error: "nope" })).toBeNull();
  });

  it("never reads an item with no URL as found", () => {
    expect(readFreeImageItem(FAILED_ITEM).status).toBe("error");
    expect(readFreeImageItem({ url: "x", status: "error" }).status).toBe("error");
    expect(readFreeImageItem(null).status).toBe("error");
  });
});

describe("the activity headline", () => {
  it("says found, not generated", () => {
    const title = imageEventTitle({
      toolName: FREE_IMAGE_SEARCH_TOOL_NAME,
      status: "complete",
      output: { images: [OK_ITEM, OK_ITEM], requested: 2 },
    });
    expect(title).toBe("Found 2 free images");
    expect(title).not.toContain("Generated");
  });

  it("reports a partial batch truthfully", () => {
    expect(
      imageEventTitle({
        toolName: FREE_IMAGE_SEARCH_TOOL_NAME,
        status: "complete",
        output: { images: [OK_ITEM, FAILED_ITEM], requested: 2 },
      })
    ).toBe("Found 1 of 2 free images");
  });

  it("never claims a number when nothing was saved", () => {
    expect(
      imageEventTitle({
        toolName: FREE_IMAGE_SEARCH_TOOL_NAME,
        status: "complete",
        output: { images: [FAILED_ITEM], requested: 1 },
      })
    ).toBe("No free images found");
    expect(describeFreeImageOutcome({ found: 0, requested: 3 })).toBe(
      "No free images found"
    );
  });

  it("shows the query while running", () => {
    expect(
      imageEventTitle({
        toolName: FREE_IMAGE_SEARCH_TOOL_NAME,
        status: "running",
        input: { query: "mountain lake" },
      })
    ).toBe('Searching free images for "mountain lake"');
  });

  it("stays distinct from the generate_images headline", () => {
    const generated = imageEventTitle({
      toolName: "generate_images",
      status: "complete",
      output: { images: [{ url: "https://x/y.png", status: "ok" }] },
    });
    expect(generated).toBe("Generated 1 image");
  });
});

describe("the results panel", () => {
  const render = (items: unknown[], rejected: unknown[] = []) =>
    renderToStaticMarkup(<FreeImageResults items={items} rejected={rejected} />);

  it("shows the thumbnail from the local asset URL, never the origin", () => {
    const html = render([OK_ITEM]);
    expect(html).toContain("http://127.0.0.1:7001/local-assets/asset_abc.png");
    expect(html).not.toContain("live.staticflickr.com");
  });

  it("shows title, creator, licence and source for every item", () => {
    const html = render([OK_ITEM]);
    expect(html).toContain("Mountain at dawn");
    expect(html).toContain("Pat Dryburgh");
    expect(html).toContain("CC0 1.0");
    expect(html).toContain("Source (flickr)");
    expect(html).toContain("creativecommons.org/publicdomain/zero/1.0/");
  });

  it("shows a per-item reason instead of a blank tile", () => {
    const html = render([FAILED_ITEM]);
    expect(html).toContain('data-testid="free-image-failure"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("answered 404");
  });

  it("repeats the verify-before-commercial-use warning with the results", () => {
    expect(render([OK_ITEM])).toContain(
      VERIFY_METADATA_WARNING.slice(0, 40)
    );
  });

  it("omits the warning when nothing was saved", () => {
    expect(render([FAILED_ITEM])).not.toContain(
      'data-testid="free-image-verify-warning"'
    );
  });

  it("accounts for skipped candidates rather than hiding them", () => {
    const html = render([OK_ITEM], [{ error: "blocked" }, { error: "too big" }]);
    expect(html).toContain('data-testid="free-image-rejected"');
    expect(html).toContain("2 other results were skipped");
  });

  it("does not nest a scroll container that would clip the licence line", () => {
    const html = render([OK_ITEM, OK_ITEM, OK_ITEM, OK_ITEM]);
    expect(html).not.toContain("overflow-y-auto");
    expect(html).not.toContain("overflow-y-scroll");
    expect(html).not.toMatch(/max-h-\d/);
  });
});

describe("egress copy is shared, not re-worded per surface", () => {
  it("uses one notice everywhere", () => {
    expect(EGRESS_NOTICE).toContain("api.openverse.org");
    expect(EGRESS_NOTICE).toContain("no charge of its own");
    expect(EGRESS_NOTICE).toContain("no credential");
  });

  it("does not promise permanence anywhere in the copy", () => {
    const blob = `${EGRESS_NOTICE} ${VERIFY_METADATA_WARNING}`.toLowerCase();
    for (const phrase of ["free forever", "always free", "unlimited"]) {
      expect(blob).not.toContain(phrase);
    }
  });
});
