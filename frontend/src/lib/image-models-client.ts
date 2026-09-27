import { HTTP_BACKEND_URL } from "../config";
import {
  parseImageModelValidation,
  type ImageModelValidationResult,
  type ImageProvider,
} from "./image-providers";

export interface CustomImageModelRequest {
  provider: ImageProvider;
  model: string;
  /**
   * Read from the current Settings at call time.
   *
   * It is sent so the check works before the key is saved anywhere, and it is
   * never stored by this module.
   */
  replicateApiKey?: string | null;
}

/**
 * Ask the backend whether a Replicate model can actually be driven.
 *
 * The backend reads that model's own OpenAPI schema from Replicate and accepts
 * it only if it really declares a string `prompt` input and an image output.
 * This is the one door through which a model outside the curated list becomes
 * usable, which is why the UI never simply takes the user's word for it.
 */
export async function validateCustomImageModel(
  request: CustomImageModelRequest,
  options: { signal?: AbortSignal } = {}
): Promise<ImageModelValidationResult> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/image-models/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      provider: request.provider,
      model: request.model.trim(),
      ...(request.replicateApiKey?.trim()
        ? { apiKey: request.replicateApiKey.trim() }
        : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not check this model (${response.status})`);
  }
  return parseImageModelValidation(await response.json());
}
