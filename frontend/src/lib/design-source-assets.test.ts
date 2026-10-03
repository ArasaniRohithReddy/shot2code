import { createProjectFile } from "./project-files";
import {
  readDesignSourceAssets,
  sourceAssetsFromProjectFiles,
} from "./design-source-assets";

test("reads only complete Figma and Stitch source assets", () => {
  expect(
    readDesignSourceAssets([
      {
        name: "logo.png",
        url: "http://127.0.0.1:7001/local-assets/logo.png",
        mimeType: "image/png",
        source: "figma",
        kind: "image fill",
      },
      { name: "broken" },
    ])
  ).toEqual([
    {
      name: "logo.png",
      url: "http://127.0.0.1:7001/local-assets/logo.png",
      mimeType: "image/png",
      source: "figma",
      kind: "image fill",
    },
  ]);
});

test("restores reusable assets from imported project file metadata", () => {
  const files = {
    "assets/hero.png": createProjectFile("assets/hero.png", "cG5n", {
      metadata: {
        encoding: "base64",
        mimeType: "image/png",
        designSource: "stitch",
        sourceAssetName: "hero.png",
        sourceAssetKind: "image",
        sourceAssetUrl:
          "http://127.0.0.1:7001/local-assets/asset_hero.png",
      },
    }),
  };

  expect(sourceAssetsFromProjectFiles(files)).toEqual([
    {
      name: "hero.png",
      url: "http://127.0.0.1:7001/local-assets/asset_hero.png",
      mimeType: "image/png",
      source: "stitch",
      kind: "image",
    },
  ]);
});
