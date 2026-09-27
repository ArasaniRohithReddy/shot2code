import puppeteer, { type Browser, type Page } from "puppeteer";
import type { ExportPreview } from "../components/preview/download";
import { createProjectFile, type ProjectFileMap } from "./project-files";
import { createExportRuntimePreview } from "./export-runtime-preview";
import { createSandboxedPreviewDocument } from "./preview-bridge";

const RUN_BROWSER_TESTS =
  process.env.RUN_EXPORT_PREVIEW_BROWSER === "true";
const describeBrowser = RUN_BROWSER_TESTS ? describe : describe.skip;

function preview(
  projectKind: string,
  files: ProjectFileMap
): ExportPreview {
  return {
    entryPoint: "index.html",
    projectKind,
    files,
    runtimeFiles: files,
    assets: [],
  };
}

describeBrowser("export runtime preview in Chromium", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const executablePath = process.env.SHOT2CODE_TEST_CHROME_PATH;
    if (!executablePath) {
      throw new Error(
        "SHOT2CODE_TEST_CHROME_PATH is required for stack preview browser tests."
      );
    }
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--ignore-certificate-errors"],
    });
    page = await browser.newPage();
    page.setDefaultTimeout(45_000);
  });

  afterAll(async () => {
    await browser.close();
  });

  async function renderStack(
    exportPreview: ExportPreview,
    expectedText: string
  ) {
    const runtime = createExportRuntimePreview(exportPreview);
    expect(runtime.status).toBe("ready");
    const sandboxedDocument = createSandboxedPreviewDocument(
      runtime.artifact.html,
      "stack_preview_browser_test"
    );
    const pageErrors: string[] = [];
    const recordPageError = (error: unknown) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    };
    page.on("pageerror", recordPageError);
    try {
      await page.setContent(sandboxedDocument.html, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        (text) => globalThis.document.body.innerText.includes(String(text)),
        {},
        expectedText
      );
      expect(
        await page.evaluate(() => globalThis.document.body.innerText)
      ).toContain(expectedText);
      expect(pageErrors).toEqual([]);
    } finally {
      page.off("pageerror", recordPageError);
    }
  }

  it("mounts the generated React export files", async () => {
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

    await renderStack(preview("vite_react", files), "React stack 2");
  });

  it("mounts the generated Preact export files", async () => {
    const files = {
      "index.html": createProjectFile(
        "index.html",
        '<!doctype html><html><head><link rel="stylesheet" href="/src/styles.css"></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>'
      ),
      "src/main.js": createProjectFile(
        "src/main.js",
        `import { h, render } from "preact";
import htm from "htm";
const html = htm.bind(h);
render(html\`<main>Preact stack</main>\`, document.getElementById("app"));`
      ),
      "src/styles.css": createProjectFile(
        "src/styles.css",
        "main { color: teal; }"
      ),
    };

    await renderStack(preview("vite_preact", files), "Preact stack");
  });

  it("keeps generated fragment-link click handlers interactive", async () => {
    const runtime = createSandboxedPreviewDocument(
      `<!doctype html><html><body>
        <a id="toggle" href="#" onclick="window.__fragmentClicks = (window.__fragmentClicks || 0) + 1">Toggle</a>
      </body></html>`,
      "fragment_link_browser_test"
    );

    await page.setContent(runtime.html, { waitUntil: "domcontentloaded" });
    await page.click("#toggle");

    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __fragmentClicks?: number })
            .__fragmentClicks
      )
    ).toBe(1);
  });
});
