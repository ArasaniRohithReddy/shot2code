/**
 * Image providers, mirrored from the backend.
 *
 * These lock the three things the UI must not get wrong: Replicate stays the
 * default and untouched, only checked models are offered, and the wording
 * around cost and free allocations makes no promise the provider has not.
 */

import {
  BUILT_IN_IMAGE_MODELS,
  CLOUDFLARE_ALLOCATION_NOTE,
  CLOUDFLARE_FLUX_SCHNELL_MODEL,
  CLOUDFLARE_PRICING_CHECKED,
  CUSTOM_MODEL_EXPLANATION,
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  DEFAULT_IMAGE_PROVIDER,
  FLUX_2_KLEIN_MODEL,
  IMAGE_PROVIDERS,
  Z_IMAGE_TURBO_MODEL,
  defaultModelFor,
  imageGenerationBlockedReason,
  isBackgroundRemovalUsable,
  isBuiltInImageModel,
  isImageGenerationUsable,
  isLoopbackImageEndpoint,
  modelsForProvider,
  normalizeImageGenerationSettings,
  parseImageModelValidation,
  stripImageGenerationSecrets,
  supportsBackgroundRemoval,
  supportsCustomModels,
  toImageGenerationWirePayload,
  validateImageEndpointUrl,
  validateImageModelId,
  type ImageGenerationSettings,
} from "./image-providers";

const CLOUDFLARE_ACCOUNT = "0123456789abcdef0123456789abcdef";

function imageSettings(
  overrides: Partial<ImageGenerationSettings> = {}
): ImageGenerationSettings {
  return { ...DEFAULT_IMAGE_GENERATION_SETTINGS, ...overrides };
}

describe("the catalog", () => {
  test("defaults to Replicate with the model shot2code has always used", () => {
    expect(DEFAULT_IMAGE_PROVIDER).toBe("replicate");
    expect(DEFAULT_IMAGE_GENERATION_SETTINGS.provider).toBe("replicate");
    expect(DEFAULT_IMAGE_GENERATION_SETTINGS.model).toBe(Z_IMAGE_TURBO_MODEL);
  });

  test("offers both validated Replicate models", () => {
    expect(modelsForProvider("replicate").map((model) => model.id)).toEqual([
      Z_IMAGE_TURBO_MODEL,
      FLUX_2_KLEIN_MODEL,
    ]);
  });

  test("every model carries cost wording and a pricing link", () => {
    for (const model of BUILT_IN_IMAGE_MODELS) {
      expect(model.costNote.trim().length).toBeGreaterThan(0);
      expect(model.pricingUrl.startsWith("https://")).toBe(true);
    }
  });

  test("no model is described as permanently free", () => {
    const forbidden = [
      "free forever",
      "always free",
      "permanently free",
      "unlimited",
      "completely free",
    ];
    for (const model of BUILT_IN_IMAGE_MODELS) {
      const lowered = model.costNote.toLowerCase();
      for (const phrase of forbidden) {
        expect(lowered).not.toContain(phrase);
      }
    }
  });

  test("a quoted figure is always dated and marked changeable", () => {
    for (const model of BUILT_IN_IMAGE_MODELS) {
      if (!model.costNote.includes("$")) continue;
      const lowered = model.costNote.toLowerCase();
      expect(lowered).toContain("checked");
      expect(lowered).toContain("can change");
    }
  });

  test("Cloudflare's allocation matches its published terms", () => {
    // Verified against developers.cloudflare.com/workers-ai/platform/pricing.
    // An earlier version said "Workers Free plan", which was wrong: the
    // 10,000 Neurons a day apply to Free *and* Paid.
    const lowered = CLOUDFLARE_ALLOCATION_NOTE.toLowerCase();
    expect(lowered).toContain("10,000 neurons");
    expect(lowered).toContain("both the workers free and workers paid plans");
    expect(lowered).toContain("00:00 utc");
    expect(lowered).toContain("$0.011 per 1,000 neurons");
    expect(lowered).toContain("paid billing method");
    expect(lowered).toContain("your cloudflare account");
    expect(lowered).toContain("can change");
    expect(CLOUDFLARE_ALLOCATION_NOTE).toContain(CLOUDFLARE_PRICING_CHECKED);
  });

  test("the old Free-plan-only claim cannot come back", () => {
    const lowered = CLOUDFLARE_ALLOCATION_NOTE.toLowerCase();
    expect(lowered).not.toContain("on the workers free plan");
    expect(lowered).not.toContain("free plan only");
  });

  test("Replicate's note does not imply a free tier", () => {
    for (const model of modelsForProvider("replicate")) {
      const lowered = model.costNote.toLowerCase();
      expect(lowered).toContain("no free allocation");
      expect(lowered).toContain("only for what you use");
      expect(model.pricingUrl).toBe("https://replicate.com/pricing");
    }
  });

  test("no unverifiable free backend is offered", () => {
    // Hugging Face's free credit is nominal, Gemini's unpaid tier allows
    // training on content and is paid-only in some regions, and Pollinations
    // publishes no quota. None of them is listed.
    const listed = new Set(BUILT_IN_IMAGE_MODELS.map((model) => model.provider));
    expect([...listed].sort()).toEqual([
      "cloudflare",
      "openai-compatible",
      "replicate",
    ]);
    for (const model of BUILT_IN_IMAGE_MODELS) {
      const blob = `${model.id} ${model.label} ${model.costNote}`.toLowerCase();
      for (const absent of ["hugging face", "huggingface", "pollinations"]) {
        expect(blob).not.toContain(absent);
      }
    }
  });

  test("background removal is Replicate-only", () => {
    expect(supportsBackgroundRemoval("replicate")).toBe(true);
    expect(supportsBackgroundRemoval("cloudflare")).toBe(false);
    expect(supportsBackgroundRemoval("openai-compatible")).toBe(false);
  });

  test("only Replicate accepts a model outside the list", () => {
    expect(supportsCustomModels("replicate")).toBe(true);
    expect(supportsCustomModels("cloudflare")).toBe(false);
    expect(supportsCustomModels("openai-compatible")).toBe(false);
  });

  test("the custom-model explanation says why a check is needed", () => {
    expect(CUSTOM_MODEL_EXPLANATION).toContain("do not share one input");
    expect(CUSTOM_MODEL_EXPLANATION).toContain("own schema");
  });

  test("every provider has a default model of its own shape", () => {
    for (const provider of IMAGE_PROVIDERS) {
      expect(defaultModelFor(provider)).toBeTruthy();
    }
    expect(defaultModelFor("cloudflare")).toBe(CLOUDFLARE_FLUX_SCHNELL_MODEL);
  });

  test("a model id belongs to exactly one provider", () => {
    expect(isBuiltInImageModel("replicate", Z_IMAGE_TURBO_MODEL)).toBe(true);
    expect(isBuiltInImageModel("cloudflare", Z_IMAGE_TURBO_MODEL)).toBe(false);
  });
});

describe("endpoint validation", () => {
  test("accepts https and loopback http", () => {
    expect(validateImageEndpointUrl("https://images.example.com/v1")).toBeNull();
    expect(validateImageEndpointUrl("http://localhost:8000/v1")).toBeNull();
    expect(validateImageEndpointUrl("http://127.0.0.1:8000/v1")).toBeNull();
  });

  test("refuses plaintext http that leaves the machine", () => {
    expect(validateImageEndpointUrl("http://images.example.com/v1")).toContain(
      "https"
    );
  });

  test.each([
    ["ftp://images.example.com/v1", "http"],
    ["https://user:pass@images.example.com/v1", "username"],
    ["not a url", "full URL"],
    ["", "base URL"],
  ])("refuses %s", (url, expected) => {
    expect(validateImageEndpointUrl(url)).toContain(expected);
  });

  test("recognises loopback hosts the backend also treats as local", () => {
    expect(isLoopbackImageEndpoint("http://localhost:1234")).toBe(true);
    expect(isLoopbackImageEndpoint("http://api.localhost:1234")).toBe(true);
    expect(isLoopbackImageEndpoint("https://images.example.com")).toBe(false);
  });
});

describe("model id validation", () => {
  test("a Replicate id looks like owner/name", () => {
    expect(validateImageModelId("replicate", "someone/their-model")).toBeNull();
    expect(validateImageModelId("replicate", "no-slash")).toContain(
      "owner/name"
    );
  });

  test("a Workers AI id looks like @cf/vendor/model", () => {
    expect(
      validateImageModelId("cloudflare", CLOUDFLARE_FLUX_SCHNELL_MODEL)
    ).toBeNull();
    expect(validateImageModelId("cloudflare", "vendor/model")).toContain("@cf/");
  });

  test("refuses characters that are not allowed anywhere", () => {
    expect(validateImageModelId("replicate", "owner/model name")).toContain(
      "not allowed"
    );
  });
});

describe("whether image generation can run", () => {
  test("Replicate needs its own key and says so", () => {
    expect(
      imageGenerationBlockedReason({ imageGeneration: imageSettings() })
    ).toContain("Replicate API key");
    expect(
      isImageGenerationUsable({
        replicateApiKey: "r8_key",
        imageGeneration: imageSettings(),
      })
    ).toBe(true);
  });

  test("a direct provider key is never offered as a substitute", () => {
    // An OpenAI key belongs to the model runtime, not to Cloudflare.
    const reason = imageGenerationBlockedReason({
      replicateApiKey: "r8_key",
      imageGeneration: imageSettings({ provider: "cloudflare" }),
    });
    expect(reason).toContain("Cloudflare account ID");
  });

  test("Cloudflare needs both halves and validates the account id", () => {
    expect(
      imageGenerationBlockedReason({
        imageGeneration: imageSettings({
          provider: "cloudflare",
          cloudflareAccountId: "nope",
          cloudflareApiToken: "token",
        }),
      })
    ).toContain("hexadecimal");
    expect(
      imageGenerationBlockedReason({
        imageGeneration: imageSettings({
          provider: "cloudflare",
          cloudflareAccountId: CLOUDFLARE_ACCOUNT,
        }),
      })
    ).toContain("API token");
    expect(
      isImageGenerationUsable({
        imageGeneration: imageSettings({
          provider: "cloudflare",
          cloudflareAccountId: CLOUDFLARE_ACCOUNT,
          cloudflareApiToken: "token",
        }),
      })
    ).toBe(true);
  });

  test("a localhost endpoint may omit a key; a remote one may not", () => {
    expect(
      isImageGenerationUsable({
        imageGeneration: imageSettings({
          provider: "openai-compatible",
          openAiImageBaseUrl: "http://localhost:8000/v1",
        }),
      })
    ).toBe(true);
    expect(
      imageGenerationBlockedReason({
        imageGeneration: imageSettings({
          provider: "openai-compatible",
          openAiImageBaseUrl: "https://images.example.com/v1",
        }),
      })
    ).toContain("own API key");
  });

  test("background removal tracks Replicate, not the chosen provider", () => {
    const cloudflareRun = {
      replicateApiKey: "r8_key",
      imageGeneration: imageSettings({
        provider: "cloudflare",
        cloudflareAccountId: CLOUDFLARE_ACCOUNT,
        cloudflareApiToken: "token",
      }),
    };
    expect(isBackgroundRemovalUsable(cloudflareRun)).toBe(true);
    expect(
      isBackgroundRemovalUsable({ ...cloudflareRun, replicateApiKey: "" })
    ).toBe(false);
  });
});

describe("normalizing a stored blob", () => {
  test("an absent block becomes the Replicate default", () => {
    expect(normalizeImageGenerationSettings(undefined)).toEqual(
      DEFAULT_IMAGE_GENERATION_SETTINGS
    );
    expect(normalizeImageGenerationSettings(null).provider).toBe("replicate");
    expect(normalizeImageGenerationSettings("nonsense").provider).toBe(
      "replicate"
    );
  });

  test("an unknown provider falls back rather than being trusted", () => {
    const normalized = normalizeImageGenerationSettings({
      provider: "midjourney",
      model: "whatever",
    });
    expect(normalized.provider).toBe("replicate");
  });

  test("an empty model becomes that provider's default", () => {
    expect(
      normalizeImageGenerationSettings({ provider: "cloudflare", model: "" })
        .model
    ).toBe(CLOUDFLARE_FLUX_SCHNELL_MODEL);
  });

  test("values are trimmed and bounded", () => {
    const normalized = normalizeImageGenerationSettings({
      provider: "cloudflare",
      model: "  @cf/black-forest-labs/flux-1-schnell  ",
      cloudflareApiToken: "x".repeat(5000),
    });
    expect(normalized.model).toBe(CLOUDFLARE_FLUX_SCHNELL_MODEL);
    expect(normalized.cloudflareApiToken.length).toBe(512);
  });
});

describe("the wire payload", () => {
  test("carries the credentials at send time", () => {
    const payload = toImageGenerationWirePayload(
      imageSettings({
        provider: "cloudflare",
        model: CLOUDFLARE_FLUX_SCHNELL_MODEL,
        cloudflareAccountId: CLOUDFLARE_ACCOUNT,
        cloudflareApiToken: "cf-token",
      })
    );
    expect(payload.cloudflareAccountId).toBe(CLOUDFLARE_ACCOUNT);
    expect(payload.cloudflareApiToken).toBe("cf-token");
  });

  test("drops every credential when secrets are excluded", () => {
    const stripped = stripImageGenerationSecrets(
      imageSettings({
        provider: "openai-compatible",
        model: "sd-xl",
        openAiImageBaseUrl: "https://images.example.com/v1",
        openAiImageApiKey: "sk-endpoint",
        cloudflareApiToken: "cf-token",
      })
    );
    expect(stripped.provider).toBe("openai-compatible");
    expect(stripped.model).toBe("sd-xl");
    // The endpoint URL is configuration, not a credential, so it survives.
    expect(stripped.openAiImageBaseUrl).toBe("https://images.example.com/v1");
    expect(JSON.stringify(stripped)).not.toContain("sk-endpoint");
    expect(JSON.stringify(stripped)).not.toContain("cf-token");
  });

  test("an empty credential is omitted rather than sent blank", () => {
    const payload = toImageGenerationWirePayload(imageSettings());
    expect(payload).toEqual({
      provider: "replicate",
      model: Z_IMAGE_TURBO_MODEL,
    });
  });
});

describe("reading the backend's verdict on a custom model", () => {
  test("a pass is reported as a pass", () => {
    const result = parseImageModelValidation({
      ok: true,
      provider: "replicate",
      model: "someone/model",
      category: "ready",
      message: "This model takes a text prompt and returns an image.",
    });
    expect(result.ok).toBe(true);
    expect(result.category).toBe("ready");
  });

  test("a malformed answer is never read as a pass", () => {
    expect(parseImageModelValidation(null).ok).toBe(false);
    expect(parseImageModelValidation({ ok: "yes" }).ok).toBe(false);
    expect(parseImageModelValidation({}).message).toContain("could not be");
  });
});
