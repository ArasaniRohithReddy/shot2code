from enum import Enum
from typing import Literal, TypedDict, cast, get_args

# Every provider shot2code can route a generation to. Keeping this a Literal
# (rather than a bare str) means a typo in a provider name is a type error
# instead of a model that silently never matches.
#
# "sdk-byok" is a runtime rather than a vendor: models under it are the user's
# own Copilot SDK BYOK profiles, each addressed by its own selection id. No
# member of :class:`Llm` belongs to it, and enabling it never changes how the
# direct openai/anthropic/gemini providers behave.
ModelProvider = Literal["openai", "anthropic", "gemini", "copilot", "sdk-byok"]
CopilotSdkReasoningEffort = Literal["low", "medium", "high", "xhigh", "max"]

MODEL_PROVIDERS: tuple[ModelProvider, ...] = get_args(ModelProvider)


# Actual model versions that are passed to the LLMs and stored in our logs
class Llm(Enum):
    # GPT
    GPT_5_4_MINI_LOW = "gpt-5.4-mini (low thinking)"
    GPT_5_4_2026_03_05_NONE = "gpt-5.4-2026-03-05 (no thinking)"
    GPT_5_4_2026_03_05_LOW = "gpt-5.4-2026-03-05 (low thinking)"
    GPT_5_4_2026_03_05_MEDIUM = "gpt-5.4-2026-03-05 (medium thinking)"
    GPT_5_4_2026_03_05_HIGH = "gpt-5.4-2026-03-05 (high thinking)"
    GPT_5_4_2026_03_05_XHIGH = "gpt-5.4-2026-03-05 (xhigh thinking)"
    GPT_5_5_NONE = "gpt-5.5 (no thinking)"
    GPT_5_5_LOW = "gpt-5.5 (low thinking)"
    GPT_5_5_MEDIUM = "gpt-5.5 (medium thinking)"
    GPT_5_5_HIGH = "gpt-5.5 (high thinking)"
    GPT_5_5_XHIGH = "gpt-5.5 (xhigh thinking)"
    GPT_5_6_SOL_NONE = "gpt-5.6-sol (no thinking)"
    GPT_5_6_SOL_LOW = "gpt-5.6-sol (low thinking)"
    GPT_5_6_SOL_MEDIUM = "gpt-5.6-sol (medium thinking)"
    GPT_5_6_SOL_HIGH = "gpt-5.6-sol (high thinking)"
    GPT_5_6_SOL_XHIGH = "gpt-5.6-sol (xhigh thinking)"
    GPT_5_6_SOL_MAX = "gpt-5.6-sol (max thinking)"
    GPT_5_6_TERRA_LOW = "gpt-5.6-terra (low thinking)"
    # Claude
    CLAUDE_SONNET_4_6 = "claude-sonnet-4-6"
    CLAUDE_OPUS_5_LOW = "claude-opus-5 (low effort)"
    CLAUDE_OPUS_5_MEDIUM = "claude-opus-5 (medium effort)"
    CLAUDE_OPUS_5_HIGH = "claude-opus-5 (high effort)"
    CLAUDE_OPUS_5_XHIGH = "claude-opus-5 (xhigh effort)"
    CLAUDE_OPUS_5_MAX = "claude-opus-5 (max effort)"
    CLAUDE_OPUS_4_8_LOW = "claude-opus-4-8 (low effort)"
    CLAUDE_OPUS_4_8_MEDIUM = "claude-opus-4-8 (medium effort)"
    CLAUDE_OPUS_4_8_HIGH = "claude-opus-4-8 (high effort)"
    CLAUDE_OPUS_4_8_XHIGH = "claude-opus-4-8 (xhigh effort)"
    CLAUDE_OPUS_4_8_MAX = "claude-opus-4-8 (max effort)"
    CLAUDE_FABLE_5_LOW = "claude-fable-5 (low effort)"
    CLAUDE_FABLE_5_MEDIUM = "claude-fable-5 (medium effort)"
    CLAUDE_FABLE_5_HIGH = "claude-fable-5 (high effort)"
    CLAUDE_FABLE_5_XHIGH = "claude-fable-5 (xhigh effort)"
    CLAUDE_FABLE_5_MAX = "claude-fable-5 (max effort)"
    # Gemini
    GEMINI_3_FLASH_PREVIEW_HIGH = "gemini-3-flash-preview (high thinking)"
    GEMINI_3_FLASH_PREVIEW_MINIMAL = "gemini-3-flash-preview (minimal thinking)"
    GEMINI_3_1_PRO_PREVIEW_HIGH = "gemini-3.1-pro-preview (high thinking)"
    GEMINI_3_1_PRO_PREVIEW_MEDIUM = "gemini-3.1-pro-preview (medium thinking)"
    GEMINI_3_1_PRO_PREVIEW_LOW = "gemini-3.1-pro-preview (low thinking)"
    GEMINI_3_5_FLASH_HIGH = "gemini-3.5-flash (high thinking)"
    GEMINI_3_5_FLASH_MEDIUM = "gemini-3.5-flash (medium thinking)"
    GEMINI_3_5_FLASH_LOW = "gemini-3.5-flash (low thinking)"
    GEMINI_3_5_FLASH_MINIMAL = "gemini-3.5-flash (minimal thinking)"
    GEMINI_3_6_FLASH_HIGH = "gemini-3.6-flash (high thinking)"
    GEMINI_3_6_FLASH_MEDIUM = "gemini-3.6-flash (medium thinking)"
    GEMINI_3_6_FLASH_LOW = "gemini-3.6-flash (low thinking)"
    GEMINI_3_6_FLASH_MINIMAL = "gemini-3.6-flash (minimal thinking)"
    # GitHub Copilot - routed through the Copilot SDK using the user's own
    # Copilot subscription (or BYOK). All are vision-capable, which
    # screenshot-to-code requires.
    COPILOT_CLAUDE_SONNET_5 = "copilot/claude-sonnet-5"
    COPILOT_CLAUDE_OPUS_5 = "copilot/claude-opus-5"
    COPILOT_CLAUDE_OPUS_4_8 = "copilot/claude-opus-4.8"
    COPILOT_CLAUDE_OPUS_4_7 = "copilot/claude-opus-4.7"
    COPILOT_CLAUDE_OPUS_4_6 = "copilot/claude-opus-4.6"
    COPILOT_CLAUDE_SONNET_4_6 = "copilot/claude-sonnet-4.6"
    COPILOT_CLAUDE_HAIKU_4_5 = "copilot/claude-haiku-4.5"
    COPILOT_GPT_6_ASTRA = "copilot/gpt-6-astra"
    COPILOT_GPT_5_6_SOL = "copilot/gpt-5.6-sol"
    COPILOT_GPT_5_6_SOL_FAST = "copilot/gpt-5.6-sol-fast"
    COPILOT_GPT_5_6_TERRA = "copilot/gpt-5.6-terra"
    COPILOT_GPT_5_6_LUNA = "copilot/gpt-5.6-luna"
    COPILOT_GPT_5_5 = "copilot/gpt-5.5"
    COPILOT_GPT_5_4 = "copilot/gpt-5.4"
    COPILOT_GPT_5_4_MINI = "copilot/gpt-5.4-mini"
    COPILOT_GPT_5_3_CODEX = "copilot/gpt-5.3-codex"
    COPILOT_GPT_5_MINI = "copilot/gpt-5-mini"
    COPILOT_GEMINI_3_8_FLASH = "copilot/gemini-3.8-flash"
    COPILOT_GEMINI_3_7_FLASH = "copilot/gemini-3.7-flash"
    COPILOT_GEMINI_3_6_FLASH = "copilot/gemini-3.6-flash"
    COPILOT_GEMINI_3_5_FLASH = "copilot/gemini-3.5-flash"
    COPILOT_GROK_4_6 = "copilot/grok-4.6"
    COPILOT_GROK_4_5 = "copilot/grok-4.5"
    COPILOT_MAI_CODE_1_1_FLASH = "copilot/mai-code-1.1-flash"


class Completion(TypedDict):
    duration: float
    code: str


# Explicitly map each model to the provider backing it.  This keeps provider
# groupings authoritative and avoids relying on name conventions when checking
# models elsewhere in the codebase.
MODEL_PROVIDER: dict[Llm, ModelProvider] = {
    # OpenAI models
    Llm.GPT_5_4_MINI_LOW: "openai",
    Llm.GPT_5_4_2026_03_05_NONE: "openai",
    Llm.GPT_5_4_2026_03_05_LOW: "openai",
    Llm.GPT_5_4_2026_03_05_MEDIUM: "openai",
    Llm.GPT_5_4_2026_03_05_HIGH: "openai",
    Llm.GPT_5_4_2026_03_05_XHIGH: "openai",
    Llm.GPT_5_5_NONE: "openai",
    Llm.GPT_5_5_LOW: "openai",
    Llm.GPT_5_5_MEDIUM: "openai",
    Llm.GPT_5_5_HIGH: "openai",
    Llm.GPT_5_5_XHIGH: "openai",
    Llm.GPT_5_6_SOL_NONE: "openai",
    Llm.GPT_5_6_SOL_LOW: "openai",
    Llm.GPT_5_6_SOL_MEDIUM: "openai",
    Llm.GPT_5_6_SOL_HIGH: "openai",
    Llm.GPT_5_6_SOL_XHIGH: "openai",
    Llm.GPT_5_6_SOL_MAX: "openai",
    Llm.GPT_5_6_TERRA_LOW: "openai",
    # Anthropic models
    Llm.CLAUDE_SONNET_4_6: "anthropic",
    Llm.CLAUDE_OPUS_5_LOW: "anthropic",
    Llm.CLAUDE_OPUS_5_MEDIUM: "anthropic",
    Llm.CLAUDE_OPUS_5_HIGH: "anthropic",
    Llm.CLAUDE_OPUS_5_XHIGH: "anthropic",
    Llm.CLAUDE_OPUS_5_MAX: "anthropic",
    Llm.CLAUDE_OPUS_4_8_LOW: "anthropic",
    Llm.CLAUDE_OPUS_4_8_MEDIUM: "anthropic",
    Llm.CLAUDE_OPUS_4_8_HIGH: "anthropic",
    Llm.CLAUDE_OPUS_4_8_XHIGH: "anthropic",
    Llm.CLAUDE_OPUS_4_8_MAX: "anthropic",
    Llm.CLAUDE_FABLE_5_LOW: "anthropic",
    Llm.CLAUDE_FABLE_5_MEDIUM: "anthropic",
    Llm.CLAUDE_FABLE_5_HIGH: "anthropic",
    Llm.CLAUDE_FABLE_5_XHIGH: "anthropic",
    Llm.CLAUDE_FABLE_5_MAX: "anthropic",
    # Gemini models
    Llm.GEMINI_3_FLASH_PREVIEW_HIGH: "gemini",
    Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL: "gemini",
    Llm.GEMINI_3_1_PRO_PREVIEW_HIGH: "gemini",
    Llm.GEMINI_3_1_PRO_PREVIEW_MEDIUM: "gemini",
    Llm.GEMINI_3_1_PRO_PREVIEW_LOW: "gemini",
    Llm.GEMINI_3_5_FLASH_HIGH: "gemini",
    Llm.GEMINI_3_5_FLASH_MEDIUM: "gemini",
    Llm.GEMINI_3_5_FLASH_LOW: "gemini",
    Llm.GEMINI_3_5_FLASH_MINIMAL: "gemini",
    Llm.GEMINI_3_6_FLASH_HIGH: "gemini",
    Llm.GEMINI_3_6_FLASH_MEDIUM: "gemini",
    Llm.GEMINI_3_6_FLASH_LOW: "gemini",
    Llm.GEMINI_3_6_FLASH_MINIMAL: "gemini",
    # GitHub Copilot models
    Llm.COPILOT_CLAUDE_SONNET_5: "copilot",
    Llm.COPILOT_CLAUDE_OPUS_5: "copilot",
    Llm.COPILOT_CLAUDE_OPUS_4_8: "copilot",
    Llm.COPILOT_CLAUDE_OPUS_4_7: "copilot",
    Llm.COPILOT_CLAUDE_OPUS_4_6: "copilot",
    Llm.COPILOT_CLAUDE_SONNET_4_6: "copilot",
    Llm.COPILOT_CLAUDE_HAIKU_4_5: "copilot",
    Llm.COPILOT_GPT_6_ASTRA: "copilot",
    Llm.COPILOT_GPT_5_6_SOL: "copilot",
    Llm.COPILOT_GPT_5_6_SOL_FAST: "copilot",
    Llm.COPILOT_GPT_5_6_TERRA: "copilot",
    Llm.COPILOT_GPT_5_6_LUNA: "copilot",
    Llm.COPILOT_GPT_5_5: "copilot",
    Llm.COPILOT_GPT_5_4: "copilot",
    Llm.COPILOT_GPT_5_4_MINI: "copilot",
    Llm.COPILOT_GPT_5_3_CODEX: "copilot",
    Llm.COPILOT_GPT_5_MINI: "copilot",
    Llm.COPILOT_GEMINI_3_8_FLASH: "copilot",
    Llm.COPILOT_GEMINI_3_7_FLASH: "copilot",
    Llm.COPILOT_GEMINI_3_6_FLASH: "copilot",
    Llm.COPILOT_GEMINI_3_5_FLASH: "copilot",
    Llm.COPILOT_GROK_4_6: "copilot",
    Llm.COPILOT_GROK_4_5: "copilot",
    Llm.COPILOT_MAI_CODE_1_1_FLASH: "copilot",
}

# Convenience sets for membership checks
OPENAI_MODELS = {m for m, p in MODEL_PROVIDER.items() if p == "openai"}
ANTHROPIC_MODELS = {m for m, p in MODEL_PROVIDER.items() if p == "anthropic"}
GEMINI_MODELS = {m for m, p in MODEL_PROVIDER.items() if p == "gemini"}
COPILOT_MODELS = {m for m, p in MODEL_PROVIDER.items() if p == "copilot"}

# Every model keyed by the string that crosses the wire (the enum value). The
# websocket request, history records and eval logs all identify a model by this
# string, so parsing goes through one place.
MODELS_BY_VALUE: dict[str, Llm] = {model.value: model for model in Llm}


def model_from_value(value: object) -> Llm | None:
    """The model a client-supplied id refers to, or ``None`` when unknown."""
    if not isinstance(value, str):
        return None
    return MODELS_BY_VALUE.get(value)


def provider_for_model(model: Llm) -> ModelProvider:
    """The provider that serves a model. Total over the enum by construction."""
    return MODEL_PROVIDER[model]


# Copilot model ids as reported by the SDK's list_models(), plus the reasoning
# effort to request. All of these are vision-capable, which screenshot-to-code
# requires.
COPILOT_MODEL_CONFIG: dict[Llm, dict[str, str]] = {
    Llm.COPILOT_CLAUDE_SONNET_5: {"api_name": "claude-sonnet-5"},
    Llm.COPILOT_CLAUDE_OPUS_5: {"api_name": "claude-opus-5"},
    Llm.COPILOT_CLAUDE_OPUS_4_8: {"api_name": "claude-opus-4.8"},
    Llm.COPILOT_CLAUDE_OPUS_4_7: {"api_name": "claude-opus-4.7"},
    Llm.COPILOT_CLAUDE_OPUS_4_6: {"api_name": "claude-opus-4.6"},
    Llm.COPILOT_CLAUDE_SONNET_4_6: {"api_name": "claude-sonnet-4.6"},
    Llm.COPILOT_CLAUDE_HAIKU_4_5: {"api_name": "claude-haiku-4.5"},
    Llm.COPILOT_GPT_6_ASTRA: {"api_name": "gpt-6-astra"},
    Llm.COPILOT_GPT_5_6_SOL: {"api_name": "gpt-5.6-sol"},
    Llm.COPILOT_GPT_5_6_SOL_FAST: {"api_name": "gpt-5.6-sol-fast"},
    Llm.COPILOT_GPT_5_6_TERRA: {"api_name": "gpt-5.6-terra"},
    Llm.COPILOT_GPT_5_6_LUNA: {"api_name": "gpt-5.6-luna"},
    Llm.COPILOT_GPT_5_5: {"api_name": "gpt-5.5"},
    Llm.COPILOT_GPT_5_4: {"api_name": "gpt-5.4"},
    Llm.COPILOT_GPT_5_4_MINI: {"api_name": "gpt-5.4-mini"},
    Llm.COPILOT_GPT_5_3_CODEX: {"api_name": "gpt-5.3-codex"},
    Llm.COPILOT_GPT_5_MINI: {"api_name": "gpt-5-mini"},
    Llm.COPILOT_GEMINI_3_8_FLASH: {"api_name": "gemini-3.8-flash"},
    Llm.COPILOT_GEMINI_3_7_FLASH: {"api_name": "gemini-3.7-flash"},
    Llm.COPILOT_GEMINI_3_6_FLASH: {"api_name": "gemini-3.6-flash"},
    Llm.COPILOT_GEMINI_3_5_FLASH: {"api_name": "gemini-3.5-flash"},
    Llm.COPILOT_GROK_4_6: {"api_name": "grok-4.6"},
    Llm.COPILOT_GROK_4_5: {"api_name": "grok-4.5"},
    Llm.COPILOT_MAI_CODE_1_1_FLASH: {"api_name": "mai-code-1.1-flash"},
}


def get_copilot_api_name(model: Llm) -> str:
    return COPILOT_MODEL_CONFIG[model]["api_name"]


def get_copilot_reasoning_effort(model: Llm) -> str | None:
    return COPILOT_MODEL_CONFIG.get(model, {}).get("reasoning_effort")

OPENAI_MODEL_CONFIG: dict[Llm, dict[str, str]] = {
    Llm.GPT_5_4_MINI_LOW: {"api_name": "gpt-5.4-mini", "reasoning_effort": "low"},
    Llm.GPT_5_4_2026_03_05_NONE: {
        "api_name": "gpt-5.4-2026-03-05",
        "reasoning_effort": "none",
    },
    Llm.GPT_5_4_2026_03_05_LOW: {
        "api_name": "gpt-5.4-2026-03-05",
        "reasoning_effort": "low",
    },
    Llm.GPT_5_4_2026_03_05_MEDIUM: {
        "api_name": "gpt-5.4-2026-03-05",
        "reasoning_effort": "medium",
    },
    Llm.GPT_5_4_2026_03_05_HIGH: {
        "api_name": "gpt-5.4-2026-03-05",
        "reasoning_effort": "high",
    },
    Llm.GPT_5_4_2026_03_05_XHIGH: {
        "api_name": "gpt-5.4-2026-03-05",
        "reasoning_effort": "xhigh",
    },
    Llm.GPT_5_5_NONE: {"api_name": "gpt-5.5", "reasoning_effort": "none"},
    Llm.GPT_5_5_LOW: {"api_name": "gpt-5.5", "reasoning_effort": "low"},
    Llm.GPT_5_5_MEDIUM: {"api_name": "gpt-5.5", "reasoning_effort": "medium"},
    Llm.GPT_5_5_HIGH: {"api_name": "gpt-5.5", "reasoning_effort": "high"},
    Llm.GPT_5_5_XHIGH: {"api_name": "gpt-5.5", "reasoning_effort": "xhigh"},
    Llm.GPT_5_6_SOL_NONE: {"api_name": "gpt-5.6-sol", "reasoning_effort": "none"},
    Llm.GPT_5_6_SOL_LOW: {"api_name": "gpt-5.6-sol", "reasoning_effort": "low"},
    Llm.GPT_5_6_SOL_MEDIUM: {"api_name": "gpt-5.6-sol", "reasoning_effort": "medium"},
    Llm.GPT_5_6_SOL_HIGH: {"api_name": "gpt-5.6-sol", "reasoning_effort": "high"},
    Llm.GPT_5_6_SOL_XHIGH: {"api_name": "gpt-5.6-sol", "reasoning_effort": "xhigh"},
    Llm.GPT_5_6_SOL_MAX: {"api_name": "gpt-5.6-sol", "reasoning_effort": "max"},
    Llm.GPT_5_6_TERRA_LOW: {"api_name": "gpt-5.6-terra", "reasoning_effort": "low"},
}


def get_openai_api_name(model: Llm) -> str:
    return OPENAI_MODEL_CONFIG[model]["api_name"]


def get_openai_reasoning_effort(model: Llm) -> str | None:
    return OPENAI_MODEL_CONFIG.get(model, {}).get("reasoning_effort")


# Anthropic API model ids plus the thinking effort each variant requests.
ANTHROPIC_MODEL_CONFIG: dict[Llm, dict[str, str]] = {
    Llm.CLAUDE_OPUS_5_LOW: {"api_name": "claude-opus-5", "effort": "low"},
    Llm.CLAUDE_OPUS_5_MEDIUM: {"api_name": "claude-opus-5", "effort": "medium"},
    Llm.CLAUDE_OPUS_5_HIGH: {"api_name": "claude-opus-5", "effort": "high"},
    Llm.CLAUDE_OPUS_5_XHIGH: {"api_name": "claude-opus-5", "effort": "xhigh"},
    Llm.CLAUDE_OPUS_5_MAX: {"api_name": "claude-opus-5", "effort": "max"},
    Llm.CLAUDE_OPUS_4_8_LOW: {"api_name": "claude-opus-4-8", "effort": "low"},
    Llm.CLAUDE_OPUS_4_8_MEDIUM: {"api_name": "claude-opus-4-8", "effort": "medium"},
    Llm.CLAUDE_OPUS_4_8_HIGH: {"api_name": "claude-opus-4-8", "effort": "high"},
    Llm.CLAUDE_OPUS_4_8_XHIGH: {"api_name": "claude-opus-4-8", "effort": "xhigh"},
    Llm.CLAUDE_OPUS_4_8_MAX: {"api_name": "claude-opus-4-8", "effort": "max"},
    Llm.CLAUDE_FABLE_5_LOW: {"api_name": "claude-fable-5", "effort": "low"},
    Llm.CLAUDE_FABLE_5_MEDIUM: {"api_name": "claude-fable-5", "effort": "medium"},
    Llm.CLAUDE_FABLE_5_HIGH: {"api_name": "claude-fable-5", "effort": "high"},
    Llm.CLAUDE_FABLE_5_XHIGH: {"api_name": "claude-fable-5", "effort": "xhigh"},
    Llm.CLAUDE_FABLE_5_MAX: {"api_name": "claude-fable-5", "effort": "max"},
}


def get_anthropic_api_name(model: Llm) -> str:
    return ANTHROPIC_MODEL_CONFIG.get(model, {}).get("api_name", model.value)


def get_anthropic_effort(model: Llm) -> str:
    configured_effort = ANTHROPIC_MODEL_CONFIG.get(model, {}).get("effort")
    if configured_effort:
        return configured_effort
    if model == Llm.CLAUDE_SONNET_4_6:
        return "high"
    return "max"


# Gemini API model ids plus the thinking level each variant requests.
GEMINI_MODEL_CONFIG: dict[Llm, dict[str, str]] = {
    Llm.GEMINI_3_FLASH_PREVIEW_HIGH: {
        "api_name": "gemini-3-flash-preview",
        "thinking_level": "high",
    },
    Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL: {
        "api_name": "gemini-3-flash-preview",
        "thinking_level": "minimal",
    },
    Llm.GEMINI_3_1_PRO_PREVIEW_HIGH: {
        "api_name": "gemini-3.1-pro-preview",
        "thinking_level": "high",
    },
    Llm.GEMINI_3_1_PRO_PREVIEW_MEDIUM: {
        "api_name": "gemini-3.1-pro-preview",
        "thinking_level": "medium",
    },
    Llm.GEMINI_3_1_PRO_PREVIEW_LOW: {
        "api_name": "gemini-3.1-pro-preview",
        "thinking_level": "low",
    },
    Llm.GEMINI_3_5_FLASH_HIGH: {
        "api_name": "gemini-3.5-flash",
        "thinking_level": "high",
    },
    Llm.GEMINI_3_5_FLASH_MEDIUM: {
        "api_name": "gemini-3.5-flash",
        "thinking_level": "medium",
    },
    Llm.GEMINI_3_5_FLASH_LOW: {
        "api_name": "gemini-3.5-flash",
        "thinking_level": "low",
    },
    Llm.GEMINI_3_5_FLASH_MINIMAL: {
        "api_name": "gemini-3.5-flash",
        "thinking_level": "minimal",
    },
    Llm.GEMINI_3_6_FLASH_HIGH: {
        "api_name": "gemini-3.6-flash",
        "thinking_level": "high",
    },
    Llm.GEMINI_3_6_FLASH_MEDIUM: {
        "api_name": "gemini-3.6-flash",
        "thinking_level": "medium",
    },
    Llm.GEMINI_3_6_FLASH_LOW: {
        "api_name": "gemini-3.6-flash",
        "thinking_level": "low",
    },
    Llm.GEMINI_3_6_FLASH_MINIMAL: {
        "api_name": "gemini-3.6-flash",
        "thinking_level": "minimal",
    },
}


def get_gemini_api_name(model: Llm) -> str:
    return GEMINI_MODEL_CONFIG.get(model, {}).get("api_name", model.value)


def get_gemini_thinking_level(model: Llm) -> str:
    return GEMINI_MODEL_CONFIG.get(model, {}).get("thinking_level", "high")


def get_model_api_name(model: Llm) -> str:
    """The id the provider's own API knows this model by."""
    provider = provider_for_model(model)
    if provider == "openai":
        return get_openai_api_name(model)
    if provider == "anthropic":
        return get_anthropic_api_name(model)
    if provider == "gemini":
        return get_gemini_api_name(model)
    return get_copilot_api_name(model)


def get_model_effort(model: Llm) -> str | None:
    """The reasoning/thinking setting a model variant requests, if any.

    Unlike the provider-level helpers this never substitutes a default: a model
    with no configured effort has none to display.
    """
    provider = provider_for_model(model)
    if provider == "openai":
        return OPENAI_MODEL_CONFIG.get(model, {}).get("reasoning_effort")
    if provider == "anthropic":
        return ANTHROPIC_MODEL_CONFIG.get(model, {}).get("effort")
    if provider == "gemini":
        return GEMINI_MODEL_CONFIG.get(model, {}).get("thinking_level")
    return COPILOT_MODEL_CONFIG.get(model, {}).get("reasoning_effort")


def get_copilot_sdk_reasoning_effort(
    model: Llm,
) -> CopilotSdkReasoningEffort | None:
    """Translate a model variant's effort to the values accepted by the SDK."""
    effort = get_model_effort(model)
    if effort not in get_args(CopilotSdkReasoningEffort):
        return None
    return cast(CopilotSdkReasoningEffort, effort)
