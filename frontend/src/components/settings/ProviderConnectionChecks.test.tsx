jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import ProviderConnectionChecks from "./ProviderConnectionChecks";
import { EMPTY_CATALOG } from "../../lib/model-selection";
import type { ProviderCheckResult } from "../../lib/provider-validation";

const OPENAI_KEY = "sk-openai-secret-value";
const ANTHROPIC_KEY = "sk-ant-secret-value";
const GEMINI_KEY = "gemini-secret-value";
const REPLICATE_KEY = "r8-replicate-secret-value";

const SETTINGS = {
  openAiApiKey: OPENAI_KEY,
  openAiBaseURL: "https://proxy.example.com/v1",
  anthropicApiKey: ANTHROPIC_KEY,
  geminiApiKey: GEMINI_KEY,
  replicateApiKey: REPLICATE_KEY,
};

function render(
  overrides: Partial<Parameters<typeof ProviderConnectionChecks>[0]> = {}
) {
  return renderToStaticMarkup(
    <ProviderConnectionChecks
      settings={SETTINGS}
      catalog={EMPTY_CATALOG}
      selectedModels={[]}
      {...overrides}
    />
  );
}

function result(
  overrides: Partial<ProviderCheckResult> = {}
): ProviderCheckResult {
  return {
    provider: "openai",
    ok: false,
    category: "unknown",
    message: "",
    modelId: null,
    models: [],
    ...overrides,
  };
}

describe("the checks list", () => {
  it("offers an individual test for each of the four native providers", () => {
    const html = render();

    for (const provider of ["openai", "anthropic", "gemini", "replicate"]) {
      expect(html).toContain(`data-testid="provider-check-${provider}"`);
    }
    expect(html).toContain("Test OpenAI");
    expect(html).toContain("Test Anthropic");
    expect(html).toContain("Test Gemini");
    expect(html).toContain("Test Replicate");
  });

  it("warns that a test may consume quota and is scoped to one provider", () => {
    const html = render();

    expect(html).toContain("one tiny request");
    expect(html).toContain("small amount of quota");
    // React escapes the apostrophe in "provider's".
    expect(html).toContain("Only that provider&#x27;s key is sent");
  });

  it("stays honest about an empty field instead of disabling the test", () => {
    const html = render({ settings: {} });

    // Every button remains usable: the backend may hold a key we cannot see.
    // (`disabled:` also appears as a Tailwind variant, so match the attribute.)
    expect(html).not.toContain('disabled=""');
    expect(html).toContain(
      "leave a field empty to test the key the backend holds in its own configuration instead"
    );
  });

  it("is a labelled region with 44px targets and a polite live area", () => {
    const html = render();

    expect(html).toContain('aria-labelledby="provider-checks-heading"');
    expect(html).toContain('id="provider-checks-heading"');
    expect(html).toContain("min-h-11");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-describedby="provider-checks-help"');
  });
});

describe("rendering an outcome", () => {
  it("shows a zero-credit OpenAI answer as billing with a direct link", () => {
    const html = render({
      initialResults: {
        openai: result({
          category: "billing",
          message:
            "You exceeded your current quota, please check your plan and billing details.",
        }),
      },
    });

    expect(html).toContain('data-tone="billing"');
    expect(html).toContain("Out of credit");
    expect(html).toContain("exceeded your current quota");
    expect(html).toContain("Add credit or a payment method");
    expect(html).toContain('data-testid="provider-check-openai-action"');
    expect(html).toContain("platform.openai.com");
    // Not presented as an unexplained failure.
    expect(html).not.toContain("Check failed");
  });

  it("shows a rejected key as an auth problem, with no billing link", () => {
    const html = render({
      initialResults: {
        anthropic: result({
          provider: "anthropic",
          category: "credentials",
          message: "Invalid bearer token.",
        }),
      },
    });

    expect(html).toContain('data-tone="auth"');
    expect(html).toContain("Key rejected");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('data-testid="provider-check-anthropic-action"');
  });

  it("shows a ready provider without an alert role", () => {
    const html = render({
      initialResults: {
        gemini: result({
          provider: "gemini",
          ok: true,
          category: "ready",
          message: "Gemini answered in 210ms.",
          modelId: "gemini-3-pro (high thinking)",
        }),
      },
    });

    expect(html).toContain('data-tone="ready"');
    expect(html).toContain("Ready");
    expect(html).toContain("Gemini answered in 210ms.");
    expect(html).toContain("Tested with gemini-3-pro (high thinking).");
  });

  it("explains an older backend rather than blaming the provider", () => {
    const html = render({
      initialResults: {
        replicate: result({
          provider: "replicate",
          category: "unsupported_backend",
          message: "This backend does not offer connection checks yet.",
        }),
      },
    });
    expect(html).toContain("does not offer connection checks yet");
  });
});

describe("secrets", () => {
  it("never renders any key, in any state", () => {
    const html = render({
      initialResults: {
        openai: result({ category: "credentials", message: "Rejected." }),
        anthropic: result({ provider: "anthropic", ok: true, category: "ready" }),
        gemini: result({ provider: "gemini", category: "insufficient_quota" }),
        replicate: result({ provider: "replicate", category: "network" }),
      },
    });

    for (const secret of [
      OPENAI_KEY,
      ANTHROPIC_KEY,
      GEMINI_KEY,
      REPLICATE_KEY,
    ]) {
      expect(html).not.toContain(secret);
    }
    // No input element exists here at all, so nothing can echo a value.
    expect(html).not.toContain("<input");
  });

  it("does not print the base URL or any query string", () => {
    const html = render();
    expect(html).not.toContain("proxy.example.com");
  });
});

