export const DEFAULT_PROJECT_ENTRY_POINT = "index.html";

export type ProjectFileLanguage =
  | "html"
  | "css"
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "json"
  | "markdown"
  | "vue"
  | "xml"
  | "yaml"
  | "text";

export type ProjectFileType =
  | "markup"
  | "style"
  | "script"
  | "data"
  | "documentation"
  | "component"
  | "text";

export type ProjectFileMetadata = Record<
  string,
  string | number | boolean | null
>;

export interface ProjectFile {
  path: string;
  content: string;
  language: ProjectFileLanguage;
  type: ProjectFileType;
  readonly?: boolean;
  generated?: boolean;
  metadata?: ProjectFileMetadata;
}

export type ProjectFileMap = Record<string, ProjectFile>;

export interface ProjectStateLike {
  code: string;
  files?: ProjectFileMap;
  entryPoint?: string;
  activeFilePath?: string;
  generationTargetPath?: string;
}

export type NormalizedProjectState<T extends ProjectStateLike> = T & {
  files: ProjectFileMap;
  entryPoint: string;
  activeFilePath: string;
};

export type ProjectTreeNode =
  | {
      type: "folder";
      name: string;
      path: string;
      children: ProjectTreeNode[];
    }
  | {
      type: "file";
      name: string;
      path: string;
      file: ProjectFile;
    };

export interface ProjectExportState {
  entryPoint: string;
  files: ProjectFile[];
}

export type ProjectPreviewArtifactKind =
  | "html-entry"
  | "html-fallback"
  | "source-fallback";

export type ProjectPreviewDiagnosticCode =
  | "missing-local-file"
  | "unsupported-local-asset"
  | "unsupported-local-script"
  | "cyclic-css-import";

export interface ProjectPreviewDiagnostic {
  code: ProjectPreviewDiagnosticCode;
  path: string;
  referencedFrom: string;
  message: string;
}

export interface ProjectPreviewArtifact {
  html: string;
  sourcePath: string | null;
  projectEntryPoint: string;
  kind: ProjectPreviewArtifactKind;
  inlinedFilePaths: string[];
  resolvedAssetPaths: string[];
  omittedFilePaths: string[];
  diagnostics: ProjectPreviewDiagnostic[];
  supportsSelectAndEdit: boolean;
}

const LANGUAGE_BY_EXTENSION: Record<string, ProjectFileLanguage> = {
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  vue: "vue",
  svg: "xml",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
};

export function normalizeProjectPath(path: string): string {
  const parts = path
    .trim()
    .replace(/^[A-Za-z]:/, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/");
  const normalized: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }

  return normalized.join("/");
}

export function detectProjectFileLanguage(
  path: string
): ProjectFileLanguage {
  const normalizedPath = normalizeProjectPath(path).toLowerCase();
  const filename = normalizedPath.split("/").pop() ?? normalizedPath;

  if (filename === "dockerfile") return "text";
  const extension = filename.includes(".") ? filename.split(".").pop() : "";
  return (extension && LANGUAGE_BY_EXTENSION[extension]) || "text";
}

export function getProjectFileType(
  language: ProjectFileLanguage
): ProjectFileType {
  switch (language) {
    case "html":
    case "xml":
      return "markup";
    case "css":
      return "style";
    case "javascript":
    case "jsx":
    case "typescript":
    case "tsx":
      return "script";
    case "json":
    case "yaml":
      return "data";
    case "markdown":
      return "documentation";
    case "vue":
      return "component";
    case "text":
      return "text";
  }
}

export function createProjectFile(
  path: string,
  content: string,
  options: Partial<
    Pick<
      ProjectFile,
      "language" | "type" | "readonly" | "generated" | "metadata"
    >
  > = {}
): ProjectFile {
  const normalizedPath =
    normalizeProjectPath(path) || DEFAULT_PROJECT_ENTRY_POINT;
  const language =
    options.language ?? detectProjectFileLanguage(normalizedPath);

  return {
    path: normalizedPath,
    content,
    language,
    type: options.type ?? getProjectFileType(language),
    ...(options.readonly === undefined
      ? {}
      : { readonly: options.readonly }),
    ...(options.generated === undefined
      ? {}
      : { generated: options.generated }),
    ...(options.metadata === undefined
      ? {}
      : { metadata: options.metadata }),
  };
}

export function resolveProjectFilePath(
  files: ProjectFileMap,
  requestedPath: string | undefined
): string | undefined {
  if (!requestedPath) return undefined;
  const normalizedPath = normalizeProjectPath(requestedPath);
  if (files[normalizedPath]) return normalizedPath;
  const lowerPath = normalizedPath.toLowerCase();
  return Object.keys(files).find((path) => path.toLowerCase() === lowerPath);
}

export function normalizeProjectFileMap(
  files: ProjectFileMap | undefined
): ProjectFileMap {
  const normalizedFiles: ProjectFileMap = {};

  for (const [mapPath, file] of Object.entries(files ?? {})) {
    const path =
      normalizeProjectPath(file.path || mapPath) ||
      normalizeProjectPath(mapPath) ||
      DEFAULT_PROJECT_ENTRY_POINT;
    normalizedFiles[path] = createProjectFile(path, file.content, file);
  }

  return normalizedFiles;
}

export function resolveProjectEntryPoint(
  files: ProjectFileMap,
  requestedEntryPoint?: string
): string {
  const explicitEntry = resolveProjectFilePath(files, requestedEntryPoint);
  if (explicitEntry) return explicitEntry;

  const rootIndex = resolveProjectFilePath(files, DEFAULT_PROJECT_ENTRY_POINT);
  if (rootIndex) return rootIndex;

  const htmlEntry = Object.keys(files)
    .filter((path) => detectProjectFileLanguage(path) === "html")
    .sort((a, b) => a.localeCompare(b))[0];
  if (htmlEntry) return htmlEntry;

  return (
    Object.keys(files).sort((a, b) => a.localeCompare(b))[0] ??
    DEFAULT_PROJECT_ENTRY_POINT
  );
}

export function normalizeProjectState<T extends ProjectStateLike>(
  project: T
): NormalizedProjectState<T> {
  const files = normalizeProjectFileMap(project.files);
  const requestedEntryPoint = normalizeProjectPath(project.entryPoint ?? "");
  const legacyFilePath = resolveProjectFilePath(
    files,
    DEFAULT_PROJECT_ENTRY_POINT
  );

  // `code` remains the backward-compatible alias for index.html. Projects
  // without an index file may keep it empty while retaining every source file.
  if (!legacyFilePath && (Object.keys(files).length === 0 || project.code)) {
    files[DEFAULT_PROJECT_ENTRY_POINT] = createProjectFile(
      DEFAULT_PROJECT_ENTRY_POINT,
      project.code
    );
  }

  const entryPoint = resolveProjectEntryPoint(files, requestedEntryPoint);
  const activeFilePath =
    resolveProjectFilePath(files, project.activeFilePath) ?? entryPoint;
  const normalizedLegacyFilePath = resolveProjectFilePath(
    files,
    DEFAULT_PROJECT_ENTRY_POINT
  );

  return {
    ...project,
    code: normalizedLegacyFilePath
      ? files[normalizedLegacyFilePath].content
      : "",
    files,
    entryPoint,
    activeFilePath,
  };
}

export function updateProjectFileContent<T extends ProjectStateLike>(
  project: T,
  path: string,
  content: string,
  options: { force?: boolean } = {}
): NormalizedProjectState<T> {
  const normalizedProject = normalizeProjectState(project);
  const filePath = resolveProjectFilePath(normalizedProject.files, path);
  if (!filePath) return normalizedProject;

  const currentFile = normalizedProject.files[filePath];
  if (currentFile.readonly && !options.force) return normalizedProject;

  const files = {
    ...normalizedProject.files,
    [filePath]: {
      ...currentFile,
      content,
    },
  };

  const legacyFilePath = resolveProjectFilePath(
    files,
    DEFAULT_PROJECT_ENTRY_POINT
  );

  return {
    ...normalizedProject,
    files,
    code:
      filePath === legacyFilePath ? content : normalizedProject.code,
  };
}

export function getProjectFile(
  project: ProjectStateLike,
  path: string
): ProjectFile | undefined {
  const normalizedProject = normalizeProjectState(project);
  const filePath = resolveProjectFilePath(normalizedProject.files, path);
  return filePath ? normalizedProject.files[filePath] : undefined;
}

export function getProjectEntryFile(
  project: ProjectStateLike
): ProjectFile | undefined {
  const normalizedProject = normalizeProjectState(project);
  return normalizedProject.files[normalizedProject.entryPoint];
}

export function getProjectGenerationFile(
  project: ProjectStateLike
): ProjectFile | undefined {
  const normalizedProject = normalizeProjectState(project);
  const targetPath =
    project.generationTargetPath ?? normalizedProject.entryPoint;
  const filePath = resolveProjectFilePath(normalizedProject.files, targetPath);
  return filePath ? normalizedProject.files[filePath] : undefined;
}

export function getProjectGenerationContent(project: ProjectStateLike): string {
  return getProjectGenerationFile(project)?.content ?? "";
}

export function appendToProjectFile<T extends ProjectStateLike>(
  project: T,
  path: string,
  content: string
): NormalizedProjectState<T> {
  const normalizedProject = normalizeProjectState(project);
  const filePath = resolveProjectFilePath(normalizedProject.files, path);
  if (!filePath) return normalizedProject;

  return updateProjectFileContent(
    normalizedProject,
    filePath,
    normalizedProject.files[filePath].content + content,
    { force: true }
  );
}

export function appendToPrimaryProjectFile<T extends ProjectStateLike>(
  project: T,
  content: string
): NormalizedProjectState<T> {
  const normalizedProject = normalizeProjectState(project);
  return appendToProjectFile(
    normalizedProject,
    normalizedProject.entryPoint,
    content
  );
}

export function setActiveProjectFile<T extends ProjectStateLike>(
  project: T,
  path: string
): NormalizedProjectState<T> {
  const normalizedProject = normalizeProjectState(project);
  const activeFilePath = resolveProjectFilePath(normalizedProject.files, path);
  if (!activeFilePath) return normalizedProject;

  return {
    ...normalizedProject,
    activeFilePath,
  };
}

interface MutableTreeFolder {
  name: string;
  path: string;
  folders: Map<string, MutableTreeFolder>;
  files: ProjectTreeNode[];
}

function finalizeTreeFolder(folder: MutableTreeFolder): ProjectTreeNode[] {
  const folders: ProjectTreeNode[] = [...folder.folders.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => ({
      type: "folder",
      name: child.name,
      path: child.path,
      children: finalizeTreeFolder(child),
    }));
  const files = folder.files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

export function buildProjectTree(files: ProjectFileMap): ProjectTreeNode[] {
  const root: MutableTreeFolder = {
    name: "",
    path: "",
    folders: new Map(),
    files: [],
  };

  for (const file of Object.values(normalizeProjectFileMap(files)).sort(
    (a, b) => a.path.localeCompare(b.path)
  )) {
    const parts = file.path.split("/");
    const fileName = parts.pop() ?? file.path;
    let folder = root;
    let folderPath = "";

    for (const part of parts) {
      folderPath = folderPath ? `${folderPath}/${part}` : part;
      let child = folder.folders.get(part);
      if (!child) {
        child = {
          name: part,
          path: folderPath,
          folders: new Map(),
          files: [],
        };
        folder.folders.set(part, child);
      }
      folder = child;
    }

    folder.files.push({
      type: "file",
      name: fileName,
      path: file.path,
      file,
    });
  }

  return finalizeTreeFolder(root);
}

function getHtmlAttribute(attributes: string, name: string): string | null {
  const quotedMatch = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  if (quotedMatch) return quotedMatch[1] ?? quotedMatch[2] ?? "";

  const unquotedMatch = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*([^\\s>]+)`, "i")
  );
  return unquotedMatch?.[1] ?? null;
}

function removeHtmlAttribute(attributes: string, name: string): string {
  return attributes
    .replace(
      new RegExp(
        `(?:^|\\s)${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`,
        "i"
      ),
      ""
    )
    .trim();
}

function replaceHtmlAttributeValue(
  tag: string,
  name: string,
  rewrite: (value: string) => string
): string {
  return tag.replace(
    new RegExp(
      `(\\s${name}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i"
    ),
    (_match, prefix: string, doubleQuoted, singleQuoted, unquoted) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
      return `${prefix}"${escapeHtmlAttribute(rewrite(value))}"`;
    }
  );
}

function isLocalProjectReference(reference: string): boolean {
  const value = reference.trim();
  return (
    Boolean(value) &&
    !value.startsWith("#") &&
    !value.startsWith("//") &&
    !/^[a-z][a-z\d+.-]*:/i.test(value)
  );
}

function resolveProjectReference(
  referrerPath: string,
  reference: string
): string | null {
  if (!isLocalProjectReference(reference)) return null;

  const withoutSuffix = reference.split(/[?#]/, 1)[0];
  let decodedReference = withoutSuffix;
  try {
    decodedReference = decodeURIComponent(withoutSuffix);
  } catch {
    // Keep the literal path when it is not valid percent-encoded text.
  }

  const referrerDirectory = referrerPath.includes("/")
    ? referrerPath.slice(0, referrerPath.lastIndexOf("/"))
    : "";
  const combinedPath = decodedReference.startsWith("/")
    ? decodedReference
    : [referrerDirectory, decodedReference].filter(Boolean).join("/");
  return normalizeProjectPath(combinedPath) || null;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return escapeHtmlAttribute(value).replace(/'/g, "&#39;");
}

function escapeHtmlComment(value: string): string {
  return value.replace(/--/g, "- -");
}

function escapeClosingTag(content: string, tagName: "style" | "script") {
  return content.replace(new RegExp(`</${tagName}`, "gi"), `<\\/${tagName}`);
}

function ensureHtmlDocument(content: string): string {
  if (!content.trim() || /<!doctype|<html(?:\\s|>)/i.test(content)) return content;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
}

function containsLocalModuleReference(content: string): boolean {
  return /(?:\b(?:import|export)\s+(?:[^"'`]*?\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*["'](?:\.{1,2}\/|\/)/m.test(
    content
  );
}

function canInlineBrowserScript(
  file: ProjectFile,
  attributes: string
): boolean {
  const scriptType = (getHtmlAttribute(attributes, "type") ?? "")
    .trim()
    .toLowerCase();
  const supportedType =
    !scriptType ||
    scriptType === "module" ||
    scriptType === "text/javascript" ||
    scriptType === "application/javascript" ||
    scriptType === "text/ecmascript" ||
    scriptType === "application/ecmascript";
  const babelJsx =
    file.language === "jsx" &&
    (scriptType === "text/babel" || scriptType === "text/jsx");
  const extension = file.path.toLowerCase().split(".").pop() ?? "";
  const hasUnsupportedClassicSyntax =
    scriptType !== "module" &&
    (/^\s*(?:import|export)\b/m.test(file.content) ||
      /\brequire\s*\(/.test(file.content));

  return (
    ((file.language === "javascript" && supportedType) || babelJsx) &&
    extension !== "cjs" &&
    (extension !== "mjs" || scriptType === "module") &&
    !hasUnsupportedClassicSyntax &&
    !containsLocalModuleReference(file.content)
  );
}

const ASSET_MIME_TYPES: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  otf: "font/otf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

const TEXT_ASSET_EXTENSIONS = new Set(["svg"]);
const UNSUPPORTED_ASSET_URL = "data:application/octet-stream;base64,";

interface PreviewCompositionContext {
  files: ProjectFileMap;
  inlinedFilePaths: Set<string>;
  resolvedAssetPaths: Set<string>;
  omittedFilePaths: Set<string>;
  diagnostics: Map<string, ProjectPreviewDiagnostic>;
}

function getMetadataString(
  file: ProjectFile,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = file.metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getAssetDataUrl(file: ProjectFile): string | null {
  const content = file.content.trim();
  if (/^data:/i.test(content)) return content;

  const extension = file.path.toLowerCase().split(".").pop() ?? "";
  const mimeType =
    getMetadataString(file, "mimeType", "mime_type", "contentType") ??
    ASSET_MIME_TYPES[extension];
  if (!mimeType || !content) return null;

  const encoding = getMetadataString(
    file,
    "encoding",
    "contentEncoding",
    "content_encoding"
  )?.toLowerCase();
  if (encoding === "base64") {
    return `data:${mimeType};base64,${content.replace(/\\s+/g, "")}`;
  }
  if (TEXT_ASSET_EXTENSIONS.has(extension) || mimeType.startsWith("text/")) {
    return `data:${mimeType};charset=utf-8,${encodeURIComponent(file.content)}`;
  }
  return null;
}

function recordPreviewDiagnostic(
  context: PreviewCompositionContext,
  diagnostic: ProjectPreviewDiagnostic
) {
  const key = `${diagnostic.code}:${diagnostic.referencedFrom}:${diagnostic.path}`;
  context.diagnostics.set(key, diagnostic);
  context.omittedFilePaths.add(diagnostic.path);
}

function resolveLocalAsset(
  reference: string,
  referrerPath: string,
  context: PreviewCompositionContext
): string | null {
  const resolvedPath = resolveProjectReference(referrerPath, reference);
  if (!resolvedPath) return null;
  const filePath = resolveProjectFilePath(context.files, resolvedPath);
  if (!filePath) {
    recordPreviewDiagnostic(context, {
      code: "missing-local-file",
      path: resolvedPath,
      referencedFrom: referrerPath,
      message: `${referrerPath} references missing local file ${resolvedPath}.`,
    });
    return null;
  }

  const dataUrl = getAssetDataUrl(context.files[filePath]);
  if (!dataUrl) {
    recordPreviewDiagnostic(context, {
      code: "unsupported-local-asset",
      path: filePath,
      referencedFrom: referrerPath,
      message: `${filePath} cannot be embedded because its in-memory content is not a supported text or base64 asset.`,
    });
    return null;
  }

  context.resolvedAssetPaths.add(filePath);
  return dataUrl;
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function rewriteCssContent(
  content: string,
  referrerPath: string,
  context: PreviewCompositionContext,
  importStack: Set<string> = new Set()
): string {
  let rewritten = content.replace(
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))\s*\)?([^;]*);/gi,
    (rule, doubleQuoted, singleQuoted, unquoted, suffix: string) => {
      const reference = (doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim();
      if (!isLocalProjectReference(reference)) return rule;
      const resolvedPath = resolveProjectReference(referrerPath, reference);
      const filePath = resolveProjectFilePath(
        context.files,
        resolvedPath ?? undefined
      );
      if (!resolvedPath || !filePath) {
        recordPreviewDiagnostic(context, {
          code: "missing-local-file",
          path: resolvedPath ?? reference,
          referencedFrom: referrerPath,
          message: `${referrerPath} imports missing stylesheet ${resolvedPath ?? reference}.`,
        });
        return `/* shot2code omitted missing stylesheet ${escapeHtmlComment(
          resolvedPath ?? reference
        )} */`;
      }
      const file = context.files[filePath];
      if (file.language !== "css" || !file.path.toLowerCase().endsWith(".css")) {
        recordPreviewDiagnostic(context, {
          code: "unsupported-local-asset",
          path: filePath,
          referencedFrom: referrerPath,
          message: `${filePath} is not browser-ready CSS and was not imported into the preview.`,
        });
        return `/* shot2code omitted unsupported stylesheet ${escapeHtmlComment(filePath)} */`;
      }
      if (importStack.has(filePath)) {
        recordPreviewDiagnostic(context, {
          code: "cyclic-css-import",
          path: filePath,
          referencedFrom: referrerPath,
          message: `Cyclic CSS import detected at ${filePath}.`,
        });
        return `/* shot2code omitted cyclic stylesheet ${escapeHtmlComment(filePath)} */`;
      }

      context.inlinedFilePaths.add(filePath);
      const nextStack = new Set(importStack);
      nextStack.add(filePath);
      const importedCss = rewriteCssContent(
        file.content,
        filePath,
        context,
        nextStack
      );
      const media = suffix.trim();
      return media
        ? `@media ${media} {\n${importedCss}\n}`
        : importedCss;
    }
  );

  rewritten = rewritten.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
    (rule, doubleQuoted, singleQuoted, unquoted) => {
      const reference = (doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim();
      if (!isLocalProjectReference(reference)) return rule;
      const dataUrl = resolveLocalAsset(reference, referrerPath, context);
      return `url("${escapeCssString(dataUrl ?? UNSUPPORTED_ASSET_URL)}")`;
    }
  );

  return rewritten;
}

function rewriteSrcset(
  value: string,
  referrerPath: string,
  context: PreviewCompositionContext
): string {
  if (/\bdata:/i.test(value)) return value;
  return value
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const reference = parts.shift() ?? "";
      if (!isLocalProjectReference(reference)) return candidate.trim();
      const dataUrl = resolveLocalAsset(reference, referrerPath, context);
      return [dataUrl ?? UNSUPPORTED_ASSET_URL, ...parts].join(" ");
    })
    .join(", ");
}

function rewriteHtmlAssetReferences(
  html: string,
  sourcePath: string,
  context: PreviewCompositionContext
): string {
  return html.replace(
    /<(?:img|source|video|audio|track|input|link)\b[^>]*>/gi,
    (originalTag) => {
      let tag = originalTag;
      const tagName = /^<([a-z]+)/i.exec(tag)?.[1]?.toLowerCase();
      const rewriteReference = (reference: string) => {
        if (!isLocalProjectReference(reference)) return reference;
        return (
          resolveLocalAsset(reference, sourcePath, context) ??
          UNSUPPORTED_ASSET_URL
        );
      };

      if (tagName !== "link") {
        tag = replaceHtmlAttributeValue(tag, "src", rewriteReference);
        tag = replaceHtmlAttributeValue(tag, "poster", rewriteReference);
        tag = replaceHtmlAttributeValue(tag, "srcset", (value) =>
          rewriteSrcset(value, sourcePath, context)
        );
        return tag;
      }

      const attributes = tag.slice(5, -1);
      const rel = (getHtmlAttribute(attributes, "rel") ?? "")
        .toLowerCase()
        .split(/\s+/);
      const as = (getHtmlAttribute(attributes, "as") ?? "").toLowerCase();
      if (
        rel.some((value) =>
          ["icon", "apple-touch-icon", "mask-icon"].includes(value)
        ) ||
        (rel.includes("preload") && ["font", "image"].includes(as))
      ) {
        tag = replaceHtmlAttributeValue(tag, "href", rewriteReference);
      }
      return tag;
    }
  );
}

function rewriteInlineStyles(
  html: string,
  sourcePath: string,
  context: PreviewCompositionContext
): string {
  const withStyleBlocks = html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (_tag, attributes: string, css: string) => {
      const stylesheetPath =
        getHtmlAttribute(attributes, "data-shot2code-path") ?? sourcePath;
      return `<style${attributes}>${escapeClosingTag(
        rewriteCssContent(css, stylesheetPath, context),
        "style"
      )}</style>`;
    }
  );

  return withStyleBlocks.replace(
    /(<[a-z][^>]*?)\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')([^>]*>)/gi,
    (_tag, prefix: string, doubleQuoted, singleQuoted, suffix: string) => {
      const css = doubleQuoted ?? singleQuoted ?? "";
      const rewritten = rewriteCssContent(css, sourcePath, context);
      return `${prefix} style="${escapeHtmlAttribute(rewritten)}"${suffix}`;
    }
  );
}

function getHtmlPreviewSourcePath(
  project: NormalizedProjectState<ProjectStateLike>
): string | null {
  const entryFile = project.files[project.entryPoint];
  if (entryFile?.language === "html") return entryFile.path;

  const legacyPath = resolveProjectFilePath(
    project.files,
    DEFAULT_PROJECT_ENTRY_POINT
  );
  if (legacyPath && project.files[legacyPath].language === "html") {
    return legacyPath;
  }

  return (
    Object.values(project.files)
      .filter((file) => file.language === "html")
      .sort((a, b) => a.path.localeCompare(b.path))[0]?.path ?? null
  );
}

function createSourceFallbackHtml(
  entryPoint: string,
  fileCount: number
): string {
  const safeEntryPoint = escapeHtmlText(entryPoint);
  const fileSummary =
    fileCount === 1
      ? "The source file remains"
      : `All ${fileCount} source files remain`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Static preview unavailable</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
    main { width: min(36rem, calc(100% - 3rem)); border: 1px solid #cbd5e1; border-radius: 0.75rem; padding: 1.5rem; background: #fff; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 0.75rem; font-size: 1.125rem; }
    p { margin: 0.5rem 0; color: #475569; line-height: 1.5; }
    code { display: inline-block; border-radius: 0.375rem; padding: 0.2rem 0.4rem; background: #e2e8f0; color: #312e81; }
    @media (prefers-color-scheme: dark) {
      body { background: #09090b; color: #fafafa; }
      main { border-color: #3f3f46; background: #18181b; box-shadow: none; }
      p { color: #a1a1aa; }
      code { background: #27272a; color: #c4b5fd; }
    }
  </style>
</head>
<body>
  <main>
    <h1>This project needs its application runtime.</h1>
    <p><code>${safeEntryPoint}</code> is not a standalone HTML document, so shot2code is showing this safe static preview artifact instead of executing an unsupported build.</p>
    <p>${fileSummary} available in the Code tab for viewing, editing and project download.</p>
  </main>
</body>
</html>`;
}

function emptyPreviewArtifact(
  html: string,
  sourcePath: string | null,
  projectEntryPoint: string,
  kind: ProjectPreviewArtifactKind,
  supportsSelectAndEdit: boolean
): ProjectPreviewArtifact {
  return {
    html,
    sourcePath,
    projectEntryPoint,
    kind,
    inlinedFilePaths: [],
    resolvedAssetPaths: [],
    omittedFilePaths: [],
    diagnostics: [],
    supportsSelectAndEdit,
  };
}

export function createProjectPreviewArtifact(
  project: ProjectStateLike
): ProjectPreviewArtifact {
  const normalizedProject = normalizeProjectState(project);
  const sourcePath = getHtmlPreviewSourcePath(normalizedProject);

  if (!sourcePath) {
    return emptyPreviewArtifact(
      createSourceFallbackHtml(
        normalizedProject.entryPoint,
        Object.keys(normalizedProject.files).length
      ),
      null,
      normalizedProject.entryPoint,
      "source-fallback",
      false
    );
  }

  const entryFile = normalizedProject.files[sourcePath];
  const kind =
    sourcePath === normalizedProject.entryPoint
      ? "html-entry"
      : "html-fallback";
  if (!entryFile.content.trim()) {
    return emptyPreviewArtifact(
      "",
      sourcePath,
      normalizedProject.entryPoint,
      kind,
      kind === "html-entry"
    );
  }

  const context: PreviewCompositionContext = {
    files: normalizedProject.files,
    inlinedFilePaths: new Set<string>(),
    resolvedAssetPaths: new Set<string>(),
    omittedFilePaths: new Set<string>(),
    diagnostics: new Map<string, ProjectPreviewDiagnostic>(),
  };
  const omittedScriptPaths = new Set<string>();

  const findReferencedFile = (reference: string) => {
    const resolvedPath = resolveProjectReference(sourcePath, reference);
    const filePath = resolveProjectFilePath(
      normalizedProject.files,
      resolvedPath ?? undefined
    );
    return {
      file: filePath ? normalizedProject.files[filePath] : undefined,
      filePath,
      resolvedPath,
    };
  };

  const withStyles = entryFile.content.replace(
    /<link\b([^>]*)>/gi,
    (tag, attributes: string) => {
      const rel = getHtmlAttribute(attributes, "rel")
        ?.toLowerCase()
        .split(/\s+/);
      const href = getHtmlAttribute(attributes, "href");
      if (!rel?.includes("stylesheet") || !href || !isLocalProjectReference(href)) {
        return tag;
      }

      const { file, filePath, resolvedPath } = findReferencedFile(href);
      if (
        !file ||
        !filePath ||
        file.language !== "css" ||
        !file.path.toLowerCase().endsWith(".css")
      ) {
        const omittedPath = resolvedPath ?? href;
        recordPreviewDiagnostic(context, {
          code: file ? "unsupported-local-asset" : "missing-local-file",
          path: omittedPath,
          referencedFrom: sourcePath,
          message: `${omittedPath} is not a browser-ready local stylesheet.`,
        });
        return `<!-- shot2code preview omitted stylesheet ${escapeHtmlComment(
          omittedPath
        )} -->`;
      }

      context.inlinedFilePaths.add(file.path);
      const media = getHtmlAttribute(attributes, "media");
      const mediaAttribute = media
        ? ` media="${escapeHtmlAttribute(media)}"`
        : "";
      return `<style data-shot2code-path="${escapeHtmlAttribute(
        file.path
      )}"${mediaAttribute}>${escapeClosingTag(file.content, "style")}</style>`;
    }
  );

  const withScripts = withStyles.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (tag, attributes: string) => {
      const src = getHtmlAttribute(attributes, "src");
      if (!src || !isLocalProjectReference(src)) return tag;

      const { file, filePath, resolvedPath } = findReferencedFile(src);
      if (!file || !filePath || !canInlineBrowserScript(file, attributes)) {
        const omittedPath = resolvedPath ?? src;
        context.omittedFilePaths.add(omittedPath);
        omittedScriptPaths.add(omittedPath);
        recordPreviewDiagnostic(context, {
          code: file ? "unsupported-local-script" : "missing-local-file",
          path: omittedPath,
          referencedFrom: sourcePath,
          message: `${omittedPath} requires a browser build/runtime and was not executed in the preview.`,
        });
        return `<!-- shot2code preview omitted runtime script ${escapeHtmlComment(
          omittedPath
        )} -->`;
      }

      context.inlinedFilePaths.add(file.path);
      const remainingAttributes = removeHtmlAttribute(attributes, "src");
      if (file.language === "jsx") {
        return `<script${
          remainingAttributes ? ` ${remainingAttributes}` : ""
        } data-shot2code-path="${escapeHtmlAttribute(
          file.path
        )}">${escapeClosingTag(file.content, "script")}</script>`;
      }

      const scriptDataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(
        file.content
      )}`;
      return `<script${
        remainingAttributes ? ` ${remainingAttributes}` : ""
      } src="${escapeHtmlAttribute(
        scriptDataUrl
      )}" data-shot2code-path="${escapeHtmlAttribute(file.path)}"></script>`;
    }
  );

  const withResolvedStyles = rewriteInlineStyles(
    withScripts,
    sourcePath,
    context
  );
  const withResolvedAssets = rewriteHtmlAssetReferences(
    withResolvedStyles,
    sourcePath,
    context
  );

  return {
    html: ensureHtmlDocument(withResolvedAssets),
    sourcePath,
    projectEntryPoint: normalizedProject.entryPoint,
    kind,
    inlinedFilePaths: [...context.inlinedFilePaths].sort((a, b) =>
      a.localeCompare(b)
    ),
    resolvedAssetPaths: [...context.resolvedAssetPaths].sort((a, b) =>
      a.localeCompare(b)
    ),
    omittedFilePaths: [...context.omittedFilePaths].sort((a, b) =>
      a.localeCompare(b)
    ),
    diagnostics: [...context.diagnostics.values()].sort((a, b) =>
      `${a.path}:${a.code}:${a.referencedFrom}`.localeCompare(
        `${b.path}:${b.code}:${b.referencedFrom}`
      )
    ),
    supportsSelectAndEdit:
      kind === "html-entry" && omittedScriptPaths.size === 0,
  };
}

export function composeProjectPreview(project: ProjectStateLike): string {
  return createProjectPreviewArtifact(project).html;
}

export function getProjectExportState(
  project: ProjectStateLike
): ProjectExportState {
  const normalizedProject = normalizeProjectState(project);
  return {
    entryPoint: normalizedProject.entryPoint,
    files: Object.values(normalizedProject.files).sort((a, b) =>
      a.path.localeCompare(b.path)
    ),
  };
}