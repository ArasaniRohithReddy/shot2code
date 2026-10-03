import { renderToStaticMarkup } from "react-dom/server";
import WebsiteDesignInspectionResult from "./WebsiteDesignInspectionResult";

test("shows bounded website evidence and DESIGN.md actions", () => {
  const html = renderToStaticMarkup(
    <WebsiteDesignInspectionResult
      result={{
        url: "https://example.com",
        title: "Example",
        description: "Example site",
        lang: "en",
        inspection: {
          colors: [{ value: "rgb(0, 0, 0)", count: 3 }],
          customProperties: [{ name: "--ink", value: "#000" }],
          fontFamilies: [{ value: "Inter", count: 2 }],
          fontSizes: [],
          fontWeights: [],
          lineHeights: [],
          spacing: [],
          radii: [],
          shadows: [],
          motion: [],
          components: [{ name: "main", count: 1 }],
        },
        accessibility: {
          headings: [{ level: 1, text: "Example" }],
          roles: [{ value: "main", count: 1 }],
          landmarks: { main: 1 },
          imagesWithoutAlt: 0,
          unlabeledControls: 0,
        },
        assets: ["https://example.com/hero.png"],
        screenshots: {
          desktop: "data:image/png;base64,desktop",
          tablet: "data:image/png;base64,tablet",
          mobile: "data:image/png;base64,mobile",
        },
        requestCount: 12,
      }}
      onUse={jest.fn()}
    />
  );

  expect(html).toContain("Website design inspection");
  expect(html).toContain("12 bounded requests");
  expect(html).toContain("Use screenshots + DESIGN.md");
  expect(html).toContain("Download DESIGN.md");
});
