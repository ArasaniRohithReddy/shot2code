import { createStitchDesignProject, normalizeDesignProject } from "./design-project-import";

test("turns a Stitch response into an editable project with binary metadata", () => {
  const sourceAsset = {
    name: "hero.png",
    url: "http://127.0.0.1:7001/local-assets/asset_hero.png",
    mimeType: "image/png",
    source: "stitch" as const,
    kind: "image",
  };
  const project = createStitchDesignProject(
    {
      projectId: "project-1",
      screenId: "screen-1",
      html: '<main><img src="assets/hero.png"></main>',
      image: "data:image/png;base64,cHJldmlldw==",
      assets: [
        {
          path: "assets/hero.png",
          mimeType: "image/png",
          size: 3,
          encoding: "base64",
          content: "cG5n",
          sourceUrl: "https://example.com/hero.png",
          kind: "image",
        },
      ],
      designMd: "# Design",
      warnings: [],
    },
    "Storefront",
    [sourceAsset]
  );
  const normalized = normalizeDesignProject(project);

  expect(normalized.entryPoint).toBe("index.html");
  expect(normalized.files["DESIGN.md"].content).toBe("# Design");
  expect(normalized.files["assets/hero.png"].metadata).toEqual(
    expect.objectContaining({
      encoding: "base64",
      mimeType: "image/png",
      sourceAssetUrl: sourceAsset.url,
    })
  );
  expect(normalized.files["STITCH-IMPORT.md"].content).toContain(
    "Reusable images: 1"
  );
});
