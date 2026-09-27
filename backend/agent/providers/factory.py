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
from free_images.config import EMPTY_FREE_IMAGE_SEARCH, FreeImageSearchSettings
from image_generation.settings import ImageGenerationSettings
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
    model_from_value,
    provider_for_model,
)
from model_catalog import PROVIDER_CREDENTIAL_LABELS, PROVIDER_LABELS
from preview_screenshot import is_screenshot_preview_available
from skills.store import enabled_skill_directories
from web_search.config import EMPTY_WEB_SEARCH, WebSearchSettings


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
    copilot_use_logged_in_user: bool = True,
    integrations: Optional[IntegrationSettings] = None,
    byok_connection: Optional[ByokConnection] = None,
    byok_wire_model: Optional[str] = None,
    copilot_web_search_enabled: bool = False,
    canonical_tools_override: Optional[list[CanonicalToolDefinition]] = None,
    copilot_skills_enabled: bool = True,
    web_search: Optional[WebSearchSettings] = None,
    image_settings: Optional[ImageGenerationSettings] = None,
    free_image_search: Optional[FreeImageSearchSettings] = None,
) -> ProviderSession:
    settings = integrations or EMPTY_INTEGRATIONS
    search_settings = web_search or EMPTY_WEB_SEARCH
    # Keyless and independent of every image-generation credential: a run with
    # no Replicate/Cloudflare/endpoint configuration can still find real
    # public-domain photographs, and configuring one does not switch this off.
    free_images = free_image_search or EMPTY_FREE_IMAGE_SEARCH
    # The canonical `search_web` tool is only advertised when a provider is
    # actually configured and usable, so a model is never told about a tool
    # this run cannot execute.
    canonical_web_search = search_settings.is_usable
    # One web-search tool per session. Copilot's built-in `web_search` and
    # shot2code's canonical `search_web` do the same job under different rules
    # (budgets, domain allowlist, snippet bounds), and offering both lets a
    # model take the unbounded route. The canonical tool wins because it is the
    # one every provider can use; the built-in stays available for people who
    # prefer it and simply leave canonical search switched off.
    use_copilot_builtin_search = (
        copilot_web_search_enabled and not canonical_web_search
    )
    # Whether the image tools can really run. The chosen image provider decides
    # this, not Replicate alone: a Cloudflare or OpenAI-compatible run has no
    # Replicate key and still generates images. Editing and background removal
    # are narrower - see ImageGenerationSettings - and are asked separately so
    # a model is never offered a tool this run cannot execute.
    images = image_settings or ImageGenerationSettings(
        enabled=should_generate_images,
        replicate_api_key=replicate_api_key or REPLICATE_API_KEY,
    )
    effective_image_generation = should_generate_images and images.has_generation_credential
    effective_image_editing = images.editing_enabled
    canonical_tools = (
        list(canonical_tools_override)
        if canonical_tools_override is not None
        else canonical_tool_definitions(
            # Never tell a model that the tool exists when the request cannot
            # execute it.
            image_generation_enabled=effective_image_generation,
            image_editing_enabled=effective_image_editing,
            # remove_backgrounds is Replicate-only; no other provider has an
            # equivalent and none is substituted.
            background_removal_enabled=images.background_removal_enabled,
            # The extract_assets tool calls Gemini, so don't offer it without a key.
            asset_extraction_enabled=should_extract_assets and bool(gemini_api_key),
            # screenshot_preview needs headless Chromium; skip it if it can't launch.
            screenshot_enabled=is_screenshot_preview_available(),
            web_search_enabled=canonical_web_search,
            free_image_search_enabled=free_images.is_usable,
        )
    )
    skill_directories = (
        enabled_skill_directories() if copilot_skills_enabled else []
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
            wire_model=byok_wire_model,
            copilot_web_search_enabled=use_copilot_builtin_search,
            skill_directories=skill_directories,
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
                image_generation_enabled=effective_image_generation,
                image_editing_enabled=effective_image_editing,
                background_removal_enabled=images.background_removal_enabled,
                asset_extraction_enabled=should_extract_assets and bool(gemini_api_key),
                screenshot_enabled=False,
                web_search_enabled=canonical_web_search,
                free_image_search_enabled=free_images.is_usable,
            )

        # No key check: an explicit token is optional. Without one the SDK
        # discovers credentials itself (stored Copilot CLI login, then gh CLI),
        # which is the documented way to reuse an existing GitHub sign-in.
        effective_copilot_token = copilot_github_token or (
            COPILOT_GITHUB_TOKEN if copilot_use_logged_in_user else None
        )
        copilot_client = copilot.CopilotClient(
            github_token=effective_copilot_token,
            use_logged_in_user=(
                copilot_use_logged_in_user
                and not effective_copilot_token
            ),
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
            # Always installed, not only when MCP servers exist: without a
            # handler the runtime applies its own default policy, and a
            # network-capable built-in would then have no shot2code-owned
            # answer to "may this URL be fetched?".
            permission_handler=build_permission_handler(settings.active_mcp_servers),
            allow_web_search=use_copilot_builtin_search,
            skill_directories=skill_directories,
        )

    raise ValueError(f"Unsupported model: {model.value}")


def _create_byok_session(
    model: Llm,
    connection: ByokConnection,
    settings: IntegrationSettings,
    prompt_messages: list[ChatCompletionMessageParam],
    canonical_tools: list[CanonicalToolDefinition],
    recorder: Optional[AgentRunRecorder],
    wire_model: Optional[str] = None,
    copilot_web_search_enabled: bool = False,
    skill_directories: Optional[list[str]] = None,
) -> ProviderSession:
    """Run one explicitly selected BYOK identity through the Copilot SDK.

    ``mode='empty'`` keeps the session off the user's Copilot CLI state: no
    GitHub sign-in, no ``~/.copilot`` fallback, no built-in tools, and an
    explicit per-install base directory that empty mode requires. The
    connection's own credential is the only one used.

    When ``wire_model`` names a model only the endpoint knows, ``model`` is a
    neutral compatibility template and *no* reasoning effort is sent: a GPT or
    Claude thinking level means nothing to an arbitrary custom model.
    """
    # A deployment named after a catalog model keeps that model's thinking
    # level; anything else is an arbitrary endpoint model with none.
    is_mapped = wire_model is not None and model_from_value(wire_model) is model
    is_custom = wire_model is not None and not is_mapped
    provider_config = build_provider_config(connection, model, wire_model=wire_model)

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
        # Same reason as the subscription path: the deny-by-default handler is
        # what makes "shot2code does not fetch URLs" true rather than assumed.
        permission_handler=build_permission_handler(settings.active_mcp_servers),
        provider_config=provider_config,
        model_api_name=base_model_api_name(model),
        reasoning_effort=(
            None if is_custom else get_copilot_sdk_reasoning_effort(model)
        ),
        allow_reasoning_effort=not is_custom,
        allow_web_search=copilot_web_search_enabled,
        skill_directories=skill_directories or [],
    )
