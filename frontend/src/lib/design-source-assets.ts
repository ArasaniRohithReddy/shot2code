import type { DesignSourceAsset } from "../types";
import type { ProjectFileMap } from "./project-files";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataText(
  metadata: Record<string, string | number | boolean | null> | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function sourceAssetsFromProjectFiles(
  files: ProjectFileMap
): DesignSourceAsset[] {
  const assets: DesignSourceAsset[] = [];
  const seen = new Set<string>();
  for (const file of Object.values(files)) {
    const url = metadataText(file.metadata, "sourceAssetUrl");
    const source = metadataText(file.metadata, "designSource");
    if (
      !url ||
      (source !== "figma" && source !== "github" && source !== "stitch") ||
      seen.has(url)
    ) {
      continue;
    }
    seen.add(url);
    assets.push({
      name:
        metadataText(file.metadata, "sourceAssetName") ??
        file.path.split("/").pop() ??
        file.path,
      url,
      mimeType:
        metadataText(file.metadata, "mimeType") ?? "application/octet-stream",
      source,
      kind: metadataText(file.metadata, "sourceAssetKind") ?? "imported asset",
    });
  }
  return assets;
}

export function readDesignSourceAssets(value: unknown): DesignSourceAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): DesignSourceAsset | null => {
      if (!isRecord(raw)) return null;
      const { name, url, mimeType, source, kind } = raw;
      if (
        typeof name !== "string" ||
        typeof url !== "string" ||
        typeof mimeType !== "string" ||
        (source !== "figma" && source !== "github" && source !== "stitch") ||
        typeof kind !== "string"
      ) {
        return null;
      }
      return { name, url, mimeType, source, kind };
    })
    .filter((asset): asset is DesignSourceAsset => asset !== null);
}
