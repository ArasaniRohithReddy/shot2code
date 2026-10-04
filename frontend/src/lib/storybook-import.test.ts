jest.mock("../config", () => ({ HTTP_BACKEND_URL: "http://localhost" }));

import {
  MAX_STORYBOOK_FILE_BYTES,
  normalizePublicStorybookUrl,
  parseStorybookImportAnalysis,
  prepareStorybookMetadataFiles,
  type StorybookSourceFileLike,
} from "./storybook-import";

function sourceFile(
  path: string,
  content: string,
  arrayBuffer = jest.fn(async () => {
    const bytes = new TextEncoder().encode(content);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
  }),
  size = new TextEncoder().encode(content).byteLength
): StorybookSourceFileLike {
  const parts = path.split("/");
  return {
    name: parts[parts.length - 1],
    webkitRelativePath: path,
    size,
    arrayBuffer,
    text: jest.fn(async () => content),
  };
}

const index = JSON.stringify({
  v: 5,
  entries: {
    "button--primary": {
      type: "story",
      id: "button--primary",
      name: "Primary",
      title: "Button",
      importPath: "./Button.stories.tsx",
    },
  },
});

const context = {
  name: "Acme UI",
  file_count: 2,
  analyzed_file_count: 2,
  component_count: 1,
  components: [
    { name: "Button", path: "storybook://component/button", props: ["tone"] },
  ],
  dependencies: [],
  tokens: [],
  framework_hints: ["Storybook", "React"],
  summary: "## Built Storybook component-library context",
  raw_files: [{ secret: "must not persist" }],
};

describe("prepareStorybookMetadataFiles", () => {
  test("reads only fixed JSON metadata and leaves stories, bundles and iframe inert", async () => {
    const indexReader = jest.fn(async () => new TextEncoder().encode(index).buffer);
    const componentContent = JSON.stringify({ v: 0, components: {} });
    const componentsReader = jest.fn(
      async () => new TextEncoder().encode(componentContent).buffer
    );
    const iframeReader = jest.fn(async () => new ArrayBuffer(0));
    const bundleReader = jest.fn(async () => new ArrayBuffer(0));
    const storyReader = jest.fn(async () => new ArrayBuffer(0));

    const prepared = await prepareStorybookMetadataFiles(
      [
        sourceFile("storybook-static/index.json", index, indexReader),
        sourceFile(
          "storybook-static/manifests/components.json",
          componentContent,
          componentsReader
        ),
        sourceFile("storybook-static/iframe.html", "execute()", iframeReader),
        sourceFile("storybook-static/assets/preview.js", "execute()", bundleReader),
        sourceFile(
          "storybook-static/src/Button.stories.tsx",
          "execute()",
          storyReader
        ),
      ],
      "folder"
    );

    expect(prepared.name).toBe("storybook-static");
    expect(prepared.metadataFileCount).toBe(2);
    expect(prepared.files).toEqual([
      { path: "storybook-static/index.json", content: index },
      {
        path: "storybook-static/manifests/components.json",
        content: componentContent,
      },
      { path: "storybook-static/iframe.html", content: "" },
      { path: "storybook-static/assets/preview.js", content: "" },
      { path: "storybook-static/src/Button.stories.tsx", content: "" },
    ]);
    expect(indexReader).toHaveBeenCalledTimes(1);
    expect(componentsReader).toHaveBeenCalledTimes(1);
    expect(iframeReader).not.toHaveBeenCalled();
    expect(bundleReader).not.toHaveBeenCalled();
    expect(storyReader).not.toHaveBeenCalled();
  });

  test("accepts direct index/components/docs file selection", async () => {
    const prepared = await prepareStorybookMetadataFiles(
      [
        sourceFile("index.json", index),
        sourceFile("components.json", JSON.stringify({ v: 0, components: {} })),
        sourceFile("docs.json", JSON.stringify({ v: 1, docs: {} })),
      ],
      "files"
    );

    expect(prepared.metadataFileCount).toBe(3);
  });

  test("rejects case collisions, missing index and oversized metadata before reading", async () => {
    await expect(
      prepareStorybookMetadataFiles(
        [sourceFile("index.json", index), sourceFile("INDEX.JSON", index)],
        "files"
      )
    ).rejects.toThrow("duplicate path");

    await expect(
      prepareStorybookMetadataFiles(
        [sourceFile("components.json", JSON.stringify({ v: 0, components: {} }))],
        "files"
      )
    ).rejects.toThrow("requires index.json");

    const reader = jest.fn(async () => new ArrayBuffer(0));
    await expect(
      prepareStorybookMetadataFiles(
        [sourceFile("index.json", index, reader, MAX_STORYBOOK_FILE_BYTES + 1)],
        "files"
      )
    ).rejects.toThrow("too large");
    expect(reader).not.toHaveBeenCalled();
  });
});

describe("parseStorybookImportAnalysis", () => {
  test("keeps only the closed ProjectContext and Storybook response fields", () => {
    const parsed = parseStorybookImportAnalysis({
      context,
      source_kind: "folder",
      metadata_files: ["index.json", "manifests/components.json"],
      story_count: 3,
      docs_count: 1,
      warnings: ["Preview schema"],
      bearerToken: "must not persist",
    });

    expect(parsed.context).not.toHaveProperty("raw_files");
    expect(parsed).not.toHaveProperty("bearerToken");
    expect(parsed.context.components[0].path).toBe(
      "storybook://component/button"
    );
  });

  test("rejects unsupported response paths and kinds", () => {
    expect(() =>
      parseStorybookImportAnalysis({
        context,
        source_kind: "iframe",
        metadata_files: ["index.json"],
        story_count: 0,
        docs_count: 0,
        warnings: [],
      })
    ).toThrow("source_kind");

    expect(() =>
      parseStorybookImportAnalysis({
        context,
        source_kind: "files",
        metadata_files: ["iframe.html"],
        story_count: 0,
        docs_count: 0,
        warnings: [],
      })
    ).toThrow("metadata_files");
  });
});

describe("normalizePublicStorybookUrl", () => {
  test("normalizes a public HTTPS root", () => {
    expect(normalizePublicStorybookUrl("https://ui.example.com/storybook#button")).toBe(
      "https://ui.example.com/storybook/"
    );
  });

  test.each([
    "http://ui.example.com/storybook/",
    "https://ui.example.com/storybook/?token=secret",
    "https://ui.example.com:8443/storybook/",
    "https://ui.example.com/storybook/iframe.html",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => normalizePublicStorybookUrl(url)).toThrow();
  });
});
