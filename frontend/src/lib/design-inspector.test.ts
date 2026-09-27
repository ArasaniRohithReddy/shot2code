import {
  designMarkdown,
  designSkillMarkdown,
  inspectDesignSource,
} from "./design-inspector";

const SOURCE = `<!doctype html>
<html>
<head>
  <style>
    :root { --brand: #6d28d9; --space: 16px; }
    body { color: #111827; font-family: Inter, sans-serif; font-size: 16px; }
    .card { padding: 16px; gap: 8px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,.1); transition: opacity 200ms; }
  </style>
</head>
<body><nav><a href="#">Home</a></nav><main><button>Save</button><img alt="" /></main></body>
</html>`;

test("extracts repeated visual tokens and semantic component counts", () => {
  const result = inspectDesignSource(SOURCE);

  expect(result.colors.map((item) => item.value)).toContain("#6d28d9");
  expect(result.customProperties).toContainEqual({
    name: "--brand",
    value: "#6d28d9",
  });
  expect(result.fontFamilies[0].value).toContain("Inter");
  expect(result.spacing.map((item) => item.value)).toEqual(
    expect.arrayContaining(["16px", "8px"])
  );
  expect(result.components).toContainEqual({ name: "button", count: 1 });
});

test("generates DESIGN.md and SKILL.md without source code", () => {
  const result = inspectDesignSource(SOURCE);
  const design = designMarkdown(result, "index.html");
  const skill = designSkillMarkdown(result, "index.html");

  expect(design).toContain("# Design System");
  expect(design).toContain("## Color Palette");
  expect(design).toContain("## Definition of Done");
  expect(design).not.toContain("<button>Save</button>");
  expect(skill).toContain("name: inspected-design-system");
  expect(skill).toContain("Use the accompanying DESIGN.md");
});
