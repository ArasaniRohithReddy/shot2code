jest.mock("../../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { Stack } from "../../../lib/stacks";
import FigmaTab from "./FigmaTab";

const designSystem = {
  designSystems: [],
  selectedDesignSystemId: null,
  setSelectedDesignSystemId: jest.fn(),
  onAddNew: jest.fn(),
  onManage: jest.fn(),
};

describe("Figma input tab", () => {
  it("offers an explicit REST path when a personal access token is configured", () => {
    const html = renderToStaticMarkup(
      <FigmaTab
        doCreate={jest.fn()}
        figmaAccessToken="figd_example"
        stack={Stack.REACT_TAILWIND}
        setStack={jest.fn()}
        designSystem={designSystem}
      />
    );

    expect(html).toContain("Import from Figma");
    expect(html).toContain("REST frame import");
    expect(html).toContain("Figma MCP Catalog");
    expect(html).toContain("Preview Figma frames");
    expect(html).toContain("Render Figma &amp; Generate");
    expect(html).toContain("does not provide a general REST client SDK");
  });

  it("does not imply that an unconfigured integration is ready", () => {
    const html = renderToStaticMarkup(
      <FigmaTab
        doCreate={jest.fn()}
        figmaAccessToken={null}
        stack={Stack.HTML_CSS}
        setStack={jest.fn()}
        designSystem={designSystem}
      />
    );

    expect(html).toContain("Add a Figma personal access token in Settings");
    expect(html).toContain("not currently allowlisted");
    expect(html).toContain("disabled");
  });
});
