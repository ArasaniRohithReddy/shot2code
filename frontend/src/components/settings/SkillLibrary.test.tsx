jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import SkillLibrary from "./SkillLibrary";

test("renders installed skills with provenance and safe execution wording", () => {
  const html = renderToStaticMarkup(
    <SkillLibrary
      initialSkills={[
        {
          name: "accessible-ui",
          description: "Build accessible interfaces.",
          license: "MIT",
          compatibility: null,
          source:
            "https://github.com/example/skills/tree/main/accessible-ui",
          enabled: false,
          fileCount: 3,
          hasScripts: true,
        },
      ]}
    />
  );

  expect(html).toContain("accessible-ui");
  expect(html).toContain("disabled after import");
  expect(html).toContain("never enables shell tools");
  expect(html).toContain("contains scripts (not executable)");
  expect(html).toContain("Browse community skills");
});
