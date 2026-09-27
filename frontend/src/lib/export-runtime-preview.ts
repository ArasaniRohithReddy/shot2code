import type { ExportPreview } from "../components/preview/download";
import {
  createProjectFile,
  createProjectPreviewArtifact,
  type ProjectFileMap,
  type ProjectPreviewArtifact,
} from "./project-files";
import { PINNED_BABEL_STANDALONE_URL } from "./babelCdn";

const REACT_URL =
  "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.development.js";
const REACT_DOM_URL =
  "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.development.js";
const PREACT_URL = "https://esm.sh/preact@10.26.4";
const PREACT_HOOKS_URL = "https://esm.sh/preact@10.26.4/hooks";
const HTM_URL = "https://esm.sh/htm@3.1.1";

export type ExportRuntimePreviewStatus = "ready" | "limited" | "unavailable";

export interface ExportRuntimePreview {
  artifact: ProjectPreviewArtifact;
  status: ExportRuntimePreviewStatus;
  detail: string;
}

const SCRIPT_ASSET_EXTENSIONS = new Set([
  "js",
  "jsx",
  "mjs",
  "ts",
  "tsx",
]);

function relativeProjectPath(sourcePath: string, targetPath: string): string {
  const sourceParts = sourcePath.split("/");
  sourceParts.pop();
  const targetParts = targetPath.split("/");
  while (
    sourceParts.length > 0 &&
    targetParts.length > 0 &&
    sourceParts[0] === targetParts[0]
  ) {
    sourceParts.shift();
    targetParts.shift();
  }
  return `${"../".repeat(sourceParts.length)}${targetParts.join("/")}`;
}

function replaceEvery(
  source: string,
  search: string,
  replacement: string
): string {
  return search ? source.split(search).join(replacement) : source;
}

function embedScriptAssetReferences(preview: ExportPreview): ExportPreview {
  const embeddedAssets = preview.assets.filter(
    (
      asset
    ): asset is typeof asset & {
      contentBase64: string;
    } => Boolean(asset.contentBase64)
  );
  if (embeddedAssets.length === 0) return preview;

  const runtimeFiles = { ...preview.runtimeFiles };
  for (const file of Object.values(runtimeFiles)) {
    const extension = file.path.toLowerCase().split(".").pop() ?? "";
    if (!SCRIPT_ASSET_EXTENSIONS.has(extension)) continue;

    let content = file.content;
    for (const asset of embeddedAssets) {
      const dataUrl = `data:${asset.mimeType};base64,${asset.contentBase64}`;
      const relativePath = relativeProjectPath(file.path, asset.path);
      const references = new Set([
        `/${asset.path}`,
        `./${asset.path}`,
        asset.path,
        relativePath,
      ]);
      for (const reference of [...references].sort(
        (left, right) => right.length - left.length
      )) {
        content = replaceEvery(content, reference, dataUrl);
        content = replaceEvery(
          content,
          reference.replace(/\//g, "\\/"),
          dataUrl
        );
      }
    }
    if (content !== file.content) {
      runtimeFiles[file.path] = createProjectFile(file.path, content, file);
    }
  }

  return { ...preview, runtimeFiles };
}

function projectArtifact(
  preview: ExportPreview,
  files: ProjectFileMap
): ProjectPreviewArtifact {
  const entryFile = files[preview.entryPoint];
  return createProjectPreviewArtifact({
    code: entryFile?.content ?? "",
    files,
    entryPoint: preview.entryPoint,
    activeFilePath: preview.entryPoint,
  });
}

function unavailableArtifact(message: string): ProjectPreviewArtifact {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stack preview unavailable</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
    main { width: min(38rem, calc(100% - 3rem)); padding: 1.5rem; border: 1px solid #cbd5e1; border-radius: 0.75rem; background: #fff; }
    h1 { margin: 0 0 0.75rem; font-size: 1.125rem; }
    p { margin: 0; color: #475569; line-height: 1.55; }
    @media (prefers-color-scheme: dark) {
      body { background: #09090b; color: #fafafa; }
      main { border-color: #3f3f46; background: #18181b; }
      p { color: #d4d4d8; }
    }
  </style>
</head>
<body><main><h1>Stack preview is not available for this project.</h1><p>${message}</p></main></body>
</html>`;
  return createProjectPreviewArtifact({
    code: html,
    files: { "index.html": createProjectFile("index.html", html) },
    entryPoint: "index.html",
    activeFilePath: "index.html",
  });
}

function rewriteReactScaffoldSource(source: string): string | null {
  const reactImport =
    /^import React(?:,\s*\{\s*([^}]*)\s*\})?\s+from\s+["']react["'];\s*$/m.exec(
      source
    );
  if (!reactImport) return null;

  const namedReactImports = (reactImport[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const hasCreateRootImport =
    /^import\s+\{\s*createRoot\s*\}\s+from\s+["']react-dom\/client["'];\s*$/m.test(
      source
    );
  const hasRenderImport =
    /^import\s+\{\s*render\s*\}\s+from\s+["']react-dom["'];\s*$/m.test(
      source
    );

  let runtimeSource = source
    .replace(
      /^import React(?:,\s*\{\s*[^}]*\s*\})?\s+from\s+["']react["'];\s*$/m,
      ""
    )
    .replace(
      /^import \* as ReactDOMLegacy from\s+["']react-dom["'];\s*$/m,
      ""
    )
    .replace(
      /^import \* as ReactDOMClient from\s+["']react-dom\/client["'];\s*$/m,
      ""
    )
    .replace(
      /^import\s+\{\s*createRoot\s*\}\s+from\s+["']react-dom\/client["'];\s*$/m,
      ""
    )
    .replace(
      /^import\s+\{\s*render\s*\}\s+from\s+["']react-dom["'];\s*$/m,
      ""
    )
    .trimStart();

  if (/^\s*(?:import|export)\b/m.test(runtimeSource)) return null;

  const reactDomMarker =
    /const ReactDOM = \{\s*\.\.\.ReactDOMLegacy,\s*\.\.\.ReactDOMClient\s*\};/;
  if (!reactDomMarker.test(runtimeSource)) return null;

  const aliases: string[] = [];
  if (namedReactImports.length > 0) {
    aliases.push(`const { ${namedReactImports.join(", ")} } = React;`);
  }
  if (hasCreateRootImport) {
    aliases.push("const createRoot = ReactDOM.createRoot;");
  }
  if (hasRenderImport) {
    aliases.push("const render = ReactDOM.render;");
  }
  runtimeSource = runtimeSource.replace(
    reactDomMarker,
    (marker) => `${marker}${aliases.length ? `\n${aliases.join("\n")}` : ""}`
  );

  return `const ReactDOMLegacy = window.ReactDOM;
const ReactDOMClient = window.ReactDOM;

${runtimeSource}`;
}

function createReactRuntimeFiles(
  preview: ExportPreview
): ProjectFileMap | null {
  const indexFile = preview.runtimeFiles["index.html"];
  const appFile = preview.runtimeFiles["src/App.jsx"];
  if (!indexFile || !appFile) return null;

  const runtimeSource = rewriteReactScaffoldSource(appFile.content);
  if (!runtimeSource) return null;

  const moduleEntry =
    /<script\b(?=[^>]*\btype\s*=\s*["']module["'])(?=[^>]*\bsrc\s*=\s*["']\/?src\/main\.jsx["'])[^>]*>\s*<\/script\s*>/i;
  if (!moduleEntry.test(indexFile.content)) return null;

  const runtimeScripts = `<script src="${REACT_URL}"></script>
<script src="${REACT_DOM_URL}"></script>
<script src="${PINNED_BABEL_STANDALONE_URL}"></script>
<script type="text/babel" src="/src/App.jsx"></script>`;
  const files = { ...preview.runtimeFiles };
  files["index.html"] = createProjectFile(
    "index.html",
    indexFile.content.replace(moduleEntry, runtimeScripts),
    indexFile
  );
  files["src/App.jsx"] = createProjectFile(
    "src/App.jsx",
    runtimeSource,
    appFile
  );
  return files;
}

function createPreactRuntimeFiles(
  preview: ExportPreview
): ProjectFileMap | null {
  const mainFile = preview.runtimeFiles["src/main.js"];
  if (!mainFile) return null;

  const replaceSpecifier = (
    source: string,
    specifier: string,
    replacement: string
  ) =>
    source
      .split(`"${specifier}"`)
      .join(`"${replacement}"`)
      .split(`'${specifier}'`)
      .join(`'${replacement}'`);
  let runtimeSource = replaceSpecifier(
    mainFile.content,
    "preact/hooks",
    PREACT_HOOKS_URL
  );
  runtimeSource = replaceSpecifier(runtimeSource, "preact", PREACT_URL);
  runtimeSource = replaceSpecifier(runtimeSource, "htm", HTM_URL);
  if (
    /(?:from|import)\s*(?:\(\s*)?["'](?:preact(?:\/hooks)?|htm)["']/.test(
      runtimeSource
    )
  ) {
    return null;
  }

  return {
    ...preview.runtimeFiles,
    "src/main.js": createProjectFile(
      "src/main.js",
      runtimeSource,
      mainFile
    ),
  };
}

export function createExportRuntimePreview(
  preview: ExportPreview
): ExportRuntimePreview {
  const runtimePreview = embedScriptAssetReferences(preview);
  let files = runtimePreview.runtimeFiles;
  if (runtimePreview.projectKind === "vite_react") {
    const reactFiles = createReactRuntimeFiles(runtimePreview);
    if (!reactFiles) {
      return {
        artifact: unavailableArtifact(
          "The generated React scaffold did not match the controlled shot2code runtime shape, so it was not executed."
        ),
        status: "unavailable",
        detail: "React scaffold could not be projected safely",
      };
    }
    files = reactFiles;
  } else if (runtimePreview.projectKind === "vite_preact") {
    const preactFiles = createPreactRuntimeFiles(runtimePreview);
    if (!preactFiles) {
      return {
        artifact: unavailableArtifact(
          "The generated Preact scaffold uses dependencies outside the controlled shot2code runtime mapping, so it was not executed."
        ),
        status: "unavailable",
        detail: "Preact scaffold could not be projected safely",
      };
    }
    files = preactFiles;
  }

  const artifact = projectArtifact(runtimePreview, files);
  const omittedAssets = runtimePreview.assets.filter(
    (asset) => !asset.contentBase64
  ).length;
  const hasRuntimeGap =
    artifact.kind === "source-fallback" ||
    artifact.omittedFilePaths.length > 0 ||
    omittedAssets > 0;

  if (hasRuntimeGap) {
    const reasons: string[] = [];
    if (artifact.kind === "source-fallback") {
      reasons.push("the entry requires unsupported build tooling");
    }
    if (artifact.omittedFilePaths.length > 0) {
      reasons.push(
        `${artifact.omittedFilePaths.length} local runtime file${
          artifact.omittedFilePaths.length === 1 ? " was" : "s were"
        } omitted`
      );
    }
    if (omittedAssets > 0) {
      reasons.push(
        `${omittedAssets} large asset${omittedAssets === 1 ? " was" : "s were"} not embedded`
      );
    }
    return {
      artifact,
      status: "limited",
      detail: reasons.join("; "),
    };
  }

  return {
    artifact,
    status: "ready",
    detail: `${runtimePreview.projectKind} rendered from the generated export files`,
  };
}
