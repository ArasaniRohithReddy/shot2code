/**
 * How a run's image results are counted and shown.
 *
 * The regression this guards is a batch where every prompt failed still
 * reading "Generated 3 images" above three blank grey tiles that said only
 * "Failed" - no reason, no guidance, and nothing a screen reader announced.
 */

jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://backend.test",
  WS_BACKEND_URL: "ws://backend.test",
}));

import { renderToStaticMarkup } from "react-dom/server";
import ImageFailureTile from "./ImageFailureTile";
import {
  countSuccessfulImages,
  describeImageOutcome,
  imageEventTitle,
  readImageItem,
  type ImageEventShape,
} from "./image-results";

function toolEvent(
  toolName: string,
  input: unknown,
  output: unknown,
  status: string = "complete"
): ImageEventShape {
  return { toolName, status, input, output };
}

const OK = { prompt: "a logo", url: "https://cdn.test/a.png", status: "ok" };
const RATE_LIMITED = {
  prompt: "a hero",
  url: null,
  status: "error",
  error: "Replicate is rate limiting or out of allocation right now.",
  errorCategory: "quota",
  action: "Wait for it to reset, or generate fewer images at once.",
};
const OUT_OF_CREDIT = {
  prompt: "a banner",
  url: null,
  status: "error",
  error: "Replicate reports no available credit for this account.",
  errorCategory: "billing",
  action: "Top it up on the provider's dashboard.",
};

describe("reading one image item", () => {
  test("a URL with an ok status is a success", () => {
    const outcome = readImageItem(OK, "url");
    expect(outcome.succeeded).toBe(true);
    expect(outcome.url).toBe("https://cdn.test/a.png");
  });

  test("an error item is never a success, and keeps its reason", () => {
    const outcome = readImageItem(RATE_LIMITED, "url");
    expect(outcome.succeeded).toBe(false);
    expect(outcome.category).toBe("quota");
    expect(outcome.error).toContain("rate limiting");
    expect(outcome.action).toContain("Wait");
  });

  test("a URL contradicted by an error status is still a failure", () => {
    const outcome = readImageItem(
      { url: "https://cdn.test/a.png", status: "error" },
      "url"
    );
    expect(outcome.succeeded).toBe(false);
  });

  test("junk is read as a failure rather than crashing", () => {
    expect(readImageItem(null, "url").succeeded).toBe(false);
    expect(readImageItem("nope", "url").succeeded).toBe(false);
    expect(readImageItem({ url: 42 }, "url").succeeded).toBe(false);
  });
});

describe("counting", () => {
  test("counts successes, not tiles", () => {
    expect(
      countSuccessfulImages({ images: [OK, RATE_LIMITED, OUT_OF_CREDIT] }, "url")
    ).toEqual({ succeeded: 1, requested: 3 });
  });

  test("an output with no images list is not counted at all", () => {
    expect(countSuccessfulImages({ error: "nope" }, "url")).toBeNull();
    expect(countSuccessfulImages(null, "url")).toBeNull();
  });
});

describe("the wording", () => {
  test("a full batch reads plainly", () => {
    expect(
      describeImageOutcome(
        { succeeded: 3, requested: 3 },
        "Generated",
        "image",
        "Could not generate images"
      )
    ).toBe("Generated 3 images");
  });

  test("a partial batch says how many of how many", () => {
    expect(
      describeImageOutcome(
        { succeeded: 2, requested: 5 },
        "Generated",
        "image",
        "Could not generate images"
      )
    ).toBe("Generated 2 of 5 images");
  });

  test("a batch with nothing to show never claims a number", () => {
    expect(
      describeImageOutcome(
        { succeeded: 0, requested: 4 },
        "Generated",
        "image",
        "Could not generate images"
      )
    ).toBe("Could not generate images");
  });
});

describe("the event title", () => {
  test("a fully failed generate_images run does not claim images", () => {
    const title = imageEventTitle(
      toolEvent(
        "generate_images",
        { prompts: ["a hero", "a banner"] },
        { images: [RATE_LIMITED, OUT_OF_CREDIT], generated: 0, requested: 2 }
      )
    );
    expect(title).toBe("Could not generate images");
  });

  test("a partial generate_images run reports the real count", () => {
    expect(
      imageEventTitle(
        toolEvent(
          "generate_images",
          { prompts: ["a logo", "a hero", "a banner"] },
          { images: [OK, RATE_LIMITED, OUT_OF_CREDIT] }
        )
      )
    ).toBe("Generated 1 of 3 images");
  });

  test("a successful run keeps the wording it always had", () => {
    expect(
      imageEventTitle(
        toolEvent("generate_images", { prompts: ["a logo"] }, { images: [OK] })
      )
    ).toBe("Generated 1 image");
  });

  test("a running run counts what was requested", () => {
    expect(
      imageEventTitle(
        toolEvent(
          "generate_images",
          { prompts: ["a logo", "a hero"] },
          null,
          "running"
        )
      )
    ).toBe("Generating 2 images");
  });

  test("remove_backgrounds counts successes too", () => {
    const images = [
      { image_url: "https://cdn.test/1.png", result_url: "https://cdn.test/o.png", status: "ok" },
      { image_url: "https://cdn.test/2.png", result_url: null, status: "error" },
    ];
    expect(
      imageEventTitle(
        toolEvent(
          "remove_backgrounds",
          { image_urls: ["https://cdn.test/1.png", "https://cdn.test/2.png"] },
          { images }
        )
      )
    ).toBe("Removed 1 of 2 backgrounds");
  });

  test("a fully failed remove_backgrounds run says so", () => {
    expect(
      imageEventTitle(
        toolEvent(
          "remove_backgrounds",
          { image_urls: ["https://cdn.test/1.png"] },
          { images: [{ image_url: "https://cdn.test/1.png", result_url: null, status: "error" }] }
        )
      )
    ).toBe("Could not remove backgrounds");
  });

  test("edit_images counts successes too", () => {
    const images = [
      { prompt: "a", result_url: "https://cdn.test/e.png", status: "ok" },
      { prompt: "b", result_url: null, status: "error" },
      { prompt: "c", result_url: null, status: "error" },
    ];
    expect(
      imageEventTitle(
        toolEvent("edit_images", { edits: [{}, {}, {}] }, { images })
      )
    ).toBe("Edited 1 of 3 images");
  });
});

describe("the failure tile", () => {
  test("announces itself and carries the reason and the action", () => {
    const html = renderToStaticMarkup(
      <ImageFailureTile
        outcome={readImageItem(RATE_LIMITED, "url")}
        label="Image 2 failed"
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-testid="image-failure"');
    expect(html).toContain('data-category="quota"');
    expect(html).toContain("Image 2 failed");
    expect(html).toContain("rate limiting");
    expect(html).toContain("Wait for it to reset");
  });

  test("still says something useful when the reason is missing", () => {
    const html = renderToStaticMarkup(
      <ImageFailureTile
        outcome={readImageItem({ url: null, status: "error" }, "url")}
        label="Image 1 failed"
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("did not return an image");
    // Never the bare, unexplained word on its own.
    expect(html).not.toMatch(/>\s*Failed\s*</);
  });

  test("does not repeat the action when it is already in the message", () => {
    const html = renderToStaticMarkup(
      <ImageFailureTile
        outcome={readImageItem(
          {
            url: null,
            status: "error",
            error: "Out of credit. Top it up on the dashboard.",
            action: "Top it up on the dashboard.",
            errorCategory: "billing",
          },
          "url"
        )}
        label="Image 1 failed"
      />
    );
    expect(html.match(/Top it up on the dashboard/g)?.length).toBe(1);
  });
});
