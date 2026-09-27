jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { createProjectFile } from "../../lib/project-files";
import {
  createProjectBackupJson,
  getProjectFileDownloadName,
  loadExportPreview,
} from "./download";

describe("project downloads", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
    Reflect.deleteProperty(globalThis, "window");
  });

  it("preserves every path and source body in the JSON fallback", () => {
    const backup = JSON.parse(
      createProjectBackupJson({
        entryPoint: "src/App.tsx",
        files: [
          createProjectFile("index.html", '<div id="root"></div>'),
          createProjectFile(
            "src/App.tsx",
            "export const App = () => <main />;"
          ),
        ],
      })
    );

    expect(backup).toMatchObject({
      schemaVersion: 1,
      entryPoint: "src/App.tsx",
    });
    expect(backup.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "index.html",
          content: '<div id="root"></div>',
        }),
        expect.objectContaining({
          path: "src/App.tsx",
          content: "export const App = () => <main />;",
        }),
      ])
    );
  });

  it("retains nested path context in an individual download name", () => {
    expect(getProjectFileDownloadName("src/components/App.tsx")).toBe(
      "src__components__App.tsx"
    );
  });

  it("loads the export projection as read-only project files", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { href: "http://localhost:5173/" } },
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entryPoint: "index.html",
        projectKind: "vite_react",
        files: [
          { path: "index.html", content: "<main></main>" },
          { path: "src/App.jsx", content: "export default function App() {}" },
        ],
        assets: [
          {
            path: "assets/logo.png",
            size: 5,
            mimeType: "image/png",
            contentBase64: "aGVsbG8=",
          },
        ],
      }),
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    });

    const preview = await loadExportPreview("<main></main>", {
      stack: "react_tailwind",
      project: {
        entryPoint: "index.html",
        files: [createProjectFile("index.html", "<main></main>")],
      },
    });

    expect(preview).toMatchObject({
      entryPoint: "index.html",
      projectKind: "vite_react",
      assets: [
        expect.objectContaining({
          path: "assets/logo.png",
          size: 5,
          mimeType: "image/png",
        }),
      ],
    });
    expect(preview.files["src/App.jsx"]).toMatchObject({
      path: "src/App.jsx",
      content: "export default function App() {}",
      readonly: true,
      generated: true,
      metadata: { exportPreview: true },
    });
    expect(preview.runtimeFiles["assets/logo.png"]).toMatchObject({
      path: "assets/logo.png",
      content: "aGVsbG8=",
      readonly: true,
      metadata: {
        binaryAsset: true,
        encoding: "base64",
        mimeType: "image/png",
        byteSize: 5,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:7001/api/export/preview",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toMatchObject({
      code: "<main></main>",
      baseUrl: "http://localhost:5173/",
      splitFiles: true,
      stack: "react_tailwind",
      project: { entryPoint: "index.html" },
    });
  });
});
