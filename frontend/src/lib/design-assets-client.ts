import { HTTP_BACKEND_URL } from "../config";
import type { DesignSourceAsset } from "../types";
import { readDesignSourceAssets } from "./design-source-assets";

function assetName(path: string): string {
  return path.split("/").pop() ?? path;
}

export async function persistStitchSourceAssets(
  assets: Shot2CodeStitchResult["assets"]
): Promise<{ sourceAssets: DesignSourceAsset[]; warnings: string[] }> {
  const reusableImages = assets
    .filter(
      (asset) =>
        asset.encoding === "base64" &&
        asset.mimeType.startsWith("image/") &&
        asset.kind !== "preview"
    )
    .map((asset) => ({
      name: assetName(asset.path),
      content_base64: asset.content,
      mime_type: asset.mimeType,
      source: "stitch" as const,
      kind: asset.kind,
    }));
  if (reusableImages.length === 0) {
    return { sourceAssets: [], warnings: [] };
  }
  const response = await fetch(`${HTTP_BACKEND_URL}/api/design-assets/persist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assets: reusableImages }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.detail === "string"
        ? payload.detail
        : `Could not persist Stitch assets (HTTP ${response.status}).`
    );
  }
  return {
    sourceAssets: readDesignSourceAssets(payload.sourceAssets),
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter(
          (warning: unknown): warning is string =>
            typeof warning === "string" && warning.trim().length > 0
        )
      : [],
  };
}
