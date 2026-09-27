import type { Settings } from "../types";

export type GenerationSettings = Omit<
  Settings,
  "screenshotOneApiKey" | "figmaAccessToken" | "stitchApiKey"
>;

/** Remove credentials that belong only to input capture, never model runs. */
export function toGenerationSettings(settings: Settings): GenerationSettings {
  const {
    screenshotOneApiKey: _screenshotOneApiKey,
    figmaAccessToken: _figmaAccessToken,
    stitchApiKey: _stitchApiKey,
    ...generationSettings
  } = settings;
  void _screenshotOneApiKey;
  void _figmaAccessToken;
  void _stitchApiKey;
  return generationSettings;
}
