import { HTTP_BACKEND_URL } from "../config";
import type { ProjectContext } from "../types";
import {
  MAX_PROJECT_ENTRIES,
  MAX_PROJECT_FILES,
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_TOTAL_BYTES,
  MAX_PROJECT_ZIP_BYTES,
  isIgnoredProjectPath,
  isSupportedProjectPath,
  normalizeImportedProjectPath,
  parseProjectImportAnalysis,
  type ProjectImportAnalysis,
  type ProjectImportSourceKind,
} from "./project-import";

export type ProjectImportProgressPhase =
  | "validating"
  | "reading"
  | "uploading"
  | "analysing"
  | "complete";

export interface ProjectImportProgress {
  phase: ProjectImportProgressPhase;
  percent: number;
  message: string;
}

export interface ProjectSourceFileLike {
  name: string;
  size: number;
  webkitRelativePath?: string;
  text: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

interface PreparedProjectFiles {
  name: string;
  files: Array<{ path: string; content: string }>;
  readableFileCount: number;
}

type ProgressListener = (progress: ProjectImportProgress) => void;

function reportProgress(
  listener: ProgressListener | undefined,
  phase: ProjectImportProgressPhase,
  percent: number,
  message: string
) {
  listener?.({ phase, percent, message });
}

function sourcePath(file: ProjectSourceFileLike): string {
  return file.webkitRelativePath || file.name;
}

function projectName(
  files: ProjectSourceFileLike[],
  normalizedPaths: string[],
  sourceKind: Exclude<ProjectImportSourceKind, "zip">
): string {
  if (sourceKind === "folder") {
    return normalizedPaths[0]?.split("/")[0] || "Imported project";
  }
  if (files.length === 1) {
    return files[0].name.replace(/\.[^.]+$/, "") || "Imported file";
  }
  return "Selected files";
}

function appearsBinary(content: string): boolean {
  if (content.includes("\0")) return true;
  let controls = 0;
  for (const character of content) {
    const code = character.charCodeAt(0);
    if ((code < 32 && character !== "\t" && character !== "\n" && character !== "\r") || code === 127) {
      controls += 1;
    }
  }
  return controls > Math.max(8, Math.floor(content.length / 20));
}

async function readUtf8File(file: ProjectSourceFileLike, path: string) {
  let content: string;
  if (file.arrayBuffer) {
    const bytes = await file.arrayBuffer();
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      const detail = error instanceof Error ? ` (${error.message})` : "";
      throw new Error(`${path} is not valid UTF-8 text.${detail}`);
    }
  } else {
    content = await file.text();
  }

  const sizeBytes = new TextEncoder().encode(content).byteLength;
  if (sizeBytes > MAX_PROJECT_FILE_BYTES) {
    throw new Error(
      `${path} is too large. Source files must be ${MAX_PROJECT_FILE_BYTES.toLocaleString()} bytes or smaller.`
    );
  }
  if (appearsBinary(content)) {
    throw new Error(`${path} appears to contain binary data.`);
  }
  return { content, sizeBytes };
}

export async function prepareProjectFiles(
  files: ProjectSourceFileLike[],
  sourceKind: Exclude<ProjectImportSourceKind, "zip">,
  onProgress?: ProgressListener
): Promise<PreparedProjectFiles> {
  reportProgress(onProgress, "validating", 5, "Checking paths and file sizes...");
  if (files.length > MAX_PROJECT_ENTRIES) {
    throw new Error(`Choose at most ${MAX_PROJECT_ENTRIES.toLocaleString()} entries.`);
  }

  const normalizedPaths: string[] = [];
  const seenPaths = new Set<string>();
  const readable: Array<{
    file: ProjectSourceFileLike;
    path: string;
    payloadIndex: number;
  }> = [];
  const payload = files.map((file, payloadIndex) => {
    const path = normalizeImportedProjectPath(sourcePath(file));
    normalizedPaths.push(path);
    const duplicateKey = path.toLowerCase();
    if (seenPaths.has(duplicateKey)) {
      throw new Error(`The selection contains duplicate path ${path}.`);
    }
    seenPaths.add(duplicateKey);

    if (isIgnoredProjectPath(path) || !isSupportedProjectPath(path)) {
      return { path, content: "" };
    }
    if (file.size > MAX_PROJECT_FILE_BYTES) {
      throw new Error(
        `${path} is too large. Source files must be ${MAX_PROJECT_FILE_BYTES.toLocaleString()} bytes or smaller.`
      );
    }
    readable.push({ file, path, payloadIndex });
    return { path, content: "" };
  });

  if (readable.length > MAX_PROJECT_FILES) {
    throw new Error(`Choose at most ${MAX_PROJECT_FILES} supported source files.`);
  }
  if (readable.length === 0) {
    throw new Error(
      "No supported source files were found. Choose HTML, CSS, JavaScript, TypeScript, Vue, JSON, Markdown or YAML files."
    );
  }

  const declaredBytes = readable.reduce(
    (total, candidate) => total + candidate.file.size,
    0
  );
  if (declaredBytes > MAX_PROJECT_TOTAL_BYTES) {
    throw new Error(
      `Selected source is too large. Choose at most ${
        MAX_PROJECT_TOTAL_BYTES / (1024 * 1024)
      } MiB of supported text files.`
    );
  }

  let actualBytes = 0;
  for (let index = 0; index < readable.length; index += 1) {
    const candidate = readable[index];
    reportProgress(
      onProgress,
      "reading",
      10 + Math.round(((index + 1) / readable.length) * 45),
      `Reading ${index + 1} of ${readable.length} source files...`
    );
    const result = await readUtf8File(candidate.file, candidate.path);
    actualBytes += result.sizeBytes;
    if (actualBytes > MAX_PROJECT_TOTAL_BYTES) {
      throw new Error(
        `Selected source is too large. Choose at most ${
          MAX_PROJECT_TOTAL_BYTES / (1024 * 1024)
        } MiB of supported text files.`
      );
    }
    payload[candidate.payloadIndex].content = result.content;
  }

  return {
    name: projectName(files, normalizedPaths, sourceKind),
    files: payload,
    readableFileCount: readable.length,
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function parseInspectionResponse(
  response: Response
): Promise<ProjectImportAnalysis> {
  const body = await responseBody(response);
  if (!response.ok) {
    const detail =
      body &&
      typeof body === "object" &&
      "detail" in body &&
      typeof body.detail === "string"
        ? body.detail
        : `Project analysis failed (${response.status})`;
    throw new Error(detail);
  }
  try {
    return parseProjectImportAnalysis(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid response";
    throw new Error(`Project analysis returned an invalid response: ${detail}`);
  }
}

export async function inspectProjectFiles(
  files: File[],
  sourceKind: Exclude<ProjectImportSourceKind, "zip"> = "files",
  onProgress?: ProgressListener
): Promise<ProjectImportAnalysis> {
  const prepared = await prepareProjectFiles(files, sourceKind, onProgress);
  reportProgress(
    onProgress,
    "uploading",
    65,
    `Sending ${prepared.readableFileCount} source files for safe analysis...`
  );
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/project-context/inspect-files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: prepared.name,
        source_kind: sourceKind,
        files: prepared.files,
      }),
    }
  );
  reportProgress(onProgress, "analysing", 88, "Detecting project structure and stack...");
  const analysis = await parseInspectionResponse(response);
  reportProgress(onProgress, "complete", 100, "Project analysis complete.");
  return analysis;
}

export async function inspectProjectZip(
  file: File,
  onProgress?: ProgressListener
): Promise<ProjectImportAnalysis> {
  reportProgress(onProgress, "validating", 10, "Checking ZIP size and format...");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("Choose a .zip file.");
  }
  if (file.size > MAX_PROJECT_ZIP_BYTES) {
    throw new Error(
      `ZIP is too large. Choose an archive under ${
        MAX_PROJECT_ZIP_BYTES / (1024 * 1024)
      } MiB.`
    );
  }

  reportProgress(onProgress, "uploading", 45, "Sending ZIP for safe inspection...");
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/project-context/inspect-zip`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Project-Name": encodeURIComponent(file.name.replace(/\.zip$/i, "")),
      },
      body: file,
    }
  );
  reportProgress(onProgress, "analysing", 85, "Validating paths and detecting the stack...");
  const analysis = await parseInspectionResponse(response);
  reportProgress(onProgress, "complete", 100, "Project analysis complete.");
  return analysis;
}

export async function scanProjectFiles(files: File[]): Promise<ProjectContext> {
  return (await inspectProjectFiles(files)).context;
}

export async function scanProjectZip(file: File): Promise<ProjectContext> {
  return (await inspectProjectZip(file)).context;
}