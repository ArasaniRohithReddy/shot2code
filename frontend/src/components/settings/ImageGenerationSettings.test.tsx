/**
 * The Image Generation settings card.
 *
 * What it must never do: imply a price, promise a free allocation, offer a
 * direct provider key as a substitute for another provider's credential, or
 * suggest that background removal works anywhere but Replicate.
 */

jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://backend.test",
  WS_BACKEND_URL: "ws://backend.test",
}));

import { renderToStaticMarkup } from "react-dom/server";
import ImageGenerationSettings from "./ImageGenerationSettings";
import {
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  type ImageGenerationSettings as ImageSettings,
} from "../../lib/image-providers";

const CLOUDFLARE_ACCOUNT = "0123456789abcdef0123456789abcdef";

function render(
  overrides: Partial<ImageSettings> = {},
  props: { enabled?: boolean; replicateApiKey?: string } = {}
): string {
  return renderToStaticMarkup(
    <ImageGenerationSettings
      settings={{ ...DEFAULT_IMAGE_GENERATION_SETTINGS, ...overrides }}
      enabled={props.enabled ?? true}
      onEnabledChange={() => {}}
      onChange={() => {}}
      replicateApiKey={props.replicateApiKey ?? ""}
      validateModel={async () => {
        throw new Error("not called during render");
      }}
    />
  );
}

describe("the default state", () => {
  test("is Replicate, unchanged from before", () => {
    const html = render();
    expect(html).toContain('data-testid="image-generation-settings"');
    expect(html).toContain('value="replicate"');
    expect(html).toContain("Z-Image Turbo");
    expect(html).toContain("FLUX.2 Klein 4B");
  });

  test("says Replicate bills per use without promising a free tier", () => {
    const html = render();
    expect(html).toContain("Billed by Replicate");
    expect(html).toContain("only for what you use");
    expect(html).toContain("no free allocation");
    expect(html).not.toContain("free forever");
  });

  test("links to the provider's own pricing rather than quoting one", () => {
    expect(render()).toContain("https://replicate.com/pricing");
  });

  test("reports the missing Replicate key as the blocker", () => {
    const html = render();
    expect(html).toContain('data-testid="image-generation-blocked"');
    expect(html).toContain("Add a Replicate API key");
  });

  test("reports ready once the key is there", () => {
    const html = render({}, { replicateApiKey: "r8_key" });
    expect(html).toContain('data-testid="image-generation-ready"');
    expect(html).toContain("prunaai/z-image-turbo");
  });
});

describe("Cloudflare", () => {
  test("asks for an account id and a token, and nothing else", () => {
    const html = render({ provider: "cloudflare" });
    expect(html).toContain('data-testid="image-cloudflare-fields"');
    expect(html).toContain("Cloudflare account ID");
    expect(html).toContain("Cloudflare API token");
    expect(html).not.toContain('data-testid="image-endpoint-fields"');
  });

  test("describes the free allocation as Cloudflare's, on both plans, and changeable", () => {
    const html = render({
      provider: "cloudflare",
      model: "@cf/black-forest-labs/flux-1-schnell",
    });
    // Verified against Cloudflare's own pricing page. The previous copy said
    // the allocation was "on the Workers Free plan"; it is 10,000 Neurons a
    // day on Free *and* Paid, resetting at 00:00 UTC.
    expect(html).toContain("your Cloudflare account");
    expect(html).toContain("10,000 Neurons");
    expect(html).toContain("both the Workers Free and Workers Paid plans");
    expect(html).toContain("00:00 UTC");
    expect(html).toContain("$0.011 per 1,000 ");
    expect(html).toContain("paid billing method");
    expect(html).toContain("can change");
    expect(html).not.toContain("on the Workers Free plan");
    expect(html).not.toContain("free forever");
    expect(html).not.toContain("always free");
    expect(html).not.toContain("unlimited");
  });

  test("shows the model's own published rate next to the allocation", () => {
    const html = render({
      provider: "cloudflare",
      model: "@cf/black-forest-labs/flux-1-schnell",
    });
    expect(html).toContain("4.80 neurons per 512x512 tile");
    expect(html).toContain("9.60 neurons per step");
    expect(html).toContain("4 steps");
  });

  test("the token field is a password field that is never autofilled", () => {
    const html = render({ provider: "cloudflare" });
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('spellcheck="false"');
  });

  test("a configured connection reports ready", () => {
    const html = render({
      provider: "cloudflare",
      model: "@cf/black-forest-labs/flux-1-schnell",
      cloudflareAccountId: CLOUDFLARE_ACCOUNT,
      cloudflareApiToken: "cf-token",
    });
    expect(html).toContain('data-testid="image-generation-ready"');
  });

  test("a model that cannot belong to this provider is not claimed", () => {
    // A stale stored blob could pair Cloudflare with a Replicate model id;
    // showing "Cloudflare Workers AI using prunaai/z-image-turbo" would be a
    // lie, so the provider's own default is what is offered and reported.
    const html = render({
      provider: "cloudflare",
      model: "prunaai/z-image-turbo",
      cloudflareAccountId: CLOUDFLARE_ACCOUNT,
      cloudflareApiToken: "cf-token",
    });
    expect(html).not.toContain("prunaai/z-image-turbo");
    expect(html).toContain("@cf/black-forest-labs/flux-1-schnell");
    expect(html).toContain("your Cloudflare account");
  });
});

describe("an OpenAI-compatible endpoint", () => {
  test("asks for a base URL and its own key", () => {
    const html = render({ provider: "openai-compatible" });
    expect(html).toContain('data-testid="image-endpoint-fields"');
    expect(html).toContain("Endpoint base URL");
    expect(html).toContain("Endpoint API key");
  });

  test("says the OpenAI key is not reused here", () => {
    const html = render({ provider: "openai-compatible" });
    expect(html).toContain("your OpenAI key is never reused here");
  });

  test("explains that editing depends on the endpoint", () => {
    const html = render({ provider: "openai-compatible" });
    expect(html).toContain("/images/edits");
    expect(html).toContain("when the server");
  });

  test("shows the endpoint error the backend would also raise", () => {
    const html = render({
      provider: "openai-compatible",
      openAiImageBaseUrl: "http://images.example.com/v1",
    });
    expect(html).toContain('data-testid="image-endpoint-error"');
    expect(html).toContain("https");
  });

  test("a localhost endpoint is ready without a key", () => {
    const html = render({
      provider: "openai-compatible",
      openAiImageBaseUrl: "http://localhost:8000/v1",
    });
    expect(html).toContain('data-testid="image-generation-ready"');
  });

  test("a remote endpoint without a key is blocked", () => {
    const html = render({
      provider: "openai-compatible",
      openAiImageBaseUrl: "https://images.example.com/v1",
    });
    expect(html).toContain('data-testid="image-generation-blocked"');
    expect(html).toContain("own API key");
  });
});

describe("background removal", () => {
  test("is called out as Replicate-only when no Replicate key exists", () => {
    const html = render({ provider: "cloudflare" });
    expect(html).toContain('data-testid="image-background-removal-notice"');
    expect(html).toContain("Background removal runs on Replicate only");
    expect(html).toContain("no other provider");
  });

  test("the notice disappears once a Replicate key is present", () => {
    const html = render(
      { provider: "cloudflare" },
      { replicateApiKey: "r8_key" }
    );
    expect(html).not.toContain('data-testid="image-background-removal-notice"');
  });
});

describe("a custom Replicate model", () => {
  test("is only offered for Replicate", () => {
    expect(render()).toContain("Another Replicate model");
    expect(render({ provider: "cloudflare" })).not.toContain(
      "Another Replicate model"
    );
  });

  test("explains why a schema check is needed instead of just trusting it", () => {
    const html = render({ provider: "replicate", model: "someone/their-model" });
    expect(html).toContain('data-testid="image-custom-model"');
    expect(html).toContain("do not share one input schema");
    expect(html).toContain("own schema from Replicate");
    expect(html).toContain('data-testid="image-model-check"');
  });

  test("refuses a malformed id before any request is made", () => {
    const html = render({ provider: "replicate", model: "no-slash" });
    expect(html).toContain('data-testid="image-model-error"');
    expect(html).toContain("owner/name");
  });

  test("the check button is disabled without a Replicate key", () => {
    const html = render({ provider: "replicate", model: "someone/their-model" });
    expect(html).toContain("disabled");
    expect(html).toContain("Add a Replicate API key above first");
  });
});

describe("accessibility", () => {
  test("the enable switch is labelled", () => {
    expect(render()).toContain('aria-label="Generate placeholder images"');
  });

  test("status changes are announced", () => {
    expect(render()).toContain('aria-live="polite"');
  });

  test("a blocked state is an alert, not just red text", () => {
    expect(render()).toContain('role="alert"');
  });
});
