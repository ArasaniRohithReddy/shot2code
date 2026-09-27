import { renderToStaticMarkup } from "react-dom/server";
import StitchGenerationStatus from "./StitchGenerationStatus";

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
