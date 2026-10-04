/**
 * Fixed-origin Iconify search settings and defensive result parsing.
 *
 * The backend remains authoritative for licence filtering and SVG sanitizing.
 * These constants mirror the policy so Settings never promises more than a
 * run can deliver and activity copy only counts locally persisted assets.
 */

export const ICONIFY_API_ORIGIN = "https://api.iconify.design";
export const ICONIFY_DOCS_URL = "https://iconify.design/docs/api/";
export const ICONIFY_ICON_SETS_URL = "https://icon-sets.iconify.design/";
export const ICON_SEARCH_TOOL_NAME = "search_icons";

export const PERMISSIVE_LICENSES = [
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "Unlicense",
  "Zlib",
] as const;

export const MAX_ICONS = 6;
export const MAX_SEARCHES_PER_TURN = 3;
export const MAX_SEARCHES_PER_GENERATION = 10;
export const ICONIFY_ACCESS_CHECKED = "2026-10-04";

export const ICONIFY_ACCESS_NOTE =
  "Iconify's public API currently accepts requests without an account or API " +
  `key (checked ${ICONIFY_ACCESS_CHECKED}). Iconify does not publish a fixed ` +
  "public quota for this service, so its limits and availability are " +
  "controlled by Iconify and can change.";

export const ICONIFY_EGRESS_NOTICE =
  "The icon query is sent only to api.iconify.design. Selected SVGs are " +
  "downloaded from that same fixed origin without cookies, authorization or " +
  "any shot2code credential, sanitized, and saved on this machine.";

export const ICONIFY_METADATA_WARNING =
  "Iconify aggregates icon-set metadata supplied by upstream projects. Treat " +
  "collection names, authors and licence details as third-party metadata and " +
  "verify the linked source before shipping a high-risk or commercial use.";

export const ICONIFY_TRADEMARK_WARNING =
  "Icons can depict company names, products or logos. A permissive copyright " +
  "licence does not grant trademark rights or imply endorsement; verify brand " +
  "guidelines before using a brand icon.";

export interface IconSearchSettings {
  enabled: boolean;
}

export const DEFAULT_ICON_SEARCH_SETTINGS: IconSearchSettings = {
  enabled: false,
};

export function normalizeIconSearchSettings(raw: unknown): IconSearchSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_ICON_SEARCH_SETTINGS };
  }
  return { enabled: (raw as Record<string, unknown>).enabled === true };
}

export function isIconSearchUsable(settings: IconSearchSettings): boolean {
  return settings.enabled;
}

export interface IconSearchWirePayload {
  enabled: boolean;
}

export function toIconSearchWirePayload(
  settings: IconSearchSettings
): IconSearchWirePayload {
  return { enabled: settings.enabled };
}

export interface IconSearchResultItem {
  url: string | null;
  id: string;
  icon: string;
  collection: string;
  collectionPrefix: string;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  licenseSpdx: string;
  licenseName: string;
  licenseUrl: string;
  retrievedAt: string;
  brandOrTrademark: boolean;
  status: "ok" | "error";
  error: string | null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function externalUrl(value: unknown): string {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password
      ? candidate
      : "";
  } catch {
    return "";
  }
}

function localAssetUrl(value: unknown): string | null {
  const candidate = text(value);
  if (candidate.startsWith("/local-assets/")) return candidate;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.pathname.startsWith("/local-assets/") &&
      parsed.hostname !== "api.iconify.design"
    ) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export function readIconSearchItem(raw: unknown): IconSearchResultItem {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const url = localAssetUrl(source.url);
  const status = text(source.status);
  return {
    url,
    id: text(source.id, "unknown:icon"),
    icon: text(source.icon, "icon"),
    collection: text(source.collection, "Unknown collection"),
    collectionPrefix: text(source.collection_prefix),
    author: text(source.author, "Unknown author"),
    authorUrl: externalUrl(source.author_url),
    sourceUrl: externalUrl(source.source_url),
    licenseSpdx: text(source.license_spdx, "Unknown"),
    licenseName: text(source.license_name, "Unknown licence"),
    licenseUrl: externalUrl(source.license_url),
    retrievedAt: text(source.retrieved_at),
    brandOrTrademark: source.brand_or_trademark === true,
    status: url && status !== "error" ? "ok" : "error",
    error: text(source.error) || null,
  };
}

export function countIconSearchResults(
  output: unknown
): { found: number; requested: number } | null {
  if (!output || typeof output !== "object") return null;
  const source = output as Record<string, unknown>;
  if (!Array.isArray(source.icons)) return null;
  const found = source.icons.filter(
    (item) => readIconSearchItem(item).status === "ok"
  ).length;
  const requested =
    typeof source.requested === "number" && source.requested > 0
      ? source.requested
      : source.icons.length;
  return { found, requested };
}

export function describeIconSearchOutcome(counts: {
  found: number;
  requested: number;
}): string {
  if (counts.found === 0) return "No icons found";
  if (counts.found < counts.requested) {
    return `Found ${counts.found} of ${counts.requested} icons`;
  }
  return `Found ${counts.found} icon${counts.found !== 1 ? "s" : ""}`;
}

export interface IconEventShape {
  toolName?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
}

export function iconEventTitle(event: IconEventShape): string | null {
  if (event.toolName !== ICON_SEARCH_TOOL_NAME) return null;
  if (event.status === "running") {
    const input =
      event.input && typeof event.input === "object"
        ? (event.input as Record<string, unknown>)
        : {};
    const query = text(input.query);
    return query ? `Searching icons for "${query}"` : "Searching icons";
  }
  const counts = countIconSearchResults(event.output);
  return counts ? describeIconSearchOutcome(counts) : "Searched icons";
}
