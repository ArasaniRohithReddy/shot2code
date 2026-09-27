/**
 * Free image search, mirrored from `backend/free_images/`.
 *
 * The one image path with no credential at all: Openverse's search API is
 * public and keyless, so this works on a machine with no Replicate, Cloudflare
 * or OpenAI-compatible configuration. It is **additive** - configuring a paid
 * provider does not switch it off - and it is a *separate* tool from
 * `generate_images`, never a silent fallback inside it. One invents a picture,
 * this one finds a real photograph somebody already released.
 *
 * The licence policy is the part that must not drift from the backend:
 * **CC0 and Public Domain Mark only**. Every other Creative Commons licence
 * carries an obligation an exported project would silently inherit -
 * attribution that must follow the image everywhere, share-alike that spreads
 * to the work it is combined with, non-commercial that forbids shipping,
 * no-derivatives that forbids cropping. shot2code cannot enforce those inside
 * someone else's codebase, so it does not offer images that require them.
 */

export const OPENVERSE_SEARCH_ENDPOINT = "https://api.openverse.org/v1/images/";
export const OPENVERSE_HOME_URL = "https://openverse.org/";
export const OPENVERSE_TERMS_URL = "https://openverse.org/terms";
export const OPENVERSE_API_DOCS_URL = "https://api.openverse.org/v1/";

export const FREE_IMAGE_SEARCH_TOOL_NAME = "search_free_images";

/** Licences with nothing to inherit. Kept in step with `ALLOWED_LICENSES`. */
export const ALLOWED_LICENSES = ["cc0", "pdm"] as const;
export type FreeImageLicense = (typeof ALLOWED_LICENSES)[number];

export const LICENSE_LABELS: Record<string, string> = {
  cc0: "CC0 1.0 (public domain dedication)",
  pdm: "Public Domain Mark 1.0",
};

export const MIN_IMAGES = 1;
export const MAX_IMAGES = 4;
export const MAX_SEARCHES_PER_TURN = 3;
export const MAX_SEARCHES_PER_GENERATION = 10;

/** Said in Settings, in the payload and in the activity feed. */
export const VERIFY_METADATA_WARNING =
  "Openverse aggregates licence metadata from other platforms and can be " +
  "wrong. Before using any of these images commercially, open the source " +
  "page and confirm the licence and the creator yourself.";

/**
 * What Openverse's API currently costs and requires, hedged the same way.
 *
 * Verified against the live API: the image search endpoint answers anonymous
 * requests, and its own rate-limit headers advertise 20 requests a minute and
 * 200 a day for an unauthenticated caller. That is Openverse's allowance on
 * Openverse's terms; like every other provider here it is attributed, scoped
 * and marked changeable rather than called "free".
 */
export const OPENVERSE_ACCESS_CHECKED = "2026-09-27";

export const OPENVERSE_ACCESS_NOTE =
  "Openverse's image search currently answers requests without an API key or " +
  `an account (checked ${OPENVERSE_ACCESS_CHECKED}), within the anonymous ` +
  "rate limits it publishes — around 20 requests a minute and 200 a day per " +
  "machine. Those limits, and keyless access itself, are set by Openverse and " +
  "can change.";

export const EGRESS_NOTICE =
  "Your search text is sent to the Openverse API (api.openverse.org), and " +
  "the images you keep are downloaded from the sites Openverse indexes. " +
  "shot2code adds no charge of its own and sends no credential.";

export interface FreeImageSearchSettings {
  /** Off by default: it sends the model's query to a third party. */
  enabled: boolean;
}

export const DEFAULT_FREE_IMAGE_SEARCH_SETTINGS: FreeImageSearchSettings = {
  enabled: false,
};

export function normalizeFreeImageSearchSettings(
  raw: unknown
): FreeImageSearchSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_FREE_IMAGE_SEARCH_SETTINGS };
  }
  const source = raw as Record<string, unknown>;
  return { enabled: source.enabled === true };
}

export function isFreeImageSearchUsable(
  settings: FreeImageSearchSettings
): boolean {
  // There is no credential to check. That is the whole feature.
  return settings.enabled;
}

export function licenseLabel(code: string): string {
  const normalized = (code || "").trim().toLowerCase();
  return LICENSE_LABELS[normalized] ?? (normalized.toUpperCase() || "Unknown");
}

export function isAllowedLicense(code: unknown): boolean {
  return (
    typeof code === "string" &&
    (ALLOWED_LICENSES as readonly string[]).includes(code.trim().toLowerCase())
  );
}

/* -------------------------------------------------------------------------- */
/* Wire payload                                                                */
/* -------------------------------------------------------------------------- */

export interface FreeImageSearchWirePayload {
  enabled: boolean;
}

/**
 * The block a request carries.
 *
 * There is no `includeSecrets` option because there is no secret: the payload
 * is identical whether it is going to the backend or into a history snapshot.
 */
export function toFreeImageSearchWirePayload(
  settings: FreeImageSearchSettings
): FreeImageSearchWirePayload {
  return { enabled: settings.enabled };
}

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export interface FreeImageResultItem {
  url: string | null;
  title: string;
  creator: string;
  sourcePage: string;
  provider: string;
  license: string;
  licenseName: string;
  licenseUrl: string;
  status: "ok" | "error";
  error: string | null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Read one item from a tool result defensively.
 *
 * An item only counts as found when it has a local URL *and* is not marked as
 * an error, so a batch that saved nothing can never read as a success.
 */
export function readFreeImageItem(raw: unknown): FreeImageResultItem {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const url = text(source.url) || null;
  const status = text(source.status);
  const license = text(source.license).toLowerCase();
  return {
    url,
    title: text(source.title, "Untitled"),
    creator: text(source.creator, "Unknown"),
    sourcePage: text(source.source_page),
    provider: text(source.provider, "unknown"),
    license,
    licenseName: text(source.license_name) || licenseLabel(license),
    licenseUrl: text(source.license_url),
    status: url && status !== "error" ? "ok" : "error",
    error: text(source.error) || null,
  };
}

export function countFreeImages(
  output: unknown
): { found: number; requested: number } | null {
  if (!output || typeof output !== "object") return null;
  const source = output as Record<string, unknown>;
  const images = source.images;
  if (!Array.isArray(images)) return null;
  const found = images.filter(
    (item) => readFreeImageItem(item).status === "ok"
  ).length;
  const requested =
    typeof source.requested === "number" && source.requested > 0
      ? source.requested
      : images.length;
  return { found, requested };
}

/**
 * The activity-feed headline.
 *
 * Deliberately says "free images" rather than "images", so a glance at the
 * feed distinguishes a real photograph that was found from one the model
 * invented.
 */
export function describeFreeImageOutcome(counts: {
  found: number;
  requested: number;
}): string {
  const { found, requested } = counts;
  if (found === 0) return "No free images found";
  if (found < requested) return `Found ${found} of ${requested} free images`;
  return `Found ${found} free image${found !== 1 ? "s" : ""}`;
}
