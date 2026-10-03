import type { DesignSourceAsset } from "../types";
import type { EditableProjectImport } from "./project-import";
import {
  createProjectFile,
  normalizeProjectState,
  type NormalizedProjectState,
  type ProjectFileMap,
} from "./project-files";
import type { Stack } from "./stacks";

export interface DesignProjectImport {
  name: string;
  files: ProjectFileMap;
  entryPoint: string;
  sourceAssets: DesignSourceAsset[];
}

export type DesignProjectImportHandler = (
  project: DesignProjectImport,
  stack: Stack,
  instruction?: string
) => void;

function assetName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function createStitchDesignProject(
  result: Shot2CodeStitchResult,
  title: string,
  sourceAssets: DesignSourceAsset[]
): DesignProjectImport {
  const sourceAssetByName = new Map(
    sourceAssets.map((asset) => [asset.name, asset])
  );
  const files: ProjectFileMap = {
    "index.html": createProjectFile("index.html", result.html, {
      generated: true,
      metadata: {
        designSource: "stitch",
        stitchProjectId: result.projectId,
        stitchScreenId: result.screenId,
      },
    }),
  };

  for (const asset of result.assets ?? []) {
    const persisted = sourceAssetByName.get(assetName(asset.path));
    files[asset.path] = createProjectFile(asset.path, asset.content, {
      generated: true,
      metadata: {
        encoding: asset.encoding,
        mimeType: asset.mimeType,
        byteSize: asset.size,
        designSource: "stitch",
        sourceAssetName: persisted?.name ?? assetName(asset.path),
        sourceAssetKind: asset.kind,
        sourceAssetUrl: persisted?.url ?? null,
        sourceUrl: asset.sourceUrl,
      },
    });
  }

  if (result.designMd?.trim()) {
    files["DESIGN.md"] = createProjectFile("DESIGN.md", result.designMd.trim(), {
      generated: true,
      metadata: { designSource: "stitch" },
    });
  }

  const warnings = result.warnings ?? [];
  files["STITCH-IMPORT.md"] = createProjectFile(
    "STITCH-IMPORT.md",
    `# Google Stitch import

- Project: \`${result.projectId}\`
- Screen: \`${result.screenId}\`
- Localized files: ${result.assets?.length ?? 0}
- Reusable images: ${sourceAssets.length}

${
  warnings.length > 0
    ? `## Warnings\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "All exposed Stitch files were imported within shot2code's safety limits."
}
`,
    { generated: true, metadata: { designSource: "stitch" } }
  );

  return {
    name: title.trim() || "Google Stitch screen",
    files,
    entryPoint: "index.html",
    sourceAssets,
  };
}

export function createGitHubDesignProject(
  project: EditableProjectImport,
  assets: Shot2CodeDesignAssetFile[],
  sourceAssets: DesignSourceAsset[],
  repositoryUrl: string
): DesignProjectImport {
  const sourceAssetByName = new Map(
    sourceAssets.map((asset) => [asset.name, asset])
  );
  const files: ProjectFileMap = Object.fromEntries(
    project.files.map((file) => [
      file.path,
      createProjectFile(file.path, file.content, {
        metadata: {
          designSource: "github",
          importedLanguage: file.language,
          importedSizeBytes: file.size_bytes,
          repositoryUrl,
        },
      }),
    ])
  );
  for (const asset of assets) {
    const persisted =
      sourceAssetByName.get(asset.path) ??
      sourceAssetByName.get(assetName(asset.path));
    files[asset.path] = createProjectFile(asset.path, asset.content, {
      metadata: {
        encoding: asset.encoding,
        mimeType: asset.mimeType,
        byteSize: asset.size,
        designSource: "github",
        sourceAssetName: persisted?.name ?? assetName(asset.path),
        sourceAssetKind: asset.kind,
        sourceAssetUrl: persisted?.url ?? null,
        sourceUrl: asset.sourceUrl,
        repositoryUrl,
      },
    });
  }
  return {
    name: project.name,
    files,
    entryPoint: project.entry_path ?? "index.html",
    sourceAssets,
  };
}

export function normalizeDesignProject(
  project: DesignProjectImport
): NormalizedProjectState<{ code: string }> {
  return normalizeProjectState({
    code: project.files[project.entryPoint]?.content ?? "",
    files: project.files,
    entryPoint: project.entryPoint,
    activeFilePath: project.entryPoint,
  });
}
