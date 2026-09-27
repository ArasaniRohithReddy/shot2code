import type { ExportPreview } from "../components/preview/download";
import { createProjectFile, type ProjectFileMap } from "./project-files";
import { createExportRuntimePreview } from "./export-runtime-preview";

function preview(
  projectKind: string,
  files: ProjectFileMap,
  runtimeFiles: ProjectFileMap = files
): ExportPreview {
  return {
    entryPoint: "index.html",
    projectKind,
    files,
    runtimeFiles,
    assets: [],
  };
}

describe("export runtime preview", () => {
  it("composes the generated Vite HTML files", () => {
    const files = {
      "index.html": createProjectFile(
        "index.html",
        '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main>Stack HTML</main><script src="script.js"></script></body></html>'
      ),
      "styles.css": createProjectFile("styles.css", "main { color: purple; }"),
      "script.js": createProjectFile(
        "script.js",
        'document.querySelector("main").dataset.ready = "true";'
      ),
    };

    const runtime = createExportRuntimePreview(preview("vite_html", files));

    expect(runtime.status).toBe("ready");
    expect(runtime.artifact.html).toContain("main { color: purple; }");
    expect(decodeURIComponent(runtime.artifact.html)).toContain(
      'document.querySelector("main").dataset.ready = "true";'
    );
    expect(runtime.artifact.omittedFilePaths).toEqual([]);
  });

  it("projects the controlled React scaffold through its generated App file", () => {
    const files = {
      "index.html": createProjectFile(
        "index.html",
        '<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>'
      ),
      "src/App.jsx": createProjectFile(
        "src/App.jsx",
        `import React, { useState } from "react";
import * as ReactDOMLegacy from "react-dom";
import * as ReactDOMClient from "react-dom/client";

const ReactDOM = { ...ReactDOMLegacy, ...ReactDOMClient };

function App() {
  const [count] = useState(2);
  return <main>React stack {count}</main>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);`
      ),
      "src/main.jsx": createProjectFile(
        "src/main.jsx",
        'import "./App.jsx";'
      ),
      "src/styles.css": createProjectFile(
        "src/styles.css",
        "main { color: rebeccapurple; }"
      ),
    };

    const runtime = createExportRuntimePreview(preview("vite_react", files));

    expect(runtime.status).toBe("ready");
    expect(runtime.artifact.html).toContain(
      "react@18.3.1/umd/react.development.js"
    );
    expect(runtime.artifact.html).toContain(
      "@babel/standalone@7.25.6/babel.min.js"
    );
    expect(runtime.artifact.html).toContain("React stack {count}");
    expect(runtime.artifact.html).not.toContain('src="/src/main.jsx"');
    expect(runtime.artifact.omittedFilePaths).toEqual([]);
  });

  it("maps generated Preact dependencies to browser ESM modules", () => {
    const files = {
      "index.html": createProjectFile(
        "index.html",
        '<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>'
      ),
      "src/main.js": createProjectFile(
        "src/main.js",
        `import { render } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
const html = htm.bind(null);
render(html\`<main>Preact stack</main>\`, document.getElementById("app"));`
      ),
      "src/styles.css": createProjectFile(
        "src/styles.css",
        "main { color: teal; }"
      ),
    };

    const runtime = createExportRuntimePreview(preview("vite_preact", files));
    const decodedHtml = decodeURIComponent(runtime.artifact.html);

    expect(runtime.status).toBe("ready");
    expect(decodedHtml).toContain("https://esm.sh/preact@10.26.4");
    expect(decodedHtml).toContain("https://esm.sh/preact@10.26.4/hooks");
    expect(decodedHtml).toContain("https://esm.sh/htm@3.1.1");
    expect(runtime.artifact.omittedFilePaths).toEqual([]);
  });

  it("embeds bounded binary assets supplied by the export preview", () => {
    const textFiles = {
      "index.html": createProjectFile(
        "index.html",
        '<!doctype html><html><body><img src="assets/logo.png"></body></html>'
      ),
    };
    const runtimeFiles = {
      ...textFiles,
      "assets/logo.png": createProjectFile(
        "assets/logo.png",
        "aGVsbG8=",
        {
          metadata: {
            encoding: "base64",
            mimeType: "image/png",
          },
        }
      ),
    };
    const exportPreview = preview("vite_html", textFiles, runtimeFiles);
    exportPreview.assets = [
      {
        path: "assets/logo.png",
        size: 5,
        mimeType: "image/png",
        contentBase64: "aGVsbG8=",
      },
    ];

    const runtime = createExportRuntimePreview(exportPreview);

    expect(runtime.status).toBe("ready");
    expect(runtime.artifact.html).toContain(
      "data:image/png;base64,aGVsbG8="
    );
    expect(runtime.artifact.resolvedAssetPaths).toEqual(["assets/logo.png"]);
  });

  it("rewrites generated framework source asset strings to embedded data URLs", () => {
    const files = {
      "index.html": createProjectFile(
        "index.html",
        '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>'
      ),
      "src/App.jsx": createProjectFile(
        "src/App.jsx",
        `import React from "react";
import * as ReactDOMLegacy from "react-dom";
import * as ReactDOMClient from "react-dom/client";
const ReactDOM = { ...ReactDOMLegacy, ...ReactDOMClient };
ReactDOM.createRoot(document.getElementById("root")).render(<img src="assets/logo.png" />);`
      ),
      "src/main.jsx": createProjectFile(
        "src/main.jsx",
        'import "./App.jsx";'
      ),
    };
    const runtimeFiles = {
      ...files,
      "assets/logo.png": createProjectFile(
        "assets/logo.png",
        "aGVsbG8=",
        {
          metadata: { encoding: "base64", mimeType: "image/png" },
        }
      ),
    };
    const exportPreview = preview("vite_react", files, runtimeFiles);
    exportPreview.assets = [
      {
        path: "assets/logo.png",
        size: 5,
        mimeType: "image/png",
        contentBase64: "aGVsbG8=",
      },
    ];

    const runtime = createExportRuntimePreview(exportPreview);

    expect(runtime.status).toBe("ready");
    expect(runtime.artifact.html).toContain(
      'src="data:image/png;base64,aGVsbG8="'
    );
    expect(runtime.artifact.html).not.toContain('src="assets/logo.png"');
  });
});
