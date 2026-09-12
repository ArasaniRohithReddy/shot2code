import { buildGenerationContext } from "./project-context-summary";
import { ProjectContext } from "../types";

const context: ProjectContext = {
  name: "acme-ui",
  file_count: 12,
  analyzed_file_count: 10,
  component_count: 2,
  components: [],
  dependencies: ["react"],
  tokens: ["--color-primary: #4f46e5"],
  framework_hints: ["React"],
  summary: "## Imported codebase context\n\nProject: acme-ui",
};

describe("buildGenerationContext", () => {
  test("combines a manual design system with imported context", () => {
    expect(buildGenerationContext("Use rounded buttons.", context)).toBe(
      "Use rounded buttons.\n\n## Imported codebase context\n\nProject: acme-ui"
    );
  });

  test("works with imported context alone", () => {
    expect(buildGenerationContext(null, context)).toBe(context.summary);
  });

  test("returns null when no context exists", () => {
    expect(buildGenerationContext("  ", null)).toBeNull();
  });
});
