import { HTTP_BACKEND_URL } from "../../config";
import { normalizeBabelCdn } from "../../lib/babelCdn";
import type { ProjectExportState, ProjectFile } from "../../lib/project-files";

export type CodeDownloadResult =
  | { kind: "server-export"; filename: string }
  | { kind: "preview-fallback"; filename: string }
  | { kind: "project-backup"; filename: string };

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
