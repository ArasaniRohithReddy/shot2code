/**
 * Image generation providers, mirrored from the backend.
 *
 * `backend/image_generation/catalog.py` and
 * `backend/image_generation/settings.py` are the source of truth; this module
 * repeats their catalog and their validation so Settings can refuse a bad
 * value before a run starts, in the same words the backend would use.
 *
 * Three rules carried over verbatim, because getting them wrong is how a UI
 * starts lying:
 *
 * 1. **Replicate stays the default.** Choosing another provider is additive:
 *    it never reads, replaces or re-routes `replicateApiKey`, and Replicate
 *    remains the only background-removal backend.
 * 2. **Only validated models are listed.** Replicate hosts thousands of image
 *    models with incompatible input schemas, so a model outside this list is
 *    "custom" and must pass `POST /api/image-models/validate` - which reads
 *    the model's own OpenAPI schema - before it is usable.
 * 3. **No provider is ever described as permanently free.** Every allowance is
 *    attributed to the provider, scoped (daily/monthly), quoted with the date
 *    it was read from the provider's own page, and marked subject to change
 *    and to account and model availability.
 */

export type ImageProvider = "replicate" | "cloudflare" | "openai-compatible";

export const IMAGE_PROVIDERS: ImageProvider[] = [
  "replicate",
  "cloudflare",
  "openai-compatible",
];

export const DEFAULT_IMAGE_PROVIDER: ImageProvider = "replicate";

export const Z_IMAGE_TURBO_MODEL = "prunaai/z-image-turbo";
export const FLUX_2_KLEIN_MODEL = "black-forest-labs/flux-2-klein-4b";
export const CLOUDFLARE_FLUX_SCHNELL_MODEL =
  "@cf/black-forest-labs/flux-1-schnell";
export const DEFAULT_OPENAI_COMPATIBLE_MODEL = "gpt-image-1";

export const MAX_IMAGE_MODEL_LENGTH = 160;
export const MAX_IMAGE_ENDPOINT_LENGTH = 2048;
export const MAX_IMAGE_CREDENTIAL_LENGTH = 512;

const MODEL_ID = /^[A-Za-z0-9@][A-Za-z0-9._:/@+-]*$/;
const CLOUDFLARE_ACCOUNT_ID = /^[a-fA-F0-9]{8,64}$/;
const REPLICATE_MODEL_PATH = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

export const REPLICATE_PRICING_URL = "https://replicate.com/pricing";
export const CLOUDFLARE_PRICING_URL =
  "https://developers.cloudflare.com/workers-ai/platform/pricing/";

/** When these figures were read off the official pages. */
export const CLOUDFLARE_PRICING_CHECKED = "2026-09-17";
export const REPLICATE_PRICING_CHECKED = "2026-09-27";

/**
 * Cloudflare's allocation, described exactly as Cloudflare publishes it.
 *
 * Every clause is load-bearing: the 10,000 Neurons a day apply to **both** the
 * Workers Free and Workers Paid plans (an earlier version of this string said
 * "Free plan" and was wrong), the reset is 00:00 UTC, exceeding it needs the
 * Paid plan at $0.011 per 1,000 Neurons, and some models require a paid
 * billing method at all. It is Cloudflare's allocation on Cloudflare's terms
 * and it can change — nothing here may shorten this to "free".
 */
export const CLOUDFLARE_ALLOCATION_NOTE =
  "Billed to your Cloudflare account. Cloudflare's published pricing " +
  `(checked ${CLOUDFLARE_PRICING_CHECKED}) includes a daily free allocation ` +
  "of 10,000 Neurons on both the Workers Free and Workers Paid plans, " +
  "resetting at 00:00 UTC, which image generation draws from. Going beyond " +
  "it requires the Workers Paid plan and is billed at $0.011 per 1,000 " +
  "Neurons. The allocation, the rates and model availability are set by " +
  "Cloudflare and can change; some models require a paid billing method.";

export const CLOUDFLARE_FLUX_SCHNELL_COST_NOTE =
  "Cloudflare prices this model at 4.80 neurons per 512x512 tile plus 9.60 " +
  "neurons per step, and shot2code requests 4 steps.";

export const REPLICATE_COST_NOTE =
  "Billed by Replicate, which charges only for what you use; the cost of a " +
  "public model depends on the model and how long each run takes, and is " +
  "listed on that model's own page. There is no free allocation.";

export const OPENAI_COMPATIBLE_COST_NOTE =
  "Billed by whoever runs the endpoint you point at. A local server usually " +
  "costs nothing; a hosted one bills you at its own rate.";

/**
 * Why a Replicate model outside the list is not simply offered.
 *
 * Shown next to the custom-model field so the schema check reads as a safety
 * net rather than an obstacle.
 */
export const CUSTOM_MODEL_EXPLANATION =
  "Replicate hosts thousands of image models and they do not share one input " +
  "schema, so shot2code cannot assume an arbitrary model works. Enter a " +
  "model id and check it: shot2code reads that model's own schema from " +
  "Replicate and accepts it only if it really takes a text prompt and " +
  "returns an image. Only the prompt is sent, so a model needing other " +
  "required inputs is refused.";

export interface ImageModelInfo {
  id: string;
  provider: ImageProvider;
  label: string;
  costNote: string;
  pricingUrl: string;
}

export const BUILT_IN_IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: Z_IMAGE_TURBO_MODEL,
    provider: "replicate",
    label: "Z-Image Turbo (Pruna)",
    costNote: REPLICATE_COST_NOTE,
    pricingUrl: REPLICATE_PRICING_URL,
  },
  {
    id: FLUX_2_KLEIN_MODEL,
    provider: "replicate",
    label: "FLUX.2 Klein 4B (Black Forest Labs)",
    costNote: REPLICATE_COST_NOTE,
    pricingUrl: REPLICATE_PRICING_URL,
  },
  {
    id: CLOUDFLARE_FLUX_SCHNELL_MODEL,
    provider: "cloudflare",
    label: "FLUX.1 [schnell] (Workers AI)",
    costNote: `${CLOUDFLARE_ALLOCATION_NOTE} ${CLOUDFLARE_FLUX_SCHNELL_COST_NOTE}`,
    pricingUrl: CLOUDFLARE_PRICING_URL,
  },
  {
    id: DEFAULT_OPENAI_COMPATIBLE_MODEL,
    provider: "openai-compatible",
    label: "OpenAI-compatible images endpoint",
    costNote: OPENAI_COMPATIBLE_COST_NOTE,
    pricingUrl: "https://platform.openai.com/docs/api-reference/images",
  },
];

export const IMAGE_PROVIDER_LABELS: Record<ImageProvider, string> = {
  replicate: "Replicate",
  cloudflare: "Cloudflare Workers AI",
  "openai-compatible": "OpenAI-compatible endpoint",
};

const DEFAULT_MODEL_FOR_PROVIDER: Record<ImageProvider, string> = {
  replicate: Z_IMAGE_TURBO_MODEL,
  cloudflare: CLOUDFLARE_FLUX_SCHNELL_MODEL,
  "openai-compatible": DEFAULT_OPENAI_COMPATIBLE_MODEL,
};

/** Background removal is Replicate-only, and no substitute is invented. */
export const BACKGROUND_REMOVAL_PROVIDERS: ImageProvider[] = ["replicate"];

export function defaultModelFor(provider: ImageProvider): string {
  return DEFAULT_MODEL_FOR_PROVIDER[provider];
}

export function modelsForProvider(provider: ImageProvider): ImageModelInfo[] {
  return BUILT_IN_IMAGE_MODELS.filter((model) => model.provider === provider);
}

export function findImageModel(
  provider: ImageProvider,
  modelId: string
): ImageModelInfo | null {
  return (
    BUILT_IN_IMAGE_MODELS.find(
      (model) => model.provider === provider && model.id === modelId
    ) ?? null
  );
}

export function isBuiltInImageModel(
  provider: ImageProvider,
  modelId: string
): boolean {
  return findImageModel(provider, modelId) !== null;
}

export function supportsBackgroundRemoval(provider: ImageProvider): boolean {
  return BACKGROUND_REMOVAL_PROVIDERS.includes(provider);
}

export function supportsCustomModels(provider: ImageProvider): boolean {
  return provider === "replicate";
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export interface ImageGenerationSettings {
  provider: ImageProvider;
  model: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  openAiImageBaseUrl: string;
  openAiImageApiKey: string;
}

export const DEFAULT_IMAGE_GENERATION_SETTINGS: ImageGenerationSettings = {
  provider: DEFAULT_IMAGE_PROVIDER,
  model: Z_IMAGE_TURBO_MODEL,
  cloudflareAccountId: "",
  cloudflareApiToken: "",
  openAiImageBaseUrl: "",
  openAiImageApiKey: "",
};

function text(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, limit);
}

/** Read a stored (or older) settings blob without trusting any of it. */
export function normalizeImageGenerationSettings(
  raw: unknown
): ImageGenerationSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_IMAGE_GENERATION_SETTINGS };
  }
  const source = raw as Record<string, unknown>;
  const provider = IMAGE_PROVIDERS.includes(source.provider as ImageProvider)
    ? (source.provider as ImageProvider)
    : DEFAULT_IMAGE_PROVIDER;
  const model = text(source.model, MAX_IMAGE_MODEL_LENGTH);
  return {
    provider,
    model: model || defaultModelFor(provider),
    cloudflareAccountId: text(
      source.cloudflareAccountId,
      MAX_IMAGE_CREDENTIAL_LENGTH
    ),
    cloudflareApiToken: text(
      source.cloudflareApiToken,
      MAX_IMAGE_CREDENTIAL_LENGTH
    ),
    openAiImageBaseUrl: text(
      source.openAiImageBaseUrl,
      MAX_IMAGE_ENDPOINT_LENGTH
    ),
    openAiImageApiKey: text(
      source.openAiImageApiKey,
      MAX_IMAGE_CREDENTIAL_LENGTH
    ),
  };
}

export function isLoopbackImageEndpoint(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "0.0.0.0" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/**
 * Refuse an endpoint URL that is unsafe to send a credential to.
 *
 * The same rule the backend applies: http/https only, no embedded
 * credentials, and plaintext http only when it cannot leave the machine.
 */
export function validateImageEndpointUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return "Enter the endpoint's base URL, e.g. http://localhost:8000/v1.";
  if (trimmed.length > MAX_IMAGE_ENDPOINT_LENGTH) {
    return `The endpoint URL must be ${MAX_IMAGE_ENDPOINT_LENGTH} characters or fewer.`;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a full URL, starting with http:// or https://.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "The endpoint must be an http:// or https:// URL.";
  }
  if (parsed.username || parsed.password) {
    return "The endpoint must not embed a username or password.";
  }
  if (!parsed.hostname) return "The endpoint must include a host name.";
  if (parsed.protocol === "http:" && !isLoopbackImageEndpoint(trimmed)) {
    return "Use https:// unless the endpoint runs on localhost.";
  }
  return null;
}

export function validateImageModelId(
  provider: ImageProvider,
  modelId: string
): string | null {
  const trimmed = modelId.trim();
  if (!trimmed) return "Pick or enter an image model.";
  if (trimmed.length > MAX_IMAGE_MODEL_LENGTH) {
    return `The model id must be ${MAX_IMAGE_MODEL_LENGTH} characters or fewer.`;
  }
  if (!MODEL_ID.test(trimmed)) {
    return "The model id contains characters that are not allowed.";
  }
  if (provider === "cloudflare" && !trimmed.startsWith("@cf/")) {
    return "A Workers AI model id looks like @cf/vendor/model.";
  }
  if (provider === "replicate" && !REPLICATE_MODEL_PATH.test(trimmed.split(":")[0])) {
    return "A Replicate model id looks like owner/name.";
  }
  return null;
}

export interface ImageCredentialSlice {
  replicateApiKey?: string | null;
  imageGeneration?: ImageGenerationSettings | null;
}

/**
 * Why image generation cannot run yet, or `null` when it can.
 *
 * The UI is deliberately no stricter than the backend here: a localhost
 * endpoint may omit a key, and a direct provider key is never offered as a
 * substitute for another provider's credential.
 */
export function imageGenerationBlockedReason(
  settings: ImageCredentialSlice
): string | null {
  const image = normalizeImageGenerationSettings(settings.imageGeneration);
  if (image.provider === "replicate") {
    return (settings.replicateApiKey ?? "").trim()
      ? null
      : "Add a Replicate API key, or pick another image provider.";
  }
  if (image.provider === "cloudflare") {
    if (!image.cloudflareAccountId.trim()) {
      return "Add your Cloudflare account ID.";
    }
    if (!CLOUDFLARE_ACCOUNT_ID.test(image.cloudflareAccountId.trim())) {
      return "A Cloudflare account ID is a 32-character hexadecimal string.";
    }
    if (!image.cloudflareApiToken.trim()) {
      return "Add a Cloudflare API token with Workers AI access.";
    }
    return null;
  }
  const endpointError = validateImageEndpointUrl(image.openAiImageBaseUrl);
  if (endpointError) return endpointError;
  if (
    !image.openAiImageApiKey.trim() &&
    !isLoopbackImageEndpoint(image.openAiImageBaseUrl)
  ) {
    return "A remote endpoint needs its own API key. Only a localhost endpoint may be used without one.";
  }
  return null;
}

export function isImageGenerationUsable(settings: ImageCredentialSlice): boolean {
  return imageGenerationBlockedReason(settings) === null;
}

/**
 * Whether `remove_backgrounds` can run, which is a *separate* question.
 *
 * It is Replicate-only regardless of which provider generates images, so a
 * Cloudflare run with a Replicate key keeps background removal and a
 * Cloudflare run without one loses it - rather than silently getting an image
 * that still has its background.
 */
export function isBackgroundRemovalUsable(
  settings: ImageCredentialSlice
): boolean {
  return Boolean((settings.replicateApiKey ?? "").trim());
}

/* -------------------------------------------------------------------------- */
/* Payloads                                                                    */
/* -------------------------------------------------------------------------- */

export interface ImageGenerationWirePayload {
  provider: ImageProvider;
  model: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  openAiImageBaseUrl?: string;
  openAiImageApiKey?: string;
}

/**
 * The image block a request carries.
 *
 * With `includeSecrets: false` every credential is dropped entirely rather
 * than blanked, exactly like `toWebSearchWirePayload`, so a commit or history
 * snapshot records *what* was configured without hinting at a credential.
 */
export function toImageGenerationWirePayload(
  settings: ImageGenerationSettings,
  options: { includeSecrets?: boolean } = {}
): ImageGenerationWirePayload {
  const includeSecrets = options.includeSecrets !== false;
  const payload: ImageGenerationWirePayload = {
    provider: settings.provider,
    model: settings.model || defaultModelFor(settings.provider),
  };
  if (settings.openAiImageBaseUrl.trim()) {
    payload.openAiImageBaseUrl = settings.openAiImageBaseUrl.trim();
  }
  if (!includeSecrets) return payload;

  if (settings.cloudflareAccountId.trim()) {
    payload.cloudflareAccountId = settings.cloudflareAccountId.trim();
  }
  if (settings.cloudflareApiToken.trim()) {
    payload.cloudflareApiToken = settings.cloudflareApiToken.trim();
  }
  if (settings.openAiImageApiKey.trim()) {
    payload.openAiImageApiKey = settings.openAiImageApiKey.trim();
  }
  return payload;
}

/** Same copy with every credential removed, for anything written down. */
export function stripImageGenerationSecrets(
  settings: ImageGenerationSettings
): ImageGenerationWirePayload {
  return toImageGenerationWirePayload(settings, { includeSecrets: false });
}

/* -------------------------------------------------------------------------- */
/* Custom model validation                                                     */
/* -------------------------------------------------------------------------- */

export interface ImageModelValidationResult {
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  category: string;
}

export function parseImageModelValidation(
  raw: unknown
): ImageModelValidationResult {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ok: source.ok === true,
    provider: typeof source.provider === "string" ? source.provider : "replicate",
    model: typeof source.model === "string" ? source.model : "",
    category: typeof source.category === "string" ? source.category : "unknown",
    message:
      typeof source.message === "string" && source.message
        ? source.message
        : "The model could not be checked.",
  };
}
