import type { ProjectContext, ProjectComponentSummary } from "../types";
import { Stack } from "./stacks";
import {
  createProjectFile,
  DEFAULT_PROJECT_ENTRY_POINT,
  normalizeProjectState,
  type NormalizedProjectState,
} from "./project-files";

/**
 * Neutral handoff between import analysis and the multi-file editor.
 * ImportTab keeps this payload in component state only. Consumers receive it
 * through EditableProjectImportHandler and decide how to store project files.
 */
export const PROJECT_IMPORT_SCHEMA_VERSION = 1 as const;
export const MAX_PROJECT_ENTRIES = 5_000;
export const MAX_PROJECT_FILES = 400;
export const MAX_PROJECT_FILE_BYTES = 600_000;
export const MAX_PROJECT_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_PROJECT_ZIP_BYTES = 30 * 1024 * 1024;

export const PROJECT_SOURCE_ACCEPT =
  ".html,.htm,.css,.scss,.less,.js,.jsx,.mjs,.cjs,.ts,.tsx,.mts,.cts,.vue,.json,.md,.yaml,.yml";

const SUPPORTED_EXTENSIONS = new Set(
  PROJECT_SOURCE_ACCEPT.split(",").map((extension) => extension.slice(1))
);
const IGNORED_PARTS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);
const STACK_VALUES = new Set<string>(Object.values(Stack));
const SOURCE_KINDS = new Set<ProjectImportSourceKind>([
  "files",
  "folder",
  "zip",
]);

export type ProjectImportSourceKind = "files" | "folder" | "zip";

export interface EditableProjectSourceFile {
  path: string;
  content: string;
  language: string;
  size_bytes: number;
}

export interface EditableProjectImport {
  schema_version: typeof PROJECT_IMPORT_SCHEMA_VERSION;
  name: string;
  source_kind: ProjectImportSourceKind;
  files: EditableProjectSourceFile[];
  entry_path: string | null;
  detected_stack: Stack | null;
  confidence: number;
  reasons: string[];
  framework_hints: string[];
  ignored_file_count: number;
  warnings: string[];
}

export interface ProjectImportAnalysis {
  context: ProjectContext;
  project: EditableProjectImport;
}

export interface EditableProjectImportSelection {
  project: EditableProjectImport;
  stack: Stack;
}

export type EditableProjectImportHandler = (
  selection: EditableProjectImportSelection
) => void;

export interface SourceStackDetection {
  stack: Stack | null;
  confidence: number;
  reasons: string[];
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

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} is not a finite number.`);
  }
  return value;
}

function requireInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is not a non-negative integer.`);
  }
  return parsed;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} is not a string array.`);
  }
  return [...value];
}

function parseComponent(value: unknown, index: number): ProjectComponentSummary {
  const component = requireRecord(value, `context.components[${index}]`);
  return {
    name: requireString(component.name, `context.components[${index}].name`),
    path: requireString(component.path, `context.components[${index}].path`),
    props: requireStringArray(
      component.props,
      `context.components[${index}].props`
    ),
  };
}

function parseProjectContext(value: unknown): ProjectContext {
  const context = requireRecord(value, "context");
  if (!Array.isArray(context.components)) {
    throw new Error("context.components is not an array.");
  }
  return {
    name: requireString(context.name, "context.name"),
    file_count: requireInteger(context.file_count, "context.file_count"),
    analyzed_file_count: requireInteger(
      context.analyzed_file_count,
      "context.analyzed_file_count"
    ),
    component_count: requireInteger(
      context.component_count,
      "context.component_count"
    ),
    components: context.components.map(parseComponent),
    dependencies: requireStringArray(
      context.dependencies,
      "context.dependencies"
    ),
    tokens: requireStringArray(context.tokens, "context.tokens"),
    framework_hints: requireStringArray(
      context.framework_hints,
      "context.framework_hints"
    ),
    summary: requireString(context.summary, "context.summary"),
  };
}

export function normalizeImportedProjectPath(rawPath: string): string {
  if (!rawPath) throw new Error("Project paths cannot be empty.");
  if (rawPath.includes("\0")) {
    throw new Error(`Project path ${JSON.stringify(rawPath)} contains a NUL byte.`);
  }

  const path = rawPath.replace(/\\/g, "/");
  if (path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`Project path ${JSON.stringify(rawPath)} must be relative.`);
  }
  if (/^[A-Za-z]:/.test(path)) {
    throw new Error(
      `Project path ${JSON.stringify(rawPath)} cannot be drive-qualified.`
    );
  }

  const rawParts = path.split("/");
  if (rawParts.includes("..")) {
    throw new Error(
      `Project path ${JSON.stringify(rawPath)} cannot traverse parent folders.`
    );
  }
  const parts = rawParts.filter((part) => part && part !== ".");
  if (parts.length === 0) {
    throw new Error(`Project path ${JSON.stringify(rawPath)} is invalid.`);
  }
  if (/^[A-Za-z]:/.test(parts[0])) {
    throw new Error(
      `Project path ${JSON.stringify(rawPath)} cannot be drive-qualified.`
    );
  }
  return parts.join("/");
}

export function isIgnoredProjectPath(path: string): boolean {
  return normalizeImportedProjectPath(path)
    .toLowerCase()
    .split("/")
    .some((part) => IGNORED_PARTS.has(part));
}

export function isSupportedProjectPath(path: string): boolean {
  const normalized = normalizeImportedProjectPath(path).toLowerCase();
  const filename = normalized.split("/").pop() ?? normalized;
  const extension = filename.includes(".") ? filename.split(".").pop() : "";
  return Boolean(extension && SUPPORTED_EXTENSIONS.has(extension));
}

function parseEditableFile(
  value: unknown,
  index: number
): EditableProjectSourceFile {
  const file = requireRecord(value, `project.files[${index}]`);
  const path = requireString(file.path, `project.files[${index}].path`);
  const normalizedPath = normalizeImportedProjectPath(path);
  if (path !== normalizedPath || !isSupportedProjectPath(path)) {
    throw new Error(`project.files[${index}].path is not normalized source code.`);
  }
  const content = requireString(
    file.content,
    `project.files[${index}].content`
  );
  const sizeBytes = requireInteger(
    file.size_bytes,
    `project.files[${index}].size_bytes`
  );
  if (sizeBytes > MAX_PROJECT_FILE_BYTES) {
    throw new Error(`project.files[${index}] exceeds the per-file size limit.`);
  }
  if (new TextEncoder().encode(content).byteLength !== sizeBytes) {
    throw new Error(`project.files[${index}].size_bytes does not match content.`);
  }
  return {
    path,
    content,
    language: requireString(
      file.language,
      `project.files[${index}].language`
    ),
    size_bytes: sizeBytes,
  };
}

function parseEditableProject(value: unknown): EditableProjectImport {
  const project = requireRecord(value, "project");
  if (project.schema_version !== PROJECT_IMPORT_SCHEMA_VERSION) {
    throw new Error("Unsupported editable-project schema version.");
  }
  if (!Array.isArray(project.files)) {
    throw new Error("project.files is not an array.");
  }
  if (project.files.length === 0) {
    throw new Error("project.files cannot be empty.");
  }
  if (project.files.length > MAX_PROJECT_FILES) {
    throw new Error("project.files exceeds the supported file-count limit.");
  }
  const sourceKind = requireString(
    project.source_kind,
    "project.source_kind"
  ) as ProjectImportSourceKind;
  if (!SOURCE_KINDS.has(sourceKind)) {
    throw new Error("project.source_kind is not supported.");
  }
  const detectedStackValue = project.detected_stack;
  if (
    detectedStackValue !== null &&
    (typeof detectedStackValue !== "string" ||
      !STACK_VALUES.has(detectedStackValue))
  ) {
    throw new Error("project.detected_stack is not supported.");
  }

  const files = project.files.map(parseEditableFile);
  const totalBytes = files.reduce((total, file) => total + file.size_bytes, 0);
  if (totalBytes > MAX_PROJECT_TOTAL_BYTES) {
    throw new Error("project.files exceeds the aggregate source-size limit.");
  }

  const duplicatePaths = new Set<string>();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (duplicatePaths.has(key)) {
      throw new Error(`project.files contains duplicate path ${file.path}.`);
    }
    duplicatePaths.add(key);
  }

  const entryPathValue = project.entry_path;
  const entryPath =
    entryPathValue === null
      ? null
      : normalizeImportedProjectPath(
          requireString(entryPathValue, "project.entry_path")
        );
  if (entryPath && !files.some((file) => file.path === entryPath)) {
    throw new Error("project.entry_path is not present in project.files.");
  }

  const confidence = requireNumber(project.confidence, "project.confidence");
  if (confidence < 0 || confidence > 1) {
    throw new Error("project.confidence must be between 0 and 1.");
  }

  const ignoredFileCount = requireInteger(
    project.ignored_file_count,
    "project.ignored_file_count"
  );
  if (files.length + ignoredFileCount > MAX_PROJECT_ENTRIES) {
    throw new Error(
      "project.files and project.ignored_file_count exceed the entry limit."
    );
  }

  return {
    schema_version: PROJECT_IMPORT_SCHEMA_VERSION,
    name: requireString(project.name, "project.name"),
    source_kind: sourceKind,
    files,
    entry_path: entryPath,
    detected_stack:
      detectedStackValue === null ? null : (detectedStackValue as Stack),
    confidence,
    reasons: requireStringArray(project.reasons, "project.reasons"),
    framework_hints: requireStringArray(
      project.framework_hints,
      "project.framework_hints"
    ),
    ignored_file_count: ignoredFileCount,
    warnings: requireStringArray(project.warnings, "project.warnings"),
  };
}

export function parseProjectImportAnalysis(value: unknown): ProjectImportAnalysis {
  const response = requireRecord(value, "Project inspection response");
  return {
    context: parseProjectContext(response.context),
    project: parseEditableProject(response.project),
  };
}

function detection(
  stack: Stack,
  confidence: number,
  reason: string
): SourceStackDetection {
  return { stack, confidence, reasons: [reason] };
}

export function detectStackFromSource(
  source: string,
  path = "index.html"
): SourceStackDetection {
  const content = source.toLowerCase();
  const lowerPath = path.toLowerCase();

  if (/@ionic\//.test(content) || /<ion-(?:app|content|page|button)\b/.test(content)) {
    return detection(Stack.IONIC_TAILWIND, 0.98, "Found an Ionic import or element.");
  }
  if (/\bpreact(?:\/compat)?\b/.test(content)) {
    return detection(Stack.PREACT_TAILWIND, 0.97, "Found a Preact import or CDN reference.");
  }
  if (
    lowerPath.endsWith(".vue") ||
    /(?:from\s*["']vue["']|createapp\s*\(|vue\.global|unpkg\.com\/vue|cdn\.jsdelivr\.net\/npm\/vue)/.test(content)
  ) {
    return detection(Stack.VUE_TAILWIND, 0.96, "Found a Vue component or runtime signature.");
  }
  if (
    /(?:from\s*["']react(?:-dom)?["']|reactdom\.createroot|unpkg\.com\/react|cdn\.jsdelivr\.net\/npm\/react)/.test(content) ||
    /\.(?:jsx|tsx)$/.test(lowerPath)
  ) {
    return detection(Stack.REACT_TAILWIND, 0.94, "Found a React or JSX/TSX signature.");
  }
  if (/\bx-(?:data|show|if|for|model|bind|on)(?::|=)|alpinejs/.test(content)) {
    return detection(Stack.ALPINE_TAILWIND, 0.96, "Found an Alpine.js directive or runtime.");
  }
  if (/\bhx-(?:get|post|put|patch|delete|trigger|target|swap)=|htmx\.org/.test(content)) {
    return detection(Stack.HTMX_TAILWIND, 0.96, "Found an htmx attribute or runtime.");
  }
  if (/daisyui/.test(content)) {
    return detection(Stack.TAILWIND_DAISYUI, 0.96, "Found a daisyUI dependency or CDN reference.");
  }
  if (/bootstrap(?:\.min)?\.(?:css|js)|bootstrap\.bundle|data-bs-/.test(content)) {
    return detection(Stack.BOOTSTRAP, 0.95, "Found a Bootstrap asset or data attribute.");
  }
  if (/bulma(?:\.min)?\.css|cdn\.jsdelivr\.net\/npm\/bulma/.test(content)) {
    return detection(Stack.BULMA, 0.95, "Found a Bulma stylesheet reference.");
  }
  if (/@material\/web|<md-(?:filled|outlined|elevated|text|icon|switch|checkbox|radio|slider|tabs?)\b/.test(content)) {
    return detection(Stack.MATERIAL_WEB, 0.95, "Found a Material Web import or element.");
  }
  if (/cdn\.tailwindcss\.com|@tailwind\s|["']tailwindcss["']/.test(content)) {
    return detection(Stack.HTML_TAILWIND, 0.94, "Found a Tailwind CSS runtime or directive.");
  }
  if (/<(?:!doctype|html|head|body|main|div|section|article|header|footer)\b/.test(content)) {
    return detection(Stack.HTML_CSS, 0.8, "Found an HTML document or fragment.");
  }
  return { stack: null, confidence: 0, reasons: [] };
}

export function createProjectStateFromImport(
  project: EditableProjectImport
): NormalizedProjectState<{ code: string }> {
  const files = Object.fromEntries(
    project.files.map((file) => [
      file.path,
      createProjectFile(file.path, file.content, {
        metadata: {
          importedLanguage: file.language,
          importedSizeBytes: file.size_bytes,
        },
      }),
    ])
  );

  return normalizeProjectState({
    code: files[DEFAULT_PROJECT_ENTRY_POINT]?.content ?? "",
    files,
    entryPoint: project.entry_path ?? undefined,
    activeFilePath: project.entry_path ?? undefined,
  });
}

function isProjectMetadata(path: string): boolean {
  const lowerPath = path.toLowerCase();
  const name = lowerPath.split("/").pop() ?? lowerPath;
  return (
    name === "package.json" ||
    name.startsWith("tsconfig") ||
    name.startsWith("jsconfig") ||
    name.includes(".config.") ||
    /^(?:package-lock|pnpm-lock|yarn\.lock)/.test(name) ||
    /\.(?:md|markdown|yaml|yml)$/.test(name)
  );
}

function hasLocalDependencies(file: EditableProjectSourceFile): boolean {
  const localModule =
    /(?:from\s*["']\.{1,2}\/|import\s*\(\s*["']\.{1,2}\/|require\s*\(\s*["']\.{1,2}\/)/i;
  const localAsset =
    /<(?:link|script)\b[^>]+(?:href|src)=["'](?![A-Za-z][A-Za-z0-9+.-]*:|\/\/|\/|#)[^"']+["']/i;
  return localModule.test(file.content) || localAsset.test(file.content);
}

export function getLegacyEditableFile(
  project: EditableProjectImport
): EditableProjectSourceFile | null {
  if (!project.entry_path) return null;
  const entry = project.files.find((file) => file.path === project.entry_path);
  if (!entry || hasLocalDependencies(entry)) return null;

  const meaningfulFiles = project.files.filter(
    (file) => !isProjectMetadata(file.path)
  );
  if (meaningfulFiles.length !== 1 || meaningfulFiles[0].path !== entry.path) {
    return null;
  }

  const extension = entry.path.toLowerCase().split(".").pop() ?? "";
  if (["html", "htm", "jsx", "tsx", "vue"].includes(extension)) return entry;
  if (
    ["js", "mjs", "cjs"].includes(extension) &&
    /(?:=>|return)\s*\(?\s*</.test(entry.content)
  ) {
    return entry;
  }
  return null;
}