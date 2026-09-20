"""Validation for the integrations a user configures in Settings.

``config`` is deliberately free of any Copilot SDK import so the model catalog
and the validation route can use it without paying for the SDK's import cost.
``copilot_sdk`` holds everything that touches the SDK.

Copilot SDK BYOK is an *additive* runtime: it has its own dedicated connection
credentials and its own run identities (``sdk-byok/<provider>/<base model>``),
and it never changes how the direct OpenAI/Anthropic/Gemini/Replicate settings
behave. A native selection always runs on its native provider.
"""

from integrations.config import (
    BYOK_PROVIDERS,
    BYOK_SELECTION_PREFIX,
    CUSTOM_ID_SEGMENT,
    EMPTY_INTEGRATIONS,
    MODEL_RUNTIMES,
    ByokConnection,
    ByokConnectionSummary,
    ByokProvider,
    ByokSelection,
    IntegrationConfigError,
    IntegrationDiagnostic,
    IntegrationSettings,
    McpServerSettings,
    McpTransport,
    ModelRuntime,
    WireApi,
    byok_custom_selection_id,
    byok_selection_id,
    is_valid_wire_model,
    neutral_base_model,
    is_byok_selection_id,
    parse_byok_selection_id,
    parse_integration_settings,
    redact_mapping,
)

__all__ = [
    "BYOK_PROVIDERS",
    "BYOK_SELECTION_PREFIX",
    "CUSTOM_ID_SEGMENT",
    "EMPTY_INTEGRATIONS",
    "MODEL_RUNTIMES",
    "ByokConnection",
    "ByokConnectionSummary",
    "ByokProvider",
    "ByokSelection",
    "IntegrationConfigError",
    "IntegrationDiagnostic",
    "IntegrationSettings",
    "McpServerSettings",
    "McpTransport",
    "ModelRuntime",
    "WireApi",
    "byok_custom_selection_id",
    "byok_selection_id",
    "is_valid_wire_model",
    "neutral_base_model",
    "is_byok_selection_id",
    "parse_byok_selection_id",
    "parse_integration_settings",
    "redact_mapping",
]
