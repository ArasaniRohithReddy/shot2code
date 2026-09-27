jest.mock("../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import {
  FEATURED_MCP_TEMPLATES,
  isFigmaCatalogRestrictedMcpUrl,
} from "./mcp-registry";

describe("MCP registry product restrictions", () => {
  it("does not advertise Figma MCP to a client that is not catalog allowlisted", () => {
    expect(FEATURED_MCP_TEMPLATES.map((entry) => entry.id)).toEqual([
      "google-stitch",
    ]);
  });

  it("recognizes both restricted Figma MCP transports", () => {
    expect(
      isFigmaCatalogRestrictedMcpUrl("https://mcp.figma.com/mcp")
    ).toBe(true);
    expect(
      isFigmaCatalogRestrictedMcpUrl("http://127.0.0.1:3845/mcp")
    ).toBe(true);
    expect(
      isFigmaCatalogRestrictedMcpUrl("http://localhost:3845/mcp")
    ).toBe(true);
    expect(
      isFigmaCatalogRestrictedMcpUrl("https://stitch.googleapis.com/mcp")
    ).toBe(false);
  });
});
