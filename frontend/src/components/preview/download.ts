import { HTTP_BACKEND_URL } from "../../config";
import { normalizeBabelCdn } from "../../lib/babelCdn";
import type { ProjectExportState, ProjectFile } from "../../lib/project-files";
import {
  createProjectFile,
  type ProjectFileMap,
} from "../../lib/project-files";

export type CodeDownloadResult =
  | { kind: "server-export"; filename: string }
  | { kind: "preview-fallback"; filename: string }
  | { kind: "project-backup"; filename: string };

export interface ExportPreview {
  entryPoint: string;
  projectKind: string;
  files: ProjectFileMap;
  runtimeFiles: ProjectFileMap;
  assets: Array<{
    path: string;
    size: number;
    mimeType: string;
    contentBase64: string | null;
  }>;
}

export async function loadExportPreview(
  code: string,
  options: {
    stack: string;
    project: ProjectExportState;
    signal?: AbortSignal;
  }
): Promise<ExportPreview> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/export/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      code,
      baseUrl: window.location.href,
      splitFiles: true,
      stack: options.stack,
      project: options.project,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.detail === "string"
        ? payload.detail
        : `Could not prepare export preview (${response.status}).`
    );
  }
  const files: ProjectFileMap = {};
  for (const raw of Array.isArray(payload.files) ? payload.files : []) {
    if (
      raw &&
      typeof raw.path === "string" &&
      typeof raw.content === "string"
    ) {
      const file = createProjectFile(raw.path, raw.content, {
        readonly: true,
        generated: true,
        metadata: { exportPreview: true },
      });
      files[file.path] = file;
    }
  }
  if (Object.keys(files).length === 0) {
    throw new Error("The export preview did not contain any text files.");
  }
  const assets = Array.isArray(payload.assets)
    ? payload.assets.filter(
        (
          asset: unknown
        ): asset is {
          path: string;
          size: number;
          mimeType: string;
          contentBase64: string | null;
        } =>
          Boolean(
            asset &&
              typeof asset === "object" &&
              typeof (asset as { path?: unknown }).path === "string" &&
              typeof (asset as { size?: unknown }).size === "number" &&
              typeof (asset as { mimeType?: unknown }).mimeType === "string" &&
              (typeof (asset as { contentBase64?: unknown }).contentBase64 ===
                "string" ||
                (asset as { contentBase64?: unknown }).contentBase64 === null)
          )
      )
    : [];
  const runtimeFiles: ProjectFileMap = { ...files };
  for (const asset of assets) {
    if (!asset.contentBase64) continue;
    const file = createProjectFile(asset.path, asset.contentBase64, {
      readonly: true,
      generated: true,
      metadata: {
        exportPreview: true,
        binaryAsset: true,
        encoding: "base64",
        mimeType: asset.mimeType,
        byteSize: asset.size,
      },
    });
    runtimeFiles[file.path] = file;
  }
  return {
    entryPoint:
      typeof payload.entryPoint === "string"
        ? payload.entryPoint
        : Object.keys(files)[0],
    projectKind:
      typeof payload.projectKind === "string" ? payload.projectKind : "project",
    files,
    runtimeFiles,
    assets,
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function filenameFromContentDisposition(contentDisposition: string | null) {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "screenshot-to-code-export.zip";
}

export function createProjectBackupJson(project: ProjectExportState): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      entryPoint: project.entryPoint,
      files: project.files.map((file) => ({
        path: file.path,
        content: file.content,
        language: file.language,
        type: file.type,
        readonly: file.readonly ?? false,
        generated: file.generated ?? false,
        metadata: file.metadata,
      })),
    },
    null,
    2
  );
}

export const downloadCode = async (
  code: string,
  options?: {
    splitFiles?: boolean;
    stack?: string;
    project?: ProjectExportState;
  }
): Promise<CodeDownloadResult> => {
  try {
    const response = await fetch(`${HTTP_BACKEND_URL}/api/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        baseUrl: window.location.href,
        splitFiles: options?.splitFiles ?? false,
        stack: options?.stack,
        project: options?.project,
      }),
    });

    if (!response.ok) {
      throw new Error(`Export failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const filename = filenameFromContentDisposition(
      response.headers.get("Content-Disposition")
    );
    downloadBlob(blob, filename);
    return { kind: "server-export", filename };
  } catch (error) {
    if (options?.project) {
      const filename = "shot2code-project.json";
      console.warn("Falling back to a complete project JSON backup", error);
      downloadBlob(
        new Blob([createProjectBackupJson(options.project)], {
          type: "application/json",
        }),
        filename
      );
      return { kind: "project-backup", filename };
    }

    const filename = "index.html";
    console.warn("Falling back to downloading preview HTML", error);
    downloadBlob(
      new Blob([normalizeBabelCdn(code)], { type: "text/html" }),
      filename
    );
    return { kind: "preview-fallback", filename };
  }
};

function getProjectFileMimeType(file: ProjectFile): string {
  switch (file.language) {
    case "html":
      return "text/html";
    case "css":
      return "text/css";
    case "javascript":
    case "jsx":
      return "text/javascript";
    case "typescript":
    case "tsx":
      return "text/typescript";
    case "json":
      return "application/json";
    case "markdown":
      return "text/markdown";
    case "xml":
    case "vue":
      return "application/xml";
    case "yaml":
    case "text":
      return "text/plain";
  }
}

export function getProjectFileDownloadName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized ? normalized.split("/").join("__") : "download.txt";
}

export function downloadProjectFile(file: ProjectFile): string {
  const filename = getProjectFileDownloadName(file.path);
  downloadBlob(
    new Blob([file.content], { type: getProjectFileMimeType(file) }),
    filename
  );
  return filename;
}
