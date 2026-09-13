import {
  buildProjectTree,
  createProjectPreviewArtifact,
  type ProjectTreeNode,
} from "../lib/project-files";
import {
  createProjectStateFromImport,
  detectStackFromSource,
  parseProjectImportAnalysis,
} from "../lib/project-import";
import { Stack } from "../lib/stacks";
import { createCodePenShareResult } from "../components/preview/codepen";
import { STACK_ACCEPTANCE_FIXTURES } from "./stack-acceptance.fixtures";

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function importedResponse(fixture: (typeof STACK_ACCEPTANCE_FIXTURES)[number]) {
  const files = Object.entries(fixture.project.files).map(([path, content]) => ({
    path,
    content,
    language: fixture.project.expectedLanguages[path],
    size_bytes: byteLength(content),
  }));

  return {
    context: {
      name: fixture.name,
      file_count: files.length,
      analyzed_file_count: files.length,
      component_count: 0,
      components: [],
      dependencies: [],
      tokens: [],
      framework_hints: [],
      summary: "## Imported codebase context",
    },
    project: {
      schema_version: 1,
      name: fixture.name,
      source_kind: "zip",
      files,
      entry_path: fixture.project.entryPath,
      detected_stack: fixture.stack,
      confidence: 0.99,
      reasons: [`Detected ${fixture.stack}.`],
      framework_hints: [],
      ignored_file_count: 0,
      warnings: [],
    },
  };
}

function collectTreePaths(nodes: ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === "file" ? [node.path] : collectTreePaths(node.children)
  );
}

describe("12-stack acceptance matrix", () => {
  it("covers every public stack exactly once", () => {
    expect(STACK_ACCEPTANCE_FIXTURES.map((fixture) => fixture.stack)).toEqual(
      Object.values(Stack)
    );
    expect(new Set(STACK_ACCEPTANCE_FIXTURES.map((fixture) => fixture.stack)).size)
      .toBe(12);
  });

  test.each(STACK_ACCEPTANCE_FIXTURES)(
    "$name generated HTML is detected and has an honest CodePen payload",
    (fixture) => {
      expect(detectStackFromSource(fixture.generatedHtml).stack).toBe(
        fixture.stack
      );

      const artifact = createProjectPreviewArtifact({
        code: fixture.generatedHtml,
      });
      expect(artifact.kind).toBe("html-entry");
      expect(artifact.omittedFilePaths).toEqual([]);
      expect(
        createCodePenShareResult({ stack: fixture.stack, artifact }).kind
      ).toBe("ready");
    }
  );

  test.each(STACK_ACCEPTANCE_FIXTURES)(
    "$name import keeps the complete editable tree and preview contract",
    (fixture) => {
      const imported = parseProjectImportAnalysis(importedResponse(fixture));
      const project = createProjectStateFromImport(imported.project);
      const expectedPaths = Object.keys(fixture.project.files).sort((a, b) =>
        a.localeCompare(b)
      );

      expect(imported.project.detected_stack).toBe(fixture.stack);
      expect(project.entryPoint).toBe(fixture.project.entryPath);
      expect(project.activeFilePath).toBe(fixture.project.entryPath);
      expect(Object.keys(project.files).sort((a, b) => a.localeCompare(b))).toEqual(
        expectedPaths
      );
      expect(
        collectTreePaths(buildProjectTree(project.files)).sort((a, b) =>
          a.localeCompare(b)
        )
      ).toEqual(expectedPaths);

      for (const path of expectedPaths) {
        expect(project.files[path]).toMatchObject({
          path,
          content: fixture.project.files[path],
          language: fixture.project.expectedLanguages[path],
        });
        expect(project.files[path].readonly).not.toBe(true);
        expect(project.files[path].metadata).toEqual({
          importedLanguage: fixture.project.expectedLanguages[path],
          importedSizeBytes: byteLength(fixture.project.files[path]),
        });
      }

      const artifact = createProjectPreviewArtifact(project);
      expect(artifact.kind).toBe(fixture.project.expectedPreviewKind);
      expect(artifact.sourcePath).toBe("index.html");

      const codePen = createCodePenShareResult({
        stack: fixture.stack,
        artifact,
      });
      expect(codePen.kind).toBe(fixture.project.expectedCodePenKind);

      if (fixture.project.expectedPreviewKind === "html-entry") {
        expect(artifact.inlinedFilePaths).toEqual([
          "script.js",
          "styles.css",
        ]);
        expect(artifact.omittedFilePaths).toEqual([]);
        expect(codePen.kind).toBe("ready");
      } else {
        expect(artifact.omittedFilePaths).toContain(
          fixture.project.expectedOmittedRuntimePath
        );
        expect(artifact.html).toContain(
          `shot2code preview omitted runtime script ${fixture.project.expectedOmittedRuntimePath}`
        );
        expect(codePen).toMatchObject({
          kind: "unsupported",
          reason: "fallback-preview",
          paths: [fixture.project.entryPath],
        });
      }
    }
  );
});
