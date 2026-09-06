// Keep in sync with backend (llm.py)
// Order here matches dropdown order
export enum CodeGenerationModel {
  CLAUDE_OPUS_5_LOW = "claude-opus-5 (low effort)",
  CLAUDE_OPUS_5_MEDIUM = "claude-opus-5 (medium effort)",
  CLAUDE_OPUS_5_HIGH = "claude-opus-5 (high effort)",
  CLAUDE_OPUS_5_XHIGH = "claude-opus-5 (xhigh effort)",
  CLAUDE_OPUS_5_MAX = "claude-opus-5 (max effort)",
  CLAUDE_OPUS_4_8_LOW = "claude-opus-4-8 (low effort)",
  CLAUDE_OPUS_4_8_MEDIUM = "claude-opus-4-8 (medium effort)",
  CLAUDE_OPUS_4_8_HIGH = "claude-opus-4-8 (high effort)",
  CLAUDE_OPUS_4_8_XHIGH = "claude-opus-4-8 (xhigh effort)",
  CLAUDE_OPUS_4_8_MAX = "claude-opus-4-8 (max effort)",
  CLAUDE_FABLE_5_MAX = "claude-fable-5 (max effort)",
  CLAUDE_SONNET_4_6 = "claude-sonnet-4-6",
  GPT_5_5_NONE = "gpt-5.5 (no thinking)",
  GPT_5_5_LOW = "gpt-5.5 (low thinking)",
  GPT_5_5_MEDIUM = "gpt-5.5 (medium thinking)",
  GPT_5_5_HIGH = "gpt-5.5 (high thinking)",
  GPT_5_6_SOL_NONE = "gpt-5.6-sol (no thinking)",
  GPT_5_6_SOL_LOW = "gpt-5.6-sol (low thinking)",
  GPT_5_6_SOL_MEDIUM = "gpt-5.6-sol (medium thinking)",
  GPT_5_6_SOL_HIGH = "gpt-5.6-sol (high thinking)",
  GPT_5_6_SOL_XHIGH = "gpt-5.6-sol (xhigh thinking)",
  GPT_5_6_SOL_MAX = "gpt-5.6-sol (max thinking)",
  GPT_5_6_TERRA_LOW = "gpt-5.6-terra (low thinking)",
  GPT_5_5_XHIGH = "gpt-5.5 (xhigh thinking)",
  GPT_5_4_MINI_LOW = "gpt-5.4-mini (low thinking)",
  GEMINI_3_FLASH_PREVIEW_HIGH = "gemini-3-flash-preview (high thinking)",
  GEMINI_3_FLASH_PREVIEW_MINIMAL = "gemini-3-flash-preview (minimal thinking)",
  GEMINI_3_1_PRO_PREVIEW_HIGH = "gemini-3.1-pro-preview (high thinking)",
  GEMINI_3_1_PRO_PREVIEW_MEDIUM = "gemini-3.1-pro-preview (medium thinking)",
  GEMINI_3_1_PRO_PREVIEW_LOW = "gemini-3.1-pro-preview (low thinking)",
  GEMINI_3_5_FLASH_HIGH = "gemini-3.5-flash (high thinking)",
  GEMINI_3_5_FLASH_MEDIUM = "gemini-3.5-flash (medium thinking)",
  GEMINI_3_5_FLASH_LOW = "gemini-3.5-flash (low thinking)",
  GEMINI_3_5_FLASH_MINIMAL = "gemini-3.5-flash (minimal thinking)",
  GEMINI_3_6_FLASH_HIGH = "gemini-3.6-flash (high thinking)",
  GEMINI_3_6_FLASH_MEDIUM = "gemini-3.6-flash (medium thinking)",
  GEMINI_3_6_FLASH_LOW = "gemini-3.6-flash (low thinking)",
  GEMINI_3_6_FLASH_MINIMAL = "gemini-3.6-flash (minimal thinking)",
  // GitHub Copilot - runs on the user's Copilot subscription, no API key
  COPILOT_CLAUDE_SONNET_5 = "copilot/claude-sonnet-5",
  COPILOT_CLAUDE_OPUS_5 = "copilot/claude-opus-5",
  COPILOT_CLAUDE_OPUS_4_8 = "copilot/claude-opus-4.8",
  COPILOT_CLAUDE_OPUS_4_7 = "copilot/claude-opus-4.7",
  COPILOT_CLAUDE_OPUS_4_6 = "copilot/claude-opus-4.6",
  COPILOT_CLAUDE_SONNET_4_6 = "copilot/claude-sonnet-4.6",
  COPILOT_CLAUDE_HAIKU_4_5 = "copilot/claude-haiku-4.5",
  COPILOT_GPT_6_ASTRA = "copilot/gpt-6-astra",
  COPILOT_GPT_5_6_SOL = "copilot/gpt-5.6-sol",
  COPILOT_GPT_5_6_SOL_FAST = "copilot/gpt-5.6-sol-fast",
  COPILOT_GPT_5_6_TERRA = "copilot/gpt-5.6-terra",
  COPILOT_GPT_5_6_LUNA = "copilot/gpt-5.6-luna",
  COPILOT_GPT_5_5 = "copilot/gpt-5.5",
  COPILOT_GPT_5_4 = "copilot/gpt-5.4",
  COPILOT_GPT_5_4_MINI = "copilot/gpt-5.4-mini",
  COPILOT_GPT_5_3_CODEX = "copilot/gpt-5.3-codex",
  COPILOT_GPT_5_MINI = "copilot/gpt-5-mini",
  COPILOT_GEMINI_3_8_FLASH = "copilot/gemini-3.8-flash",
  COPILOT_GEMINI_3_7_FLASH = "copilot/gemini-3.7-flash",
  COPILOT_GEMINI_3_6_FLASH = "copilot/gemini-3.6-flash",
  COPILOT_GEMINI_3_5_FLASH = "copilot/gemini-3.5-flash",
  COPILOT_GROK_4_6 = "copilot/grok-4.6",
  COPILOT_GROK_4_5 = "copilot/grok-4.5",
  COPILOT_MAI_CODE_1_1_FLASH = "copilot/mai-code-1.1-flash",
}

export type VariantLabelTone = "fast" | "max";

export interface VariantLabel {
  text: string;
  tone: VariantLabelTone;
}

export interface VariantLabelContext {
  inputMode: "image" | "video" | "text";
  generationType: "create" | "update";
}

// Per-model badge text. Only these models are labelled. Heavyweight
// variants read "Max" (sol max anchors image create; 3.1 Pro high anchors
// video); Flash-minimal is the only variant fast enough to earn "Fast".
const VARIANT_LABELS: Partial<Record<CodeGenerationModel, VariantLabel>> = {
  [CodeGenerationModel.GEMINI_3_FLASH_PREVIEW_MINIMAL]: { text: "Fast", tone: "fast" },
  [CodeGenerationModel.GEMINI_3_1_PRO_PREVIEW_HIGH]: { text: "Max", tone: "max" },
  [CodeGenerationModel.GPT_5_5_HIGH]: { text: "Max", tone: "max" },
  [CodeGenerationModel.GPT_5_6_SOL_MAX]: { text: "Max", tone: "max" },
};

// Badges are only shown on create flows and on any video flow. In particular
// image/text update runs reuse Flash-minimal but should stay unlabelled.
export function getVariantLabel(
  model: string | undefined,
  context: VariantLabelContext
): VariantLabel | null {
  if (!model) return null;
  const showLabels =
    context.generationType === "create" || context.inputMode === "video";
  if (!showLabels) return null;
  return VARIANT_LABELS[model as CodeGenerationModel] ?? null;
}

// Will generate a static error if a model in the enum above is not in the descriptions
export const CODE_GENERATION_MODEL_DESCRIPTIONS: {
  [key in CodeGenerationModel]: { name: string };
} = {
  "gpt-5.6-sol (no thinking)": {
    name: "GPT 5.6 Sol (none)",
  },
  "gpt-5.6-sol (low thinking)": {
    name: "GPT 5.6 Sol (low)",
  },
  "gpt-5.6-sol (medium thinking)": {
    name: "GPT 5.6 Sol (medium)",
  },
  "gpt-5.6-sol (high thinking)": {
    name: "GPT 5.6 Sol (high)",
  },
  "gpt-5.6-sol (xhigh thinking)": {
    name: "GPT 5.6 Sol (xhigh)",
  },
  "gpt-5.6-sol (max thinking)": {
    name: "GPT 5.6 Sol (max)",
  },
  "gpt-5.6-terra (low thinking)": {
    name: "GPT 5.6 Terra (low)",
  },
  "gpt-5.5 (no thinking)": {
    name: "GPT 5.5 (none)",
  },
  "gpt-5.5 (low thinking)": {
    name: "GPT 5.5 (low)",
  },
  "gpt-5.5 (medium thinking)": {
    name: "GPT 5.5 (medium)",
  },
  "gpt-5.5 (high thinking)": {
    name: "GPT 5.5 (high)",
  },
  "gpt-5.5 (xhigh thinking)": {
    name: "GPT 5.5 (xhigh)",
  },
  "gpt-5.4-mini (low thinking)": {
    name: "GPT 5.4 Mini (low)",
  },
  "claude-opus-5 (low effort)": {
    name: "Claude Opus 5 (low)",
  },
  "claude-opus-5 (medium effort)": {
    name: "Claude Opus 5 (medium)",
  },
  "claude-opus-5 (high effort)": {
    name: "Claude Opus 5 (high)",
  },
  "claude-opus-5 (xhigh effort)": {
    name: "Claude Opus 5 (xhigh)",
  },
  "claude-opus-5 (max effort)": {
    name: "Claude Opus 5 (max)",
  },
  "claude-opus-4-8 (low effort)": {
    name: "Claude Opus 4.8 (low)",
  },
  "claude-opus-4-8 (medium effort)": {
    name: "Claude Opus 4.8 (medium)",
  },
  "claude-opus-4-8 (high effort)": {
    name: "Claude Opus 4.8 (high)",
  },
  "claude-opus-4-8 (xhigh effort)": {
    name: "Claude Opus 4.8 (xhigh)",
  },
  "claude-opus-4-8 (max effort)": {
    name: "Claude Opus 4.8 (max)",
  },
  "claude-fable-5 (max effort)": {
    name: "Claude Fable 5 (max)",
  },
  "claude-sonnet-4-6": { name: "Claude Sonnet 4.6" },
  "gemini-3.5-flash (high thinking)": {
    name: "Gemini 3.5 Flash (high)",
  },
  "gemini-3.5-flash (medium thinking)": {
    name: "Gemini 3.5 Flash (medium)",
  },
  "gemini-3.5-flash (low thinking)": {
    name: "Gemini 3.5 Flash (low)",
  },
  "gemini-3.5-flash (minimal thinking)": {
    name: "Gemini 3.5 Flash (minimal)",
  },
  "gemini-3.6-flash (high thinking)": {
    name: "Gemini 3.6 Flash (high)",
  },
  "gemini-3.6-flash (medium thinking)": {
    name: "Gemini 3.6 Flash (medium)",
  },
  "gemini-3.6-flash (low thinking)": {
    name: "Gemini 3.6 Flash (low)",
  },
  "gemini-3.6-flash (minimal thinking)": {
    name: "Gemini 3.6 Flash (minimal)",
  },
  "gemini-3-flash-preview (high thinking)": {
    name: "Gemini 3 Flash (high)",
  },
  "gemini-3-flash-preview (minimal thinking)": {
    name: "Gemini 3 Flash (minimal)",
  },
  "gemini-3.1-pro-preview (high thinking)": {
    name: "Gemini 3.1 Pro (high)",
  },
  "gemini-3.1-pro-preview (medium thinking)": {
    name: "Gemini 3.1 Pro (medium)",
  },
  "gemini-3.1-pro-preview (low thinking)": {
    name: "Gemini 3.1 Pro (low)",
  },
  "copilot/claude-sonnet-5": { name: "Copilot: Claude Sonnet 5" },
  "copilot/claude-opus-5": { name: "Copilot: Claude Opus 5" },
  "copilot/claude-opus-4.8": { name: "Copilot: Claude Opus 4.8" },
  "copilot/claude-opus-4.7": { name: "Copilot: Claude Opus 4.7" },
  "copilot/claude-opus-4.6": { name: "Copilot: Claude Opus 4.6" },
  "copilot/claude-sonnet-4.6": { name: "Copilot: Claude Sonnet 4.6" },
  "copilot/claude-haiku-4.5": { name: "Copilot: Claude Haiku 4.5" },
  "copilot/gpt-6-astra": { name: "Copilot: GPT-6 Astra" },
  "copilot/gpt-5.6-sol": { name: "Copilot: GPT 5.6 Sol" },
  "copilot/gpt-5.6-sol-fast": { name: "Copilot: GPT 5.6 Sol Fast" },
  "copilot/gpt-5.6-terra": { name: "Copilot: GPT 5.6 Terra" },
  "copilot/gpt-5.6-luna": { name: "Copilot: GPT 5.6 Luna" },
  "copilot/gpt-5.5": { name: "Copilot: GPT 5.5" },
  "copilot/gpt-5.4": { name: "Copilot: GPT 5.4" },
  "copilot/gpt-5.4-mini": { name: "Copilot: GPT 5.4 Mini" },
  "copilot/gpt-5.3-codex": { name: "Copilot: GPT 5.3 Codex" },
  "copilot/gpt-5-mini": { name: "Copilot: GPT 5 Mini" },
  "copilot/gemini-3.8-flash": { name: "Copilot: Gemini 3.8 Flash" },
  "copilot/gemini-3.7-flash": { name: "Copilot: Gemini 3.7 Flash" },
  "copilot/gemini-3.6-flash": { name: "Copilot: Gemini 3.6 Flash" },
  "copilot/gemini-3.5-flash": { name: "Copilot: Gemini 3.5 Flash" },
  "copilot/grok-4.6": { name: "Copilot: Grok 4.6" },
  "copilot/grok-4.5": { name: "Copilot: Grok 4.5" },
  "copilot/mai-code-1.1-flash": { name: "Copilot: MAI Code 1.1 Flash" },
};
