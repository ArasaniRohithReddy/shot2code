import {
  appendToProjectFile,
  buildProjectTree,
  composeProjectPreview,
  createProjectFile,
  createProjectPreviewArtifact,
  detectProjectFileLanguage,
  getProjectExportState,
  normalizeProjectState,
  setActiveProjectFile,
  updateProjectFileContent,
} from "./project-files";

describe("project file migration", () => {
  it("presents legacy code-only variants as index.html", () => {
    const project = normalizeProjectState({ code: "<main>Legacy</main>" });

    expect(project.entryPoint).toBe("index.html");
    expect(project.activeFilePath).toBe("index.html");
    expect(project.files["index.html"]).toEqual(
      expect.objectContaining({
        path: "index.html",
        content: "<main>Legacy</main>",
        language: "html",
        type: "markup",
      })
    );
    expect(project.code).toBe("<main>Legacy</main>");
  });

  it("keeps code mapped to index.html when another entry point is explicit", () => {
    const project = normalizeProjectState({
      code: "stale compatibility value",
      entryPoint: "pages/home.html",
      files: {
        "index.html": createProjectFile("index.html", "<p>Fallback</p>"),
        "pages/home.html": createProjectFile(
          "pages/home.html",
          "<p>Home</p>"
        ),
      },
    });

    expect(project.entryPoint).toBe("pages/home.html");
    expect(project.code).toBe("<p>Fallback</p>");
  });

  it("keeps source-only projects intact without inventing index.html", () => {
    const project = normalizeProjectState({
      code: "",
      entryPoint: "src/App.tsx",
      files: {
        "src/App.tsx": createProjectFile(
          "src/App.tsx",
          "export function App() { return <main />; }"
        ),
        "package.json": createProjectFile("package.json", "{}"),
      },
    });

    expect(project.entryPoint).toBe("src/App.tsx");
    expect(project.activeFilePath).toBe("src/App.tsx");
    expect(project.code).toBe("");
    expect(project.files["index.html"]).toBeUndefined();
    expect(Object.keys(project.files)).toEqual(["src/App.tsx", "package.json"]);
  });
});

describe("project tree", () => {
  it("builds deterministic nested folders and files", () => {
    const tree = buildProjectTree({
      "src/styles/app.css": createProjectFile(
        "src/styles/app.css",
        "body {}"
      ),
      "index.html": createProjectFile("index.html", "<html></html>"),
      "src/main.tsx": createProjectFile("src/main.tsx", "export {}"),
    });

    expect(tree.map((node) => `${node.type}:${node.name}`)).toEqual([
      "folder:src",
      "file:index.html",
    ]);
    const src = tree[0];
    expect(src.type).toBe("folder");
    if (src.type !== "folder") throw new Error("Expected src folder");
    expect(src.children.map((node) => `${node.type}:${node.name}`)).toEqual([
      "folder:styles",
      "file:main.tsx",
    ]);
    const styles = src.children[0];
    expect(styles.type).toBe("folder");
    if (styles.type !== "folder") throw new Error("Expected styles folder");
    expect(styles.children[0]).toEqual(
      expect.objectContaining({ type: "file", path: "src/styles/app.css" })
    );
  });
});

describe("project file state", () => {
  const files = {
    "index.html": createProjectFile("index.html", "<main>Hello</main>"),
    "styles.css": createProjectFile("styles.css", "main { color: red; }"),
    "script.js": createProjectFile("script.js", "console.log('ready');"),
  };

  it("keeps active-file selection independent from the preview entry", () => {
    const project = setActiveProjectFile(
      { code: "<main>Hello</main>", files },
      "styles.css"
    );

    expect(project.activeFilePath).toBe("styles.css");
    expect(project.entryPoint).toBe("index.html");
    expect(project.code).toBe("<main>Hello</main>");
  });

  it("updates one file without damaging siblings or the compatibility code", () => {
    const project = updateProjectFileContent(
      { code: "<main>Hello</main>", files },
      "styles.css",
      "main { color: blue; }"
    );

    expect(project.files["styles.css"].content).toContain("blue");
    expect(project.files["script.js"].content).toBe("console.log('ready');");
    expect(project.files["index.html"].content).toBe("<main>Hello</main>");
    expect(project.code).toBe("<main>Hello</main>");
  });

  it("keeps non-index entry edits separate from legacy code", () => {
    const project = updateProjectFileContent(
      {
        code: "<main>Legacy preview</main>",
        entryPoint: "src/App.tsx",
        files: {
          "index.html": createProjectFile(
            "index.html",
            "<main>Legacy preview</main>"
          ),
          "src/App.tsx": createProjectFile(
            "src/App.tsx",
            "export const App = () => <main />;"
          ),
        },
      },
      "src/App.tsx",
      "export const App = () => <main>Updated</main>;"
    );

    expect(project.files["src/App.tsx"].content).toContain("Updated");
    expect(project.code).toBe("<main>Legacy preview</main>");
  });

  it("appends streamed output to an explicit project file", () => {
    const project = appendToProjectFile(
      {
        code: "<main>Legacy preview</main>",
        entryPoint: "src/App.tsx",
        files: {
          "index.html": createProjectFile(
            "index.html",
            "<main>Legacy preview</main>"
          ),
          "src/App.tsx": createProjectFile("src/App.tsx", "export "),
        },
      },
      "src/App.tsx",
      "default App;"
    );

    expect(project.files["src/App.tsx"].content).toBe("export default App;");
    expect(project.code).toBe("<main>Legacy preview</main>");
  });

  it("mirrors index.html edits to the legacy code field", () => {
    const project = updateProjectFileContent(
      { code: "<main>Hello</main>", files },
      "index.html",
      "<main>Updated</main>"
    );

    expect(project.files["index.html"].content).toBe("<main>Updated</main>");
    expect(project.code).toBe("<main>Updated</main>");
    expect(project.files["styles.css"].content).toContain("red");
  });

  it("does not edit files marked read only", () => {
    const readOnlyFiles = {
      ...files,
      "styles.css": createProjectFile(
        "styles.css",
        "main { color: red; }",
        { readonly: true, generated: true }
      ),
    };
    const project = updateProjectFileContent(
      { code: "<main>Hello</main>", files: readOnlyFiles },
      "styles.css",
      "main { color: blue; }"
    );

    expect(project.files["styles.css"].content).toContain("red");
    expect(project.files["styles.css"].generated).toBe(true);
  });
});

describe("preview composition", () => {
  it("inlines referenced local CSS and JavaScript while preserving externals", () => {
    const project = {
      code: "",
      entryPoint: "pages/index.html",
      files: {
        "pages/index.html": createProjectFile(
          "pages/index.html",
          `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="../styles/site.css?v=1">
    <link rel="stylesheet" href="https://example.com/external.css">
  </head>
  <body>
    <main>Preview</main>
    <script defer src="../scripts/app.js"></script>
    <script src="https://example.com/external.js"></script>
  </body>
</html>`
        ),
        "styles/site.css": createProjectFile(
          "styles/site.css",
          "main { color: rebeccapurple; }"
        ),
        "scripts/app.js": createProjectFile(
          "scripts/app.js",
          'console.log("</script>");'
        ),
      },
    };

    const preview = composeProjectPreview(project);

    expect(preview).toContain(
      '<style data-shot2code-path="styles/site.css">main { color: rebeccapurple; }</style>'
    );
    expect(preview).toContain(
      '<script defer src="data:text/javascript;charset=utf-8,'
    );
    expect(preview).toContain('data-shot2code-path="scripts/app.js"');
    expect(preview).toContain("console.log(%22%3C%2Fscript%3E%22)%3B");
    expect(preview).toContain("https://example.com/external.css");
    expect(preview).toContain("https://example.com/external.js");
    expect(preview).not.toContain('href="../styles/site.css?v=1"');
    expect(preview).not.toContain('src="../scripts/app.js"');
  });

  it("embeds local HTML, srcset, CSS, and font assets from the project", () => {
    const artifact = createProjectPreviewArtifact({
      code: "",
      entryPoint: "pages/index.html",
      files: {
        "pages/index.html": createProjectFile(
          "pages/index.html",
          `<!doctype html><html><head><link rel="stylesheet" href="../styles/site.css"></head><body>
            <img src="../assets/logo.svg" srcset="../assets/logo.svg 1x, ../assets/logo-large.svg 2x">
            <main style="background-image: url('../assets/logo.svg')">Preview</main>
          </body></html>`
        ),
        "styles/site.css": createProjectFile(
          "styles/site.css",
          `@import "./tokens.css";
          @font-face { font-family: Demo; src: url("../fonts/demo.woff2") format("woff2"); }
          main { background-image: url("../assets/logo-large.svg"); }`
        ),
        "styles/tokens.css": createProjectFile(
          "styles/tokens.css",
          ":root { --accent: rebeccapurple; }"
        ),
        "assets/logo.svg": createProjectFile(
          "assets/logo.svg",
          '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>'
        ),
        "assets/logo-large.svg": createProjectFile(
          "assets/logo-large.svg",
          '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" cx="5" cy="5" /></svg>'
        ),
        "fonts/demo.woff2": createProjectFile(
          "fonts/demo.woff2",
          "d09GMg==",
          { metadata: { mimeType: "font/woff2", encoding: "base64" } }
        ),
      },
    });

    expect(artifact.kind).toBe("html-entry");
    expect(artifact.inlinedFilePaths).toEqual([
      "styles/site.css",
      "styles/tokens.css",
    ]);
    expect(artifact.resolvedAssetPaths).toEqual([
      "assets/logo-large.svg",
      "assets/logo.svg",
      "fonts/demo.woff2",
    ]);
    expect(artifact.omittedFilePaths).toEqual([]);
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.html).toContain("data:image/svg+xml;charset=utf-8,");
    expect(artifact.html).toContain("data:font/woff2;base64,d09GMg==");
    expect(artifact.html).not.toContain("../assets/logo.svg");
    expect(artifact.html).not.toContain("../assets/logo-large.svg");
    expect(artifact.html).not.toContain("../fonts/demo.woff2");
    expect(artifact.html).not.toContain('@import "./tokens.css"');
  });

  it("reports unresolved local assets deterministically without fetching them", () => {
    const artifact = createProjectPreviewArtifact({
      code: '<img src="./missing.png"><style>main { background: url("./missing.svg") }</style>',
    });

    expect(artifact.omittedFilePaths).toEqual(["missing.png", "missing.svg"]);
    expect(artifact.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "missing-local-file",
      "missing-local-file",
    ]);
    expect(artifact.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      "missing.png",
      "missing.svg",
    ]);
    expect(artifact.html).not.toContain('./missing.png');
    expect(artifact.html).not.toContain('./missing.svg');
    expect(artifact.html).toContain("data:application/octet-stream;base64,");
  });

  it("omits local JavaScript modules that still depend on a build graph", () => {
    const artifact = createProjectPreviewArtifact({
      code: '<main id="app"></main><script type="module" src="./src/main.js"></script>',
      files: {
        "index.html": createProjectFile(
          "index.html",
          '<main id="app"></main><script type="module" src="./src/main.js"></script>'
        ),
        "src/main.js": createProjectFile(
          "src/main.js",
          'import { mount } from "./mount.js"; mount();'
        ),
        "src/mount.js": createProjectFile(
          "src/mount.js",
          "export const mount = () => undefined;"
        ),
      },
    });

    expect(artifact.omittedFilePaths).toEqual(["src/main.js"]);
    expect(artifact.inlinedFilePaths).toEqual([]);
    expect(artifact.supportsSelectAndEdit).toBe(false);
    expect(artifact.html).not.toContain('src="./src/main.js"');
  });

  it("uses an HTML fallback without executing unsupported TSX runtime files", () => {
    const project = {
      code: "<div id=\"root\"></div>",
      entryPoint: "src/App.tsx",
      files: {
        "index.html": createProjectFile(
          "index.html",
          '<div id="root"></div><script type="module" src="./src/main.tsx"></script>'
        ),
        "src/App.tsx": createProjectFile(
          "src/App.tsx",
          "export const App = () => <main>App</main>;"
        ),
        "src/main.tsx": createProjectFile(
          "src/main.tsx",
          'import { App } from "./App";'
        ),
      },
    };

    const artifact = createProjectPreviewArtifact(project);

    expect(artifact.kind).toBe("html-fallback");
    expect(artifact.sourcePath).toBe("index.html");
    expect(artifact.supportsSelectAndEdit).toBe(false);
    expect(artifact.omittedFilePaths).toEqual(["src/main.tsx"]);
    expect(artifact.html).toContain(
      "shot2code preview omitted runtime script src/main.tsx"
    );
    expect(project.files["src/App.tsx"].content).toContain("App");
  });

  it("renders a safe artifact when a project has no HTML file", () => {
    const project = {
      code: "",
      entryPoint: "src/App.vue",
      files: {
        "src/App.vue": createProjectFile(
          "src/App.vue",
          "<template><main>App</main></template>"
        ),
        "package.json": createProjectFile("package.json", "{}"),
      },
    };

    const artifact = createProjectPreviewArtifact(project);

    expect(artifact.kind).toBe("source-fallback");
    expect(artifact.sourcePath).toBeNull();
    expect(artifact.supportsSelectAndEdit).toBe(false);
    expect(artifact.html).toContain("src/App.vue");
    expect(artifact.html).toContain("All 2 source files remain available in the Code tab");
    expect(Object.keys(project.files)).toHaveLength(2);
  });
});

describe("language detection", () => {
  test.each([
    ["index.html", "html"],
    ["styles/app.scss", "css"],
    ["src/main.js", "javascript"],
    ["src/view.jsx", "jsx"],
    ["src/main.ts", "typescript"],
    ["src/App.tsx", "tsx"],
    ["package.json", "json"],
    ["README.md", "markdown"],
    ["src/App.vue", "vue"],
    ["public/logo.svg", "xml"],
    ["workflow.yml", "yaml"],
    ["Dockerfile", "text"],
  ] as const)("detects %s as %s", (path, expected) => {
    expect(detectProjectFileLanguage(path)).toBe(expected);
  });

  it("exports every normalized file in path order", () => {
    const project = getProjectExportState({
      code: "<html></html>",
      files: {
        "styles.css": createProjectFile("styles.css", "body {}"),
        "index.html": createProjectFile("index.html", "<html></html>"),
      },
    });

    expect(project.entryPoint).toBe("index.html");
    expect(project.files.map((file) => file.path)).toEqual([
      "index.html",
      "styles.css",
    ]);
  });
});