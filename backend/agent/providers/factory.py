import os
from typing import Optional

import copilot
from anthropic import AsyncAnthropic
from google import genai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from agent.providers.anthropic import AnthropicProviderSession, serialize_anthropic_tools
from agent.providers.base import ProviderSession
from agent.providers.gemini import GeminiProviderSession, serialize_gemini_tools
from agent.providers.github_copilot import (
    CopilotProviderSession,
    serialize_copilot_tools,
)
from agent.providers.openai import OpenAIProviderSession, serialize_openai_tools
from agent.tools import CanonicalToolDefinition, canonical_tool_definitions
from config import COPILOT_GITHUB_TOKEN, REPLICATE_API_KEY
from fs_logging.agent_runs import AgentRunRecorder
from integrations.config import (
    EMPTY_INTEGRATIONS,
    ByokConnection,
    IntegrationSettings,
)
from integrations.copilot_sdk import (
    base_model_api_name,
    build_mcp_servers,
    build_permission_handler,
    build_provider_config,
    copilot_base_directory,
)
from llm import (
    Llm,
    ModelProvider,
    get_copilot_sdk_reasoning_effort,
    provider_for_model,
)
from model_catalog import PROVIDER_CREDENTIAL_LABELS, PROVIDER_LABELS
from preview_screenshot import is_screenshot_preview_available


class MissingProviderCredentialError(Exception):
    """Raised when a model's provider has no usable credential configured.

    Carries the provider so callers can say which key to add rather than
    reporting a generic failure.
    """

    def __init__(self, provider: ModelProvider, model: Llm):
        self.provider = provider
        self.model = model
        super().__init__(
            f"{PROVIDER_LABELS[provider]} is missing a "
            f"{PROVIDER_CREDENTIAL_LABELS[provider]}, which "
            f"{model.value} needs. Add it in Settings or backend/.env."
        )


def _contains_video(messages: list[ChatCompletionMessageParam]) -> bool:
    """True when a prompt carries a video, which Copilot receives as frames."""
    for message in messages:
        content = message.get("content", "")
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "image_url":
                continue
            url = (part.get("image_url") or {}).get("url", "")
            if isinstance(url, str) and url.startswith("data:video/"):
                return True
    return False


def create_provider_session(
    model: Llm,
    prompt_messages: list[ChatCompletionMessageParam],
    should_generate_images: bool,
    openai_api_key: Optional[str],
    openai_base_url: Optional[str],
    anthropic_api_key: Optional[str],
    gemini_api_key: Optional[str],
    replicate_api_key: Optional[str],
    should_extract_assets: bool = True,
    recorder: Optional[AgentRunRecorder] = None,
    copilot_github_token: Optional[str] = None,
    integrations: Optional[IntegrationSettings] = None,
    byok_connection: Optional[ByokConnection] = None,
) -> ProviderSession:
    settings = integrations or EMPTY_INTEGRATIONS
    canonical_tools = canonical_tool_definitions(
        image_generation_enabled=should_generate_images,
        # The edit_images tool calls Replicate, so don't offer it without a key.
        image_editing_enabled=bool(replicate_api_key or REPLICATE_API_KEY),
        # The extract_assets tool calls Gemini, so don't offer it without a key.
        asset_extraction_enabled=should_extract_assets and bool(gemini_api_key),
        # screenshot_preview needs headless Chromium; skip it if it can't launch.
        screenshot_enabled=is_screenshot_preview_available(),
    )

    # The Copilot SDK BYOK runtime is only ever entered by a selection that
    # explicitly asked for it. Nothing below this point changes when BYOK is
    # configured: a native selection keeps running on its own provider with its
    # own client and its own key, exactly as it did before BYOK existed.
    if byok_connection is not None:
        return _create_byok_session(
            model=model,
            connection=byok_connection,
            settings=settings,
            prompt_messages=prompt_messages,
            canonical_tools=canonical_tools,
            recorder=recorder,
        )

    provider = provider_for_model(model)

    if provider == "openai":
        if not openai_api_key:
            raise MissingProviderCredentialError(provider, model)

        client = AsyncOpenAI(api_key=openai_api_key, base_url=openai_base_url)
        return OpenAIProviderSession(
            client=client,
            model=model,
            prompt_messages=prompt_messages,
            tools=serialize_openai_tools(canonical_tools),
            recorder=recorder,
        )

    if provider == "anthropic":
        if not anthropic_api_key:
            raise MissingProviderCredentialError(provider, model)

        client = AsyncAnthropic(api_key=anthropic_api_key)
        return AnthropicProviderSession(
            client=client,
            model=model,
            prompt_messages=prompt_messages,
            tools=serialize_anthropic_tools(canonical_tools),
            recorder=recorder,
        )

    if provider == "gemini":
        if not gemini_api_key:
            raise MissingProviderCredentialError(provider, model)

        client = genai.Client(api_key=gemini_api_key)
        return GeminiProviderSession(
            client=client,
            model=model,
            prompt_messages=prompt_messages,
            tools=serialize_gemini_tools(canonical_tools),
            recorder=recorder,
        )

    if provider == "copilot":
        # A video becomes several frames, and Copilot enforces a per-request
        # image limit. screenshot_preview returns yet more images which
        # accumulate across turns and push the request over that limit, so drop
        # it for video runs specifically.
        if _contains_video(prompt_messages):
            canonical_tools = canonical_tool_definitions(
                image_generation_enabled=should_generate_images,
                image_editing_enabled=bool(replicate_api_key or REPLICATE_API_KEY),
                asset_extraction_enabled=should_extract_assets and bool(gemini_api_key),
                screenshot_enabled=False,
            )

        # No key check: an explicit token is optional. Without one the SDK
        # discovers credentials itself (stored Copilot CLI login, then gh CLI),
        # which is the documented way to reuse an existing GitHub sign-in.
        copilot_client = copilot.CopilotClient(
            github_token=copilot_github_token or COPILOT_GITHUB_TOKEN,
            use_logged_in_user=not (copilot_github_token or COPILOT_GITHUB_TOKEN),
            log_level="error",
        )
        mcp_servers = build_mcp_servers(settings.active_mcp_servers)
        return CopilotProviderSession(
            client=copilot_client,
            model=model,
            prompt_messages=prompt_messages,
            tools=serialize_copilot_tools(canonical_tools),
            recorder=recorder,
            mcp_servers=mcp_servers,
            permission_handler=(
                build_permission_handler(settings.active_mcp_servers)
                if mcp_servers
                else None
            ),
        )

    raise ValueError(f"Unsupported model: {model.value}")


def _create_byok_session(
    model: Llm,
    connection: ByokConnection,
    settings: IntegrationSettings,
    prompt_messages: list[ChatCompletionMessageParam],
    canonical_tools: list[CanonicalToolDefinition],
    recorder: Optional[AgentRunRecorder],
) -> ProviderSession:
    """Run one explicitly selected BYOK identity through the Copilot SDK.

    ``mode='empty'`` keeps the session off the user's Copilot CLI state: no
    GitHub sign-in, no ``~/.copilot`` fallback, no built-in tools, and an
    explicit per-install base directory that empty mode requires. The
    connection's own credential is the only one used.
    """
    provider_config = build_provider_config(connection, model)

    base_directory = copilot_base_directory()
    os.makedirs(base_directory, exist_ok=True)

    client = copilot.CopilotClient(
        mode="empty",
        use_logged_in_user=False,
        base_directory=base_directory,
        log_level="error",
    )
    mcp_servers = build_mcp_servers(settings.active_mcp_servers)
    return CopilotProviderSession(
        client=client,
        model=model,
        prompt_messages=prompt_messages,
        tools=serialize_copilot_tools(canonical_tools),
        recorder=recorder,
        mcp_servers=mcp_servers,
        permission_handler=(
            build_permission_handler(settings.active_mcp_servers)
            if mcp_servers
            else None
        ),
        provider_config=provider_config,
        model_api_name=base_model_api_name(model),
        reasoning_effort=get_copilot_sdk_reasoning_effort(model),
    )
