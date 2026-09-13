jest.mock("../config", () => ({ HTTP_BACKEND_URL: "http://localhost" }));

import { Stack } from "./stacks";
import { prepareProjectFiles, type ProjectSourceFileLike } from "./project-context";
import {
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_FILES,
  MAX_PROJECT_TOTAL_BYTES,
  detectStackFromSource,
  getLegacyEditableFile,
  normalizeImportedProjectPath,
  parseProjectImportAnalysis,
  type EditableProjectImport,
} from "./project-import";

function sourceFile(
  path: string,
  size: number,
  content: string,
  text = jest.fn(async () => content)
): ProjectSourceFileLike {
  const parts = path.split("/");
  return {
    name: parts[parts.length - 1],
    webkitRelativePath: path,
    size,
    text,
  };
}

describe("detectStackFromSource", () => {
  test.each<[string, string, Stack]>([
    ["plain HTML", "<main>Hello</main>", Stack.HTML_CSS],
    ["Tailwind CDN", '<script src="https://cdn.tailwindcss.com"></script>', Stack.HTML_TAILWIND],
    ["React", 'import React from "react"; export const App = () => <main />;', Stack.REACT_TAILWIND],
    ["React CDN", '<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>', Stack.REACT_TAILWIND],
    ["Bootstrap", '<link href="https://cdn.example/bootstrap.min.css">', Stack.BOOTSTRAP],
    ["Vue", '<script>const app = Vue.createApp({})</script>', Stack.VUE_TAILWIND],
    ["Vue CDN", '<script src="https://cdn.jsdelivr.net/npm/vue@3"></script>', Stack.VUE_TAILWIND],
    ["Ionic", 'import { IonApp } from "@ionic/react";', Stack.IONIC_TAILWIND],
    ["Alpine", '<main x-data="{}"></main>', Stack.ALPINE_TAILWIND],
    ["Preact", 'import { h } from "preact";', Stack.PREACT_TAILWIND],
    ["daisyUI", '@plugin "daisyui";', Stack.TAILWIND_DAISYUI],
    ["Bulma", '<link href="https://cdn.jsdelivr.net/npm/bulma@1/css/bulma.min.css">', Stack.BULMA],
    ["Material Web", 'import "@material/web/all.js";', Stack.MATERIAL_WEB],
    ["htmx", '<button hx-post="/save">Save</button>', Stack.HTMX_TAILWIND],
  ])("detects %s", (_label, source, expected) => {
    expect(detectStackFromSource(source).stack).toBe(expected);
  });

  test("uses the file extension as framework evidence", () => {
    expect(detectStackFromSource("export const App = () => null;", "App.tsx").stack).toBe(
      Stack.REACT_TAILWIND
    );
  });
});

describe("normalizeImportedProjectPath", () => {
  test("normalizes safe relative paths", () => {
    expect(normalizeImportedProjectPath(String.raw`Demo\src\.\App.tsx`)).toBe(
      "Demo/src/App.tsx"
    );
  });

  test.each([
    "../escape.ts",
    "/absolute/App.tsx",
    String.raw`C:\App.tsx`,
    "./C:/App.tsx",
  ])(
    "rejects unsafe path %s",
    (path) => {
      expect(() => normalizeImportedProjectPath(path)).toThrow();
    }
  );
});

describe("prepareProjectFiles", () => {
  test("validates aggregate size before reading any file", async () => {
    const readers = Array.from({ length: 15 }, () => jest.fn(async () => "x"));
    const files = readers.map((reader, index) =>
      sourceFile(
        `Demo/src/part-${index}.ts`,
        MAX_PROJECT_FILE_BYTES,
        "x",
        reader
      )
    );

    await expect(prepareProjectFiles(files, "folder")).rejects.toThrow(
      "Selected source is too large"
    );
    readers.forEach((reader) => expect(reader).not.toHaveBeenCalled());
  });

  test("does not read ignored or unsupported files and preserves their paths", async () => {
    const ignoredReader = jest.fn(async () => "should not be read");
    const binaryAssetReader = jest.fn(async () => "should not be read");
    const appReader = jest.fn(async () => "export const App = () => <main />;");

    const prepared = await prepareProjectFiles(
      [
        sourceFile("Demo/node_modules/pkg/index.js", 10_000_000, "", ignoredReader),
        sourceFile("Demo/public/logo.png", 10_000_000, "", binaryAssetReader),
        sourceFile("Demo/src/App.tsx", 38, "", appReader),
      ],
      "folder"
    );

    expect(prepared.name).toBe("Demo");
    expect(prepared.readableFileCount).toBe(1);
    expect(prepared.files).toEqual([
      { path: "Demo/node_modules/pkg/index.js", content: "" },
      { path: "Demo/public/logo.png", content: "" },
      { path: "Demo/src/App.tsx", content: "export const App = () => <main />;" },
    ]);
    expect(ignoredReader).not.toHaveBeenCalled();
    expect(binaryAssetReader).not.toHaveBeenCalled();
    expect(appReader).toHaveBeenCalledTimes(1);
  });
});

describe("project import payload", () => {
  const appContent = "export const App = () => <main />;";
  const response = {
    context: {
      name: "Demo",
      file_count: 2,
      analyzed_file_count: 2,
      component_count: 1,
      components: [{ name: "App", path: "src/App.tsx", props: [] }],
      dependencies: ["react"],
      tokens: [],
      framework_hints: ["React"],
      summary: "## Imported codebase context",
      files: [{ should_not: "leak into persisted context" }],
    },
    project: {
      schema_version: 1,
      name: "Demo",
      source_kind: "folder",
      files: [
        {
          path: "src/App.tsx",
          content: appContent,
          language: "typescript",
          size_bytes: new TextEncoder().encode(appContent).byteLength,
        },
      ],
      entry_path: "src/App.tsx",
      detected_stack: "react_tailwind",
      confidence: 0.96,
      reasons: ["Found React."],
      framework_hints: ["React"],
      ignored_file_count: 0,
      warnings: [],
    },
  };

  test("parses the versioned neutral shape and strips context extras", () => {
    const parsed = parseProjectImportAnalysis(response);

    expect(parsed.project.schema_version).toBe(1);
    expect(parsed.project.detected_stack).toBe(Stack.REACT_TAILWIND);
    expect(parsed.project.files[0].path).toBe("src/App.tsx");
    expect(parsed.context).not.toHaveProperty("files");
  });

  test("rejects a payload whose entry path is not present", () => {
    expect(() =>
      parseProjectImportAnalysis({
        ...response,
        project: { ...response.project, entry_path: "src/Missing.tsx" },
      })
    ).toThrow("entry_path");
  });

  test("offers a dependency-free single source file to the legacy editor", () => {
    const project = parseProjectImportAnalysis(response).project;
    expect(getLegacyEditableFile(project)?.path).toBe("src/App.tsx");
  });

  test("rejects editable payloads outside the client safety limits", () => {
    expect(() =>
      parseProjectImportAnalysis({
        ...response,
        project: {
          ...response.project,
          files: Array.from({ length: MAX_PROJECT_FILES + 1 }, (_, index) => ({
            path: `src/file-${index}.ts`,
            content: "",
            language: "typescript",
            size_bytes: 0,
          })),
          entry_path: null,
        },
      })
    ).toThrow("file-count limit");

    const oversizedContent = "x".repeat(MAX_PROJECT_FILE_BYTES + 1);
    expect(() =>
      parseProjectImportAnalysis({
        ...response,
        project: {
          ...response.project,
          files: [
            {
              path: "src/large.ts",
              content: oversizedContent,
              language: "typescript",
              size_bytes: new TextEncoder().encode(oversizedContent).byteLength,
            },
          ],
          entry_path: "src/large.ts",
        },
      })
    ).toThrow("per-file size limit");

    const fileCount = Math.floor(
      MAX_PROJECT_TOTAL_BYTES / MAX_PROJECT_FILE_BYTES
    ) + 1;
    const chunk = "x".repeat(MAX_PROJECT_FILE_BYTES);
    expect(() =>
      parseProjectImportAnalysis({
        ...response,
        project: {
          ...response.project,
          files: Array.from({ length: fileCount }, (_, index) => ({
            path: `src/chunk-${index}.ts`,
            content: chunk,
            language: "typescript",
            size_bytes: MAX_PROJECT_FILE_BYTES,
          })),
          entry_path: null,
        },
      })
    ).toThrow("aggregate source-size limit");
  });

  test("does not flatten HTML that references a local asset", () => {
    const project = parseProjectImportAnalysis(response).project;
    const content = '<link rel="stylesheet" href="styles.css"><main />';
    project.files[0] = {
      path: "index.html",
      content,
      language: "html",
      size_bytes: new TextEncoder().encode(content).byteLength,
    };
    project.entry_path = "index.html";

    expect(getLegacyEditableFile(project)).toBeNull();
  });

  test("does not flatten a multi-file or locally imported project", () => {
    const project: EditableProjectImport = {
      ...parseProjectImportAnalysis(response).project,
      files: [
        {
          ...parseProjectImportAnalysis(response).project.files[0],
          content: 'import { Card } from "./Card"; export const App = () => <Card />;',
          size_bytes: new TextEncoder().encode(
            'import { Card } from "./Card"; export const App = () => <Card />;'
          ).byteLength,
        },
      ],
    };
    expect(getLegacyEditableFile(project)).toBeNull();
  });
});