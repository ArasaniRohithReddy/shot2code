import { HTTP_BACKEND_URL } from "../config";
import type { ProjectContext } from "../types";
import {
  normalizeImportedProjectPath,
  parseProjectContext,
} from "./project-import";

export const MAX_STORYBOOK_ARCHIVE_BYTES = 30 * 1024 * 1024;
export const MAX_STORYBOOK_SELECTED_ENTRIES = 5_000;
export const MAX_STORYBOOK_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_STORYBOOK_TOTAL_BYTES = 5 * 1024 * 1024;
export const MAX_STORYBOOK_URL_CHARS = 2_048;
export const STORYBOOK_JSON_ACCEPT = ".json,application/json";
export const STORYBOOK_ZIP_ACCEPT = ".zip,application/zip";

const CANONICAL_METADATA_PATHS = [
  "index.json",
  "manifests/components.json",
  "manifests/docs.json",
] as const;
const SOURCE_KINDS = new Set<StorybookImportSourceKind>([
  "files",
  "folder",
  "zip",
  "url",
]);

export type StorybookImportSourceKind = "files" | "folder" | "zip" | "url";
export type StorybookLocalSourceKind = Exclude<
  StorybookImportSourceKind,
  "zip" | "url"
>;
export type StorybookImportProgressPhase =
  | "validating"
  | "reading"
  | "uploading"
  | "analysing"
  | "complete";

export interface StorybookImportProgress {
  phase: StorybookImportProgressPhase;
  percent: number;
  message: string;
}

export interface StorybookImportAnalysis {
  context: ProjectContext;
  source_kind: StorybookImportSourceKind;
  metadata_files: string[];
  story_count: number;
  docs_count: number;
  warnings: string[];
}

export interface StorybookSourceFileLike {
  name: string;
  size: number;
  webkitRelativePath?: string;
  text: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

interface PreparedStorybookFiles {
  name: string;
  files: Array<{ path: string; content: string }>;
  metadataFileCount: number;
}

type ProgressListener = (progress: StorybookImportProgress) => void;

function reportProgress(
  listener: ProgressListener | undefined,
  phase: StorybookImportProgressPhase,
  percent: number,
  message: string
) {
  listener?.({ phase, percent, message });
}

function sourcePath(file: StorybookSourceFileLike): string {
  return file.webkitRelativePath || file.name;
}

function metadataRoot(paths: string[]): string {
  const candidates = paths.flatMap((path) => {
    const parts = path.split("/");
    if (parts.length === 1 && parts[0].toLowerCase() === "index.json") {
      return [""];
    }
    if (parts.length === 2 && parts[1].toLowerCase() === "index.json") {
      return [`${parts[0]}/`];
    }
    return [];
  });
  const unique = [...new Set(candidates.map((candidate) => candidate.toLowerCase()))];
  if (unique.length === 0) {
    throw new Error("The selected folder does not contain one root index.json.");
  }
  if (unique.length > 1) {
    throw new Error("The selected folder contains multiple possible Storybook roots.");
  }
  return candidates[0];
}

function canonicalMapping(
  paths: string[],
  sourceKind: StorybookLocalSourceKind
): Map<string, (typeof CANONICAL_METADATA_PATHS)[number]> {
  if (sourceKind === "folder") {
    const root = metadataRoot(paths);
    const expected = new Map(
      CANONICAL_METADATA_PATHS.map((canonical) => [
        `${root}${canonical}`.toLowerCase(),
        canonical,
      ])
    );
    return new Map(
      paths.flatMap((path) => {
        const canonical = expected.get(path.toLowerCase());
        return canonical ? [[path.toLowerCase(), canonical] as const] : [];
      })
    );
  }

  const directNames = new Map<string, (typeof CANONICAL_METADATA_PATHS)[number]>([
    ["index.json", "index.json"],
    ["components.json", "manifests/components.json"],
    ["docs.json", "manifests/docs.json"],
    ["manifests/components.json", "manifests/components.json"],
    ["manifests/docs.json", "manifests/docs.json"],
  ]);
  return new Map(
    paths.flatMap((path) => {
      const canonical = directNames.get(path.toLowerCase());
      return canonical ? [[path.toLowerCase(), canonical] as const] : [];
    })
  );
}

function appearsBinary(content: string): boolean {
  if (content.includes("\0")) return true;
  let controls = 0;
  for (const character of content) {
    const code = character.charCodeAt(0);
    if (
      (code < 32 && character !== "\t" && character !== "\n" && character !== "\r") ||
      code === 127
    ) {
      controls += 1;
    }
  }
  return controls > Math.max(8, Math.floor(content.length / 20));
}

async function readUtf8Json(file: StorybookSourceFileLike, path: string) {
  let content: string;
  if (file.arrayBuffer) {
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer()
      );
    } catch {
      throw new Error(`${path} is not valid UTF-8 JSON text.`);
    }
  } else {
    content = await file.text();
  }
  const sizeBytes = new TextEncoder().encode(content).byteLength;
  if (sizeBytes > MAX_STORYBOOK_FILE_BYTES) {
    throw new Error(
      `${path} is too large. Storybook metadata files must be ${MAX_STORYBOOK_FILE_BYTES.toLocaleString()} bytes or smaller.`
    );
  }
  if (appearsBinary(content)) {
    throw new Error(`${path} appears to contain binary data.`);
  }
  return { content, sizeBytes };
}

export async function prepareStorybookMetadataFiles(
  files: StorybookSourceFileLike[],
  sourceKind: StorybookLocalSourceKind,
  onProgress?: ProgressListener
): Promise<PreparedStorybookFiles> {
  reportProgress(onProgress, "validating", 5, "Checking Storybook paths and limits...");
  if (files.length > MAX_STORYBOOK_SELECTED_ENTRIES) {
    throw new Error(
      `Choose at most ${MAX_STORYBOOK_SELECTED_ENTRIES.toLocaleString()} entries.`
    );
  }
  const normalizedPaths: string[] = [];
  const seenPaths = new Set<string>();
  const payload = files.map((file) => {
    const path = normalizeImportedProjectPath(sourcePath(file));
    const key = path.toLowerCase();
    if (seenPaths.has(key)) {
      throw new Error(`The selection contains duplicate path ${path}.`);
    }
    seenPaths.add(key);
    normalizedPaths.push(path);
    return { path, content: "" };
  });
  const mapping = canonicalMapping(normalizedPaths, sourceKind);
  const readable = files.flatMap((file, index) => {
    const path = normalizedPaths[index];
    const canonical = mapping.get(path.toLowerCase());
    return canonical ? [{ file, path, canonical, payloadIndex: index }] : [];
  });
  if (!readable.some((candidate) => candidate.canonical === "index.json")) {
    throw new Error("Built Storybook metadata requires index.json.");
  }
  const canonicalNames = new Set<string>();
  for (const candidate of readable) {
    if (canonicalNames.has(candidate.canonical)) {
      throw new Error(`Multiple files map to ${candidate.canonical}.`);
    }
    canonicalNames.add(candidate.canonical);
    if (candidate.file.size > MAX_STORYBOOK_FILE_BYTES) {
      throw new Error(
        `${candidate.canonical} is too large. Storybook metadata files must be ${MAX_STORYBOOK_FILE_BYTES.toLocaleString()} bytes or smaller.`
      );
    }
  }
  const declaredBytes = readable.reduce(
    (total, candidate) => total + candidate.file.size,
    0
  );
  if (declaredBytes > MAX_STORYBOOK_TOTAL_BYTES) {
    throw new Error(
      `Storybook metadata is too large. Choose at most ${MAX_STORYBOOK_TOTAL_BYTES.toLocaleString()} bytes of JSON.`
    );
  }

  let actualBytes = 0;
  for (let index = 0; index < readable.length; index += 1) {
    const candidate = readable[index];
    reportProgress(
      onProgress,
      "reading",
      10 + Math.round(((index + 1) / readable.length) * 50),
      `Reading ${candidate.canonical}...`
    );
    const result = await readUtf8Json(candidate.file, candidate.canonical);
    actualBytes += result.sizeBytes;
    if (actualBytes > MAX_STORYBOOK_TOTAL_BYTES) {
      throw new Error(
        `Storybook metadata is too large. Choose at most ${MAX_STORYBOOK_TOTAL_BYTES.toLocaleString()} bytes of decoded JSON.`
      );
    }
    payload[candidate.payloadIndex].content = result.content;
  }

  const root = sourceKind === "folder" ? metadataRoot(normalizedPaths).replace(/\/$/, "") : "";
  return {
    name: root || "Built Storybook",
    files: payload,
    metadataFileCount: readable.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is not a string.`);
  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} is not a non-negative integer.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} is not a string array.`);
  }
  return [...value];
}

export function parseStorybookImportAnalysis(
  value: unknown
): StorybookImportAnalysis {
  const response = requireRecord(value, "Storybook inspection response");
  const sourceKind = requireString(
    response.source_kind,
    "source_kind"
  ) as StorybookImportSourceKind;
  if (!SOURCE_KINDS.has(sourceKind)) {
    throw new Error("source_kind is not supported.");
  }
  const metadataFiles = requireStringArray(
    response.metadata_files,
    "metadata_files"
  );
  if (
    metadataFiles.length === 0 ||
    metadataFiles.length > CANONICAL_METADATA_PATHS.length ||
    new Set(metadataFiles).size !== metadataFiles.length ||
    metadataFiles.some(
      (path) =>
        !CANONICAL_METADATA_PATHS.includes(
          path as (typeof CANONICAL_METADATA_PATHS)[number]
        )
    )
  ) {
    throw new Error("metadata_files contains unsupported paths.");
  }
  if (!metadataFiles.includes("index.json")) {
    throw new Error("metadata_files must include index.json.");
  }
  return {
    context: parseProjectContext(response.context),
    source_kind: sourceKind,
    metadata_files: metadataFiles,
    story_count: requireInteger(response.story_count, "story_count"),
    docs_count: requireInteger(response.docs_count, "docs_count"),
    warnings: requireStringArray(response.warnings, "warnings"),
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
): Promise<StorybookImportAnalysis> {
  const body = await responseBody(response);
  if (!response.ok) {
    const detail =
      isRecord(body) && typeof body.detail === "string"
        ? body.detail
        : `Built Storybook inspection failed (${response.status})`;
    throw new Error(detail);
  }
  try {
    return parseStorybookImportAnalysis(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid response";
    throw new Error(
      `Built Storybook inspection returned an invalid response: ${detail}`
    );
  }
}

export async function inspectStorybookFiles(
  files: File[],
  sourceKind: StorybookLocalSourceKind,
  onProgress?: ProgressListener
): Promise<StorybookImportAnalysis> {
  const prepared = await prepareStorybookMetadataFiles(
    files,
    sourceKind,
    onProgress
  );
  reportProgress(
    onProgress,
    "uploading",
    70,
    `Sending ${prepared.metadataFileCount} JSON metadata files for safe analysis...`
  );
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/storybook-context/inspect-files`,
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
  reportProgress(
    onProgress,
    "analysing",
    90,
    "Normalizing allowlisted component metadata..."
  );
  const analysis = await parseInspectionResponse(response);
  reportProgress(onProgress, "complete", 100, "Built Storybook analysis complete.");
  return analysis;
}

export async function inspectStorybookZip(
  file: File,
  onProgress?: ProgressListener
): Promise<StorybookImportAnalysis> {
  reportProgress(onProgress, "validating", 10, "Checking ZIP size and format...");
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("Choose a .zip file.");
  }
  if (file.size > MAX_STORYBOOK_ARCHIVE_BYTES) {
    throw new Error(
      `ZIP is too large. Choose an archive under ${
        MAX_STORYBOOK_ARCHIVE_BYTES / (1024 * 1024)
      } MiB.`
    );
  }
  reportProgress(
    onProgress,
    "uploading",
    50,
    "Sending ZIP for metadata-only inspection..."
  );
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/storybook-context/inspect-zip`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Storybook-Name": encodeURIComponent(file.name.replace(/\.zip$/i, "")),
      },
      body: file,
    }
  );
  reportProgress(
    onProgress,
    "analysing",
    88,
    "Validating archive paths and Storybook schemas..."
  );
  const analysis = await parseInspectionResponse(response);
  reportProgress(onProgress, "complete", 100, "Built Storybook analysis complete.");
  return analysis;
}

export function normalizePublicStorybookUrl(rawUrl: string): string {
  const candidate = rawUrl.trim();
  if (!candidate || candidate.length > MAX_STORYBOOK_URL_CHARS) {
    throw new Error(
      `Enter a public HTTPS Storybook URL under ${MAX_STORYBOOK_URL_CHARS.toLocaleString()} characters.`
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid public HTTPS Storybook URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Built Storybook URL import accepts public HTTPS only.");
  }
  if (parsed.username || parsed.password || parsed.search) {
    throw new Error("Storybook URLs cannot contain credentials or query strings.");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new Error("Storybook URLs must use the standard HTTPS port.");
  }
  const lowerPath = parsed.pathname.toLowerCase().replace(/\/$/, "");
  if (
    lowerPath.endsWith("/index.json") ||
    lowerPath.endsWith("/iframe.html") ||
    lowerPath.endsWith("/manifests/components.json") ||
    lowerPath.endsWith("/manifests/docs.json")
  ) {
    throw new Error("Enter the built Storybook root URL, not a metadata or iframe URL.");
  }
  parsed.hash = "";
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/`;
  return parsed.toString();
}

export async function inspectStorybookUrl(
  rawUrl: string,
  onProgress?: ProgressListener
): Promise<StorybookImportAnalysis> {
  const url = normalizePublicStorybookUrl(rawUrl);
  reportProgress(
    onProgress,
    "uploading",
    35,
    "Requesting fixed public Storybook JSON paths..."
  );
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/storybook-context/inspect-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }
  );
  reportProgress(
    onProgress,
    "analysing",
    82,
    "Validating bounded JSON responses..."
  );
  const analysis = await parseInspectionResponse(response);
  reportProgress(onProgress, "complete", 100, "Built Storybook analysis complete.");
  return analysis;
}
