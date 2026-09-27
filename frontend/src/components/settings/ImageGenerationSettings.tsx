import { useEffect, useId, useRef, useState } from "react";
import { LuAlertTriangle, LuCheck, LuExternalLink, LuLoader } from "react-icons/lu";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  CUSTOM_MODEL_EXPLANATION,
  IMAGE_PROVIDERS,
  IMAGE_PROVIDER_LABELS,
  defaultModelFor,
  findImageModel,
  imageGenerationBlockedReason,
  isBackgroundRemovalUsable,
  isBuiltInImageModel,
  isImageGenerationUsable,
  modelsForProvider,
  supportsCustomModels,
  validateImageEndpointUrl,
  validateImageModelId,
  type ImageGenerationSettings as ImageSettings,
  type ImageModelValidationResult,
  type ImageProvider,
} from "../../lib/image-providers";
import { validateCustomImageModel } from "../../lib/image-models-client";

export interface ImageGenerationSettingsProps {
  settings: ImageSettings;
  /**
   * Applied to the block as it is at the time of the update.
   *
   * An updater rather than a value, for the same reason the web-search card
   * uses one: a provider change also rewrites the model, and a value would
   * lose one of the two when React batches them.
   */
  onChange: (update: (current: ImageSettings) => ImageSettings) => void;
  /** Whether placeholder images are switched on at all. */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /**
   * The Replicate key from the main Settings form.
   *
   * Read-only here. Replicate is the default provider and the only background
   * removal backend, so this card reports on it but never edits it - the key
   * belongs to the provider section above and must keep working there.
   */
  replicateApiKey: string;
  /** Test seam: replaced in tests so no request is made. */
  validateModel?: typeof validateCustomImageModel;
}

const HELP_CLASS = "mt-1 text-xs leading-5 text-gray-500 dark:text-zinc-400";
const LABEL_CLASS = "text-sm font-medium text-gray-700 dark:text-zinc-300";
const SELECT_CLASS =
  "mt-2 h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-zinc-900/40";

export default function ImageGenerationSettings({
  settings,
  onChange,
  enabled,
  onEnabledChange,
  replicateApiKey,
  validateModel = validateCustomImageModel,
}: ImageGenerationSettingsProps) {
  const enabledId = useId();
  const providerId = useId();
  const modelId = useId();
  const customModelId = useId();
  const accountId = useId();
  const tokenId = useId();
  const endpointId = useId();
  const endpointKeyId = useId();

  const [checkResult, setCheckResult] =
    useState<ImageModelValidationResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const credentials = { replicateApiKey, imageGeneration: settings };
  const usable = isImageGenerationUsable(credentials);
  const blockedReason = imageGenerationBlockedReason(credentials);
  const backgroundRemoval = isBackgroundRemovalUsable(credentials);
  const allowsCustom = supportsCustomModels(settings.provider);
  // A model id belongs to exactly one provider. A stored blob written by an
  // older build (or edited by hand) can pair them wrongly, and showing
  // "Cloudflare Workers AI using prunaai/z-image-turbo" would be a lie, so the
  // provider's own default wins whenever the pairing cannot be true.
  const effectiveModel =
    isBuiltInImageModel(settings.provider, settings.model) ||
    (allowsCustom && settings.model)
      ? settings.model
      : defaultModelFor(settings.provider);
  const builtIn = isBuiltInImageModel(settings.provider, effectiveModel);
  const selectedModel = findImageModel(settings.provider, effectiveModel);
  const modelError = validateImageModelId(settings.provider, effectiveModel);
  const endpointError =
    settings.provider === "openai-compatible" && settings.openAiImageBaseUrl
      ? validateImageEndpointUrl(settings.openAiImageBaseUrl)
      : null;

  // A verdict describes one exact model id. Any edit makes it stale, so it is
  // cleared rather than left to imply the new value was checked.
  const update = (next: (current: ImageSettings) => ImageSettings) => {
    setCheckResult(null);
    setCheckError(null);
    onChange(next);
  };

  const runCheck = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsChecking(true);
    setCheckResult(null);
    setCheckError(null);
    try {
      setCheckResult(
        await validateModel(
          { provider: settings.provider, model: effectiveModel, replicateApiKey },
          { signal: controller.signal }
        )
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setCheckError(
        error instanceof Error ? error.message : "Could not check this model."
      );
    } finally {
      if (!controller.signal.aborted) setIsChecking(false);
    }
  };

  const costNote =
    selectedModel?.costNote ??
    (settings.provider === "replicate"
      ? "Billed by Replicate per generated image, at that model's own rate."
      : "Billed by whoever runs this model.");

  return (
    <div
      data-testid="image-generation-settings"
      className="rounded-lg border border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/60"
    >
      <div className="border-b border-gray-100 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-white">
          Image Generation
        </h2>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor={enabledId} className={LABEL_CLASS}>
              Placeholder images
            </label>
            <p className={HELP_CLASS}>
              Lets a model generate the images a design needs instead of leaving
              grey boxes. Every provider below bills you directly; shot2code
              adds nothing and includes no images of its own.
            </p>
          </div>
          <Switch
            id={enabledId}
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-label="Generate placeholder images"
          />
        </div>

        <div>
          <label htmlFor={providerId} className={LABEL_CLASS}>
            Image provider
          </label>
          <select
            id={providerId}
            data-testid="image-provider-select"
            className={SELECT_CLASS}
            value={settings.provider}
            onChange={(event) => {
              const provider = event.target.value as ImageProvider;
              update((current) => ({
                ...current,
                provider,
                // A model id belongs to exactly one provider, so switching
                // provider must not carry the old id forward.
                model: defaultModelFor(provider),
              }));
            }}
          >
            {IMAGE_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {IMAGE_PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
          <p className={HELP_CLASS}>
            Replicate is the default and needs no change. The others are
            additive: picking one never touches your Replicate, OpenAI,
            Anthropic or Gemini keys, and Replicate keeps running background
            removal.
          </p>
        </div>

        <div>
          <label htmlFor={modelId} className={LABEL_CLASS}>
            Image model
          </label>
          <select
            id={modelId}
            data-testid="image-model-select"
            className={SELECT_CLASS}
            value={builtIn ? effectiveModel : "custom"}
            onChange={(event) => {
              const value = event.target.value;
              update((current) => ({
                ...current,
                model: value === "custom" ? "" : value,
              }));
            }}
          >
            {modelsForProvider(settings.provider).map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
            {allowsCustom && (
              <option value="custom">Another Replicate model…</option>
            )}
          </select>
          <p data-testid="image-model-cost" className={HELP_CLASS}>
            {costNote}
          </p>
          {selectedModel && (
            <a
              href={selectedModel.pricingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              See the provider's current pricing
              <LuExternalLink aria-hidden="true" />
            </a>
          )}
        </div>

        {allowsCustom && !builtIn && (
          <div data-testid="image-custom-model">
            <label htmlFor={customModelId} className={LABEL_CLASS}>
              Replicate model id
            </label>
            <p className={HELP_CLASS}>{CUSTOM_MODEL_EXPLANATION}</p>
            <Input
              id={customModelId}
              className="mt-2"
              autoComplete="off"
              spellCheck={false}
              placeholder="owner/model-name"
              value={effectiveModel}
              onChange={(event) =>
                update((current) => ({ ...current, model: event.target.value }))
              }
            />
            {modelError && (
              <p
                role="alert"
                data-testid="image-model-error"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {modelError}
              </p>
            )}
            <button
              type="button"
              data-testid="image-model-check"
              className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm dark:border-zinc-600"
              onClick={runCheck}
              disabled={isChecking || Boolean(modelError) || !replicateApiKey}
              aria-describedby={customModelId}
            >
              {isChecking ? (
                <LuLoader aria-hidden="true" className="animate-spin" />
              ) : (
                <LuCheck aria-hidden="true" />
              )}
              Check this model
            </button>
            {!replicateApiKey && (
              <p className={HELP_CLASS}>
                Add a Replicate API key above first; the model's schema is read
                from your account.
              </p>
            )}
            <div aria-live="polite">
              {checkResult && (
                <p
                  data-testid="image-model-check-result"
                  data-tone={checkResult.ok ? "ready" : "problem"}
                  role={checkResult.ok ? undefined : "alert"}
                  className={`mt-2 text-xs leading-5 ${
                    checkResult.ok
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {checkResult.message}
                </p>
              )}
              {checkError && (
                <p
                  role="alert"
                  data-testid="image-model-check-error"
                  className="mt-2 text-xs text-red-600 dark:text-red-400"
                >
                  {checkError}
                </p>
              )}
            </div>
          </div>
        )}

        {settings.provider === "cloudflare" && (
          <div data-testid="image-cloudflare-fields" className="space-y-3">
            <div>
              <label htmlFor={accountId} className={LABEL_CLASS}>
                Cloudflare account ID
              </label>
              <p className={HELP_CLASS}>
                The 32-character hexadecimal id shown on the Workers &amp; Pages
                overview page.
              </p>
              <Input
                id={accountId}
                className="mt-2"
                autoComplete="off"
                spellCheck={false}
                placeholder="0123456789abcdef0123456789abcdef"
                value={settings.cloudflareAccountId}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    cloudflareAccountId: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label htmlFor={tokenId} className={LABEL_CLASS}>
                Cloudflare API token
              </label>
              <p className={HELP_CLASS}>
                Needs Workers AI access. Stored on this device only and sent to
                Cloudflare alone.
              </p>
              <Input
                id={tokenId}
                className="mt-2"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Cloudflare API token"
                value={settings.cloudflareApiToken}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    cloudflareApiToken: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        )}

        {settings.provider === "openai-compatible" && (
          <div data-testid="image-endpoint-fields" className="space-y-3">
            <div>
              <label htmlFor={endpointId} className={LABEL_CLASS}>
                Endpoint base URL
              </label>
              <p className={HELP_CLASS}>
                Any server implementing the OpenAI images API. shot2code calls{" "}
                <code className="font-mono">/images/generations</code>, and{" "}
                <code className="font-mono">/images/edits</code> when the server
                implements it. Background removal has no endpoint in that API
                and stays on Replicate.
              </p>
              <Input
                id={endpointId}
                className="mt-2"
                autoComplete="off"
                spellCheck={false}
                placeholder="http://localhost:8000/v1"
                value={settings.openAiImageBaseUrl}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    openAiImageBaseUrl: event.target.value,
                  }))
                }
              />
              {endpointError && (
                <p
                  role="alert"
                  data-testid="image-endpoint-error"
                  className="mt-1 text-xs text-red-600 dark:text-red-400"
                >
                  {endpointError}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={endpointKeyId} className={LABEL_CLASS}>
                Endpoint API key
              </label>
              <p className={HELP_CLASS}>
                Required unless the endpoint runs on localhost. This endpoint
                gets its own credential: your OpenAI key is never reused here,
                because it belongs to the model runtime and must keep working
                there untouched.
              </p>
              <Input
                id={endpointKeyId}
                className="mt-2"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Endpoint API key"
                value={settings.openAiImageApiKey}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    openAiImageApiKey: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        )}

        {/* What this provider cannot do, said plainly rather than discovered
            when a tool call comes back empty. */}
        {!backgroundRemoval && (
          <div
            data-testid="image-background-removal-notice"
            className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20"
          >
            <LuAlertTriangle
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-amber-500"
            />
            <p className="min-w-0 text-xs leading-5 text-amber-800 dark:text-amber-200">
              Background removal runs on Replicate only. Without a Replicate API
              key the <code className="font-mono">remove_backgrounds</code> tool
              is not offered - no other provider's model is substituted for it.
            </p>
          </div>
        )}

        <div aria-live="polite">
          {enabled && blockedReason && (
            <p
              role="alert"
              data-testid="image-generation-blocked"
              className="text-xs leading-5 text-red-600 dark:text-red-400"
            >
              {blockedReason}
            </p>
          )}
          {enabled && usable && (
            <p
              data-testid="image-generation-ready"
              className="text-xs leading-5 text-emerald-700 dark:text-emerald-300"
            >
              Ready. Images will be generated by{" "}
              {IMAGE_PROVIDER_LABELS[settings.provider]} using{" "}
              <code className="font-mono">{effectiveModel}</code>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
