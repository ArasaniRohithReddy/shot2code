jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { createProjectFile } from "../../lib/project-files";
import {
  createProjectBackupJson,
  getProjectFileDownloadName,
} from "./download";

describe("project downloads", () => {
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
});
