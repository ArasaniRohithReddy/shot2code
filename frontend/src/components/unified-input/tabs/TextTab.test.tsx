jest.mock("../../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { Stack } from "../../../lib/stacks";
import StitchGenerationStatus from "./StitchGenerationStatus";
import { GenerationModelSelection } from "./TextTab";
import { usesDirectStitchOutput } from "./stitch-output-mode";

describe("Stitch generation status", () => {
  it("shows the real phase, elapsed time, and non-percentage guidance", () => {
    const html = renderToStaticMarkup(
      <StitchGenerationStatus
        phase="generating-screen"
        message="Stitch is generating the screen. This can take several minutes…"
        elapsedSeconds={83}
      />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Step 3 of 5");
    expect(html).toContain("1m 23s");
    expect(html).toContain("Generate screen");
    expect(html).toContain("Stitch does not provide a percentage");
  });

  describe("Stitch output mode", () => {
    it("keeps the dedicated Stitch tab direct by default", () => {
      expect(
        usesDirectStitchOutput(true, "stitch", Stack.REACT_TAILWIND)
      ).toBe(true);
    });

    it("converts only when the user explicitly selects conversion", () => {
      expect(
        usesDirectStitchOutput(true, "convert", Stack.REACT_TAILWIND)
      ).toBe(false);
      expect(
        usesDirectStitchOutput(false, "convert", Stack.HTML_CSS)
      ).toBe(true);
    });
  });

  it("labels the conversion picker and keeps it visible when no provider is ready", () => {
    const html = renderToStaticMarkup(
      <GenerationModelSelection
        stitchOnly
        modelSelector={{
          selectedModels: [],
          setSelectedModels: jest.fn(),
        }}
      />
    );

    expect(html).toContain("Models for conversion");
    expect(html).toContain("vision-capable models");
    expect(html).toContain("Configure models");
  });

  it("marks earlier steps as complete when output is downloading", () => {
    const html = renderToStaticMarkup(
      <StitchGenerationStatus
        phase="downloading-output"
        message="Downloading the generated HTML and preview image…"
        elapsedSeconds={240}
      />
    );

    expect(html).toContain("Step 4 of 5");
    expect(html).toContain("4m 00s");
    expect(html.match(/<svg/g)).toHaveLength(4);
  });
});
