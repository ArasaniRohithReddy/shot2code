import type { ProjectPreviewArtifact } from "../../lib/project-files";
import { Stack } from "../../lib/stacks";
import { CODEPEN_STACK_FIXTURES } from "./codepen.fixtures";
import { createCodePenShareResult } from "./codepen";

function artifact(
  html: string,
  overrides: Partial<ProjectPreviewArtifact> = {}
): ProjectPreviewArtifact {
  return {
    html,
    sourcePath: "index.html",
    projectEntryPoint: "index.html",
    kind: "html-entry",
    inlinedFilePaths: [],
    resolvedAssetPaths: [],
    omittedFilePaths: [],
    diagnostics: [],
    supportsSelectAndEdit: true,
    ...overrides,
  };
}

describe("CodePen stack serialization", () => {
  test.each(CODEPEN_STACK_FIXTURES)(
    "serializes $name without changing browser semantics",
    ({ stack, html, expected, warningCount = 1 }) => {
      const result = createCodePenShareResult({
        stack,
        artifact: artifact(html),
      });

      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") return;
      expect(result.payload).toEqual(expected);
      expect(result.warnings).toHaveLength(warningCount);
      expect(result.warnings[0]).toContain("off this device");
      expect(result.warnings[0]).toContain("Public Pens");
      expect(result.payload.css_external).not.toContain(",");
      expect(result.payload.js_external).not.toContain(",");
    }
  );

  it("does not mistake closing-tag text inside scripts for document structure", () => {
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact(
        '<html><head><script>window.marker = "</head>";</script><style>main{display:block}</style></head><body><main>Hi</main></body></html>'
      ),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.html).toBe("<main>Hi</main>");
    expect(result.payload.js).toBe('window.marker = "</head>";');
    expect(result.payload.css).toBe("main{display:block}");
  });

  it("preserves body attributes without nesting a second body element", () => {
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact(
        '<html><head></head><body class="theme-dark" data-page="home"><main>Hi</main></body></html>'
      ),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.html).toBe("<main>Hi</main>");
    expect(result.payload.head).toContain("DOMContentLoaded");
    expect(result.payload.head).toContain('[["class","theme-dark"],["data-page","home"]]');
    expect(result.payload.html).not.toContain("<body");
  });

  it("accepts self-contained data URL assets", () => {
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact(
        '<html><head></head><body><img src="data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E" srcset="data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E 1x, data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E 2x"></body></html>'
      ),
    });

    expect(result.kind).toBe("ready");
  });

  it("deduplicates external resources without leaving duplicate tags", () => {
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact(
        '<html><head><link rel="stylesheet" href="https://example.com/a.css"><link rel="stylesheet" href="https://example.com/a.css"></head><body><main>Hi</main><script src="https://example.com/a.js"></script><script src="https://example.com/a.js"></script></body></html>'
      ),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.css_external).toBe("https://example.com/a.css");
    expect(result.payload.js_external).toBe("https://example.com/a.js");
    expect(result.payload.head).not.toContain("a.css");
    expect(result.payload.html).not.toContain("a.js");
  });

  it("keeps direct Preact HTM modules browser-runnable", () => {
    const moduleScript = '<script type="module">import { h, render } from "https://esm.sh/preact@10.29.8"; import htm from "https://esm.sh/htm@3.1.1"; const html = htm.bind(h); render(html`<main>Hi</main>`, document.body);</script>';
    const result = createCodePenShareResult({
      stack: Stack.PREACT_TAILWIND,
      artifact: artifact(
        `<html><head><script src="https://cdn.tailwindcss.com/3.4.17"></script>${moduleScript}</head><body><div id="root"></div></body></html>`
      ),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.head).toBe("");
    expect(result.payload.js).toContain('import { h, render }');
    expect(result.payload.js_module).toBe(true);
    expect(result.payload.js_external).toBe(
      "https://cdn.tailwindcss.com/3.4.17"
    );
  });

  it("converts Material external modules into the module-enabled JS panel", () => {
    const result = createCodePenShareResult({
      stack: Stack.MATERIAL_WEB,
      artifact: artifact(
        '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined"><script type="module" src="https://esm.run/@material/web@2.5.0/all.js"></script></head><body><md-filled-button>Hi</md-filled-button><script type="module">import { styles } from "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js"; document.adoptedStyleSheets.push(styles.styleSheet);</script></body></html>'
      ),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.js_module).toBe(true);
    expect(result.payload.js).toBe(
      'import "https://esm.run/@material/web@2.5.0/all.js";\n\nimport { styles } from "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js"; document.adoptedStyleSheets.push(styles.styleSheet);'
    );
    expect(result.payload.head).not.toContain("all.js");
  });

  it("accepts Ionic's module-only browser runtime", () => {
    const moduleScript = '<script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/dist/ionic/ionic.esm.js"></script>';
    const result = createCodePenShareResult({
      stack: Stack.IONIC_TAILWIND,
      artifact: artifact(
        `<html><head>${moduleScript}<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/css/ionic.bundle.css"><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body><ion-app>Hi</ion-app></body></html>`
      ),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.head).toBe(moduleScript);
  });

  it("deduplicates identical deferred resources without merging semantics", () => {
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact(
        '<html><head><script defer src="https://example.com/app.js"></script><script defer src="https://example.com/app.js"></script><script nomodule src="https://example.com/app.js"></script></head><body><main>Hi</main></body></html>'
      ),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.head.match(/defer/g)).toHaveLength(1);
    expect(result.payload.head.match(/nomodule/g)).toHaveLength(1);
  });

  it("keeps module, nomodule, import-map, and deferred scripts in markup", () => {
    const html = '<html><head><script type="importmap">{"imports":{}}</script><script type="module" src="https://example.com/module.js"></script><script nomodule src="https://example.com/legacy.js"></script><script defer src="https://example.com/defer.js"></script></head><body><main>Hi</main></body></html>';
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact(html),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.payload.head).toBe(
      '<script type="importmap">{"imports":{}}</script><script type="module" src="https://example.com/module.js"></script><script nomodule src="https://example.com/legacy.js"></script><script defer src="https://example.com/defer.js"></script>'
    );
    expect(result.payload.js_external).toBe("");
  });

  it("rejects fallback previews and preserves project-download guidance", () => {
    const result = createCodePenShareResult({
      stack: Stack.REACT_TAILWIND,
      artifact: artifact('<div id="root"></div>', {
        sourcePath: "index.html",
        projectEntryPoint: "src/App.tsx",
        kind: "html-fallback",
        supportsSelectAndEdit: false,
      }),
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "fallback-preview",
      message:
        "CodePen is unavailable because src/App.tsx needs a build runtime. Download the Project folder to keep every source file.",
      paths: ["src/App.tsx"],
    });
  });

  it("rejects artifacts with deterministic omitted dependencies", () => {
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact("<main>Preview</main>", {
        omittedFilePaths: ["assets/logo.png"],
        diagnostics: [
          {
            code: "unsupported-local-asset",
            path: "assets/logo.png",
            referencedFrom: "index.html",
            message: "Asset unavailable.",
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      kind: "unsupported",
      reason: "omitted-dependency",
      paths: ["assets/logo.png"],
    });
  });

  it("rejects local module imports instead of pretending they run", () => {
    const result = createCodePenShareResult({
      stack: Stack.HTML_CSS,
      artifact: artifact(
        '<html><head></head><body><main>Preview</main><script type="module">import "./app.js";</script></body></html>'
      ),
    });

    expect(result).toMatchObject({
      kind: "unsupported",
      reason: "local-runtime-reference",
      paths: ["inline module import"],
    });
  });

  it("does not invent framework resources", () => {
    const result = createCodePenShareResult({
      stack: Stack.REACT_TAILWIND,
      artifact: artifact(
        '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div><script type="text/babel">ReactDOM.createRoot(document.getElementById("root")).render(<main />)</script></body></html>'
      ),
    });

    expect(result).toMatchObject({
      kind: "unsupported",
      reason: "stack-mismatch",
    });
  });
});
