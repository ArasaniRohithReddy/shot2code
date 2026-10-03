const CANONICAL_LOCAL_ASSET_PREFIX = "shot2code-local:/local-assets/";
const LOOPBACK_ASSET_URL =
  /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?\/local-assets\//gi;

function currentBackendBaseUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:7001";
  const injected = (
    window as unknown as {
      __SHOT2CODE_BACKEND__?: { http?: string };
    }
  ).__SHOT2CODE_BACKEND__?.http;
  if (typeof injected === "string" && injected.trim()) {
    return injected.replace(/\/+$/, "");
  }
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "http://127.0.0.1:7001";
}

export function canonicalizeLocalAssetUrls(value: string): string {
  return value.replace(LOOPBACK_ASSET_URL, CANONICAL_LOCAL_ASSET_PREFIX);
}

export function rebaseLocalAssetUrls(
  value: string,
  backendBaseUrl = currentBackendBaseUrl()
): string {
  const base = backendBaseUrl.replace(/\/+$/, "");
  return canonicalizeLocalAssetUrls(value)
    .split(CANONICAL_LOCAL_ASSET_PREFIX)
    .join(`${base}/local-assets/`);
}
