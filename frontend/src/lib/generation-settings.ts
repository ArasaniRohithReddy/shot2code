import type { Settings } from "../types";

export type GenerationSettings = Omit<
  Settings,
  | "screenshotOneApiKey"
  | "figmaAccessToken"
  | "stitchApiKey"
  | "githubRepositoryToken"
  | "imageGeneration"
  | "freeImageSearch"
  | "iconSearch"
>;

/**
 * Remove credentials that belong only to input capture, never model runs.
 *
 * `imageGeneration` is dropped here too, not because it is capture-only but
 * because it must not ride along as a raw settings object: it is rebuilt as a
 * wire payload by `toImageGenerationWirePayload`, which is the one place that
 * decides whether a credential is included. Spreading the settings object
 * would smuggle every provider's key into every request regardless.
 *
 * `freeImageSearch` and `iconSearch` hold no credential, but are rebuilt
 * the same way so every feature block reaches the backend through exactly one
 * code path.
 */
export function toGenerationSettings(settings: Settings): GenerationSettings {
  const {
    screenshotOneApiKey: _screenshotOneApiKey,
    figmaAccessToken: _figmaAccessToken,
    stitchApiKey: _stitchApiKey,
    githubRepositoryToken: _githubRepositoryToken,
    imageGeneration: _imageGeneration,
    freeImageSearch: _freeImageSearch,
    iconSearch: _iconSearch,
    ...generationSettings
  } = settings;
  void _screenshotOneApiKey;
  void _figmaAccessToken;
  void _stitchApiKey;
  void _githubRepositoryToken;
  void _imageGeneration;
  void _freeImageSearch;
  void _iconSearch;
  return generationSettings;
}
