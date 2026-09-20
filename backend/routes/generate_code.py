import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from abc import ABC, abstractmethod
import traceback
from typing import Callable, Awaitable
from fastapi import APIRouter, WebSocket
import openai
from starlette.websockets import WebSocketDisconnect
from websockets.exceptions import ConnectionClosedOK, ConnectionClosedError
from config import (
    ANTHROPIC_API_KEY,
    COPILOT_GITHUB_TOKEN,
    GEMINI_API_KEY,
    IS_PROD,
    NUM_VARIANTS,
    NUM_VARIANTS_VIDEO,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    REPLICATE_API_KEY,
)
from custom_types import InputMode
from integrations.config import (
    ByokConnection,
    IntegrationConfigError,
    IntegrationSettings,
    parse_integration_settings,
)
from llm import (
    COPILOT_MODELS,
    Llm,
)
from model_catalog import (
    ModelCatalog,
    ModelRunSpec,
    ProviderCredentials,
    build_catalog,
    filter_run_specs,
    parse_model_selections,
)
from typing import (
    Any,
    Callable,
    Coroutine,
    Dict,
    List,
    Literal,
    Sequence,
    cast,
    get_args,
)
from openai.types.chat import ChatCompletionMessageParam

from utils import print_prompt_preview

# WebSocket message types
MessageType = Literal[
    "chunk",
    "status",
    "setCode",
    "error",
    "variantComplete",
    "variantError",
    "variantCount",
    "variantModels",
    "thinking",
    "assistant",
    "toolStart",
    "toolResult",
]
from prompts.pipeline import build_prompt_messages
from prompts.request_parsing import parse_prompt_content, parse_prompt_history
from prompts.prompt_types import PromptHistoryMessage, Stack, UserTurnInput
from uploaded_assets import (
    append_uploaded_asset_ids_to_history,
    append_uploaded_asset_ids_to_prompt,
    infer_local_asset_base_url,
)
from agent.runner import Agent
from copilot_auth import get_copilot_snapshot
from fs_logging.agent_runs import AgentRunRecorder
from routes.model_choice_sets import (
    ALL_KEYS_MODELS_DEFAULT,
    ALL_KEYS_MODELS_TEXT_CREATE,
    ALL_KEYS_MODELS_UPDATE,
    ANTHROPIC_ONLY_MODELS,
    COPILOT_ONLY_MODELS,
    GEMINI_ANTHROPIC_MODELS,
    GEMINI_OPENAI_MODELS,
    GEMINI_ONLY_MODELS,
    OPENAI_ANTHROPIC_MODELS,
    OPENAI_ONLY_MODELS,
    VIDEO_VARIANT_MODELS,
)

# from utils import pprint_prompt
from ws.constants import APP_ERROR_WEB_SOCKET_CODE  # type: ignore


router = APIRouter()


def variant_limit(
    generation_type: Literal["create", "update"], input_mode: InputMode
) -> int:
    """How many variants a run may produce.

    Edit/update flows stay at two variants to keep latency and cost down, and
    video at two because each variant re-reads the whole recording. A user's
    model picks are capped by this rather than overriding it.
    """
    if input_mode == "video":
        return NUM_VARIANTS_VIDEO
    if generation_type == "update":
        return 2
    return NUM_VARIANTS


def _cycle(models: Sequence[Llm], count: int) -> List[Llm]:
    """[A, B] with count=5 becomes [A, B, A, B, A]."""
    if not models:
        return []
    return [models[index % len(models)] for index in range(count)]


def _empty_models() -> List[Llm]:
    return []


def _empty_specs() -> List[ModelRunSpec]:
    return []


def _empty_strings() -> List[str]:
    return []


@dataclass
class ModelSelection:
    """What each variant will run on, plus anything the user should be told."""

    specs: List[ModelRunSpec] = field(default_factory=_empty_specs)
    notices: List[str] = field(default_factory=_empty_strings)
    dropped: List[str] = field(default_factory=_empty_strings)

    @property
    def models(self) -> List[Llm]:
        """The base model behind each variant, in order."""
        return [spec.model for spec in self.specs]

    @property
    def selection_ids(self) -> List[str]:
        """What the client picked, so a retry can replay it exactly."""
        return [spec.selection_id for spec in self.specs]


@dataclass
class PipelineContext:
    """Context object that carries state through the pipeline"""

    websocket: WebSocket
    ws_comm: "WebSocketCommunicator | None" = None
    params: Dict[str, Any] = field(default_factory=dict)
    extracted_params: "ExtractedParams | None" = None
    prompt_messages: List[ChatCompletionMessageParam] = field(default_factory=list)
    variant_specs: List[ModelRunSpec] = field(default_factory=_empty_specs)
    planned_variant_count: int = 0
    completions: List[str] = field(default_factory=list)
    variant_completions: Dict[int, str] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def variant_models(self) -> List[Llm]:
        return [spec.model for spec in self.variant_specs]

    @property
    def send_message(self):
        assert self.ws_comm is not None
        return self.ws_comm.send_message

    @property
    def throw_error(self):
        assert self.ws_comm is not None
        return self.ws_comm.throw_error


class Middleware(ABC):
    """Base class for all pipeline middleware"""

    @abstractmethod
    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        """Process the context and call the next middleware"""
        pass


class Pipeline:
    """Pipeline for processing WebSocket code generation requests"""

    def __init__(self):
        self.middlewares: List[Middleware] = []

    def use(self, middleware: Middleware) -> "Pipeline":
        """Add a middleware to the pipeline"""
        self.middlewares.append(middleware)
        return self

    async def execute(self, websocket: WebSocket) -> None:
        """Execute the pipeline with the given WebSocket"""
        context = PipelineContext(websocket=websocket)

        # Build the middleware chain
        async def start(ctx: PipelineContext):
            pass  # End of pipeline

        chain = start
        for middleware in reversed(self.middlewares):
            chain = self._wrap_middleware(middleware, chain)

        await chain(context)

    def _wrap_middleware(
        self,
        middleware: Middleware,
        next_func: Callable[[PipelineContext], Awaitable[None]],
    ) -> Callable[[PipelineContext], Awaitable[None]]:
        """Wrap a middleware with its next function"""

        async def wrapped(context: PipelineContext) -> None:
            await middleware.process(context, lambda: next_func(context))

        return wrapped


class WebSocketCommunicator:
    """Handles WebSocket communication with consistent error handling"""

    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.is_closed = False

    async def accept(self) -> None:
        """Accept the WebSocket connection"""
        await self.websocket.accept()
        print("Incoming websocket connection...")

    async def send_message(
        self,
        type: MessageType,
        value: str | None,
        variantIndex: int,
        data: Dict[str, Any] | None = None,
        eventId: str | None = None,
    ) -> None:
        """Send a message to the client with debug logging"""
        if self.is_closed:
            return

        # Print for debugging on the backend
        if type == "error":
            print(f"Error (variant {variantIndex + 1}): {value}")
        elif type == "status":
            print(f"Status (variant {variantIndex + 1}): {value}")
        elif type == "variantComplete":
            print(f"Variant {variantIndex + 1} complete")
        elif type == "variantError":
            print(f"Variant {variantIndex + 1} error: {value}")

        try:
            payload: Dict[str, Any] = {"type": type, "variantIndex": variantIndex}
            if value is not None:
                payload["value"] = value
            if data is not None:
                payload["data"] = data
            if eventId is not None:
                payload["eventId"] = eventId
            await self.websocket.send_json(payload)
        except (
            ConnectionClosedOK,
            ConnectionClosedError,
            RuntimeError,
            WebSocketDisconnect,
        ):
            print(f"WebSocket closed by client, skipping message: {type}")
            self.is_closed = True

    async def throw_error(self, message: str) -> None:
        """Send an error message and close the connection"""
        print(message)
        if not self.is_closed:
            try:
                await self.websocket.send_json({"type": "error", "value": message})
                await self.websocket.close(APP_ERROR_WEB_SOCKET_CODE)
            except (
                ConnectionClosedOK,
                ConnectionClosedError,
                RuntimeError,
                WebSocketDisconnect,
            ):
                print("WebSocket already closed by client")
            self.is_closed = True

    async def receive_params(self) -> Dict[str, Any]:
        """Receive parameters from the client"""
        try:
            params: Dict[str, Any] = await self.websocket.receive_json()
        except WebSocketDisconnect:
            self.is_closed = True
            raise
        print("Received params")
        return params

    async def close(self) -> None:
        """Close the WebSocket connection"""
        if not self.is_closed:
            try:
                await self.websocket.close()
            except (
                ConnectionClosedOK,
                ConnectionClosedError,
                RuntimeError,
                WebSocketDisconnect,
            ):
                pass  # Already closed by client
            self.is_closed = True


@dataclass
class ExtractedParams:
    stack: Stack
    input_mode: InputMode
    should_generate_images: bool
    openai_api_key: str | None
    anthropic_api_key: str | None
    gemini_api_key: str | None
    replicate_api_key: str | None
    openai_base_url: str | None
    generation_type: Literal["create", "update"]
    prompt: UserTurnInput
    history: List[PromptHistoryMessage]
    file_state: Dict[str, str] | None
    option_codes: List[str]
    should_extract_assets: bool = True
    asset_base_url: str = ""
    design_system: str | None = None
    copilot_github_token: str | None = None
    # Copilot SDK BYOK connection and MCP servers, already validated. Holds
    # secrets, so it is never echoed back to the client or written to history.
    integrations: IntegrationSettings = field(default_factory=IntegrationSettings)
    # What the user explicitly picked, in order. Native and BYOK runs of the
    # same base model are distinct specs with distinct identities.
    selected_specs: List[ModelRunSpec] = field(default_factory=_empty_specs)
    # Ids the request asked for that this build does not know, kept so the
    # client can be told which picks were ignored instead of guessing.
    unknown_selected_models: List[str] = field(default_factory=_empty_strings)
    retry_specs: List[ModelRunSpec] | None = None

    @property
    def selected_models(self) -> List[Llm]:
        """The base model behind each pick, for callers that only need models."""
        return [spec.model for spec in self.selected_specs]

    @property
    def retry_models(self) -> List[Llm] | None:
        if self.retry_specs is None:
            return None
        return [spec.model for spec in self.retry_specs]


class ParameterExtractionStage:
    """Handles parameter extraction and validation from WebSocket requests"""

    def __init__(
        self,
        throw_error: Callable[[str], Coroutine[Any, Any, None]],
        asset_base_url: str = "",
    ):
        self.throw_error = throw_error
        self.asset_base_url = asset_base_url

    async def extract_and_validate(self, params: Dict[str, Any]) -> ExtractedParams:
        """Extract and validate all parameters from the request"""
        # Read the code config settings (stack) from the request.
        generated_code_config = params.get("generatedCodeConfig", "")
        if generated_code_config not in get_args(Stack):
            await self.throw_error(
                f"Invalid generated code config: {generated_code_config}"
            )
            raise ValueError(f"Invalid generated code config: {generated_code_config}")
        validated_stack = cast(Stack, generated_code_config)

        # Validate the input mode
        input_mode = params.get("inputMode")
        if input_mode not in get_args(InputMode):
            await self.throw_error(f"Invalid input mode: {input_mode}")
            raise ValueError(f"Invalid input mode: {input_mode}")
        validated_input_mode = cast(InputMode, input_mode)

        openai_api_key = self._get_from_settings_dialog_or_env(
            params, "openAiApiKey", OPENAI_API_KEY
        )

        # If neither is provided, we throw an error later only if Claude is used.
        anthropic_api_key = self._get_from_settings_dialog_or_env(
            params, "anthropicApiKey", ANTHROPIC_API_KEY
        )
        gemini_api_key = self._get_from_settings_dialog_or_env(
            params, "geminiApiKey", GEMINI_API_KEY
        )
        replicate_api_key = self._get_from_settings_dialog_or_env(
            params, "replicateApiKey", REPLICATE_API_KEY
        )

        # Optional: without one the Copilot SDK discovers credentials itself
        # from an existing `copilot` or `gh` login.
        copilot_github_token = self._get_from_settings_dialog_or_env(
            params, "copilotGithubToken", COPILOT_GITHUB_TOKEN
        )

        # BYOK + MCP settings. A malformed configuration stops the run with an
        # explanation rather than silently generating without it. Parsed before
        # the model picks because a BYOK run identity is one of the things that
        # can be picked - by its own id, never by a direct model's id.
        try:
            integrations = parse_integration_settings(params)
        except IntegrationConfigError as error:
            await self.throw_error(str(error))
            raise
        for diagnostic in integrations.diagnostics:
            print(f"Integration notice ({diagnostic.code}): {diagnostic.message}")

        # What the user explicitly picked, in order. `modelSelections` carries
        # the run identity per pick; `selectedModels` (and the older
        # `copilotModels`) remain supported as plain id lists. Unknown ids are
        # collected rather than dropped silently.
        raw_selections: object = params.get("modelSelections")
        if not isinstance(raw_selections, list) or not raw_selections:
            raw_selections = params.get("selectedModels")
        if not isinstance(raw_selections, list) or not raw_selections:
            raw_selections = params.get("copilotModels")
        selected_specs, unknown_selected_models = parse_model_selections(
            raw_selections
        )

        raw_retry: object = params.get("retryModelSelections")
        if not isinstance(raw_retry, list) or not raw_retry:
            raw_retry = params.get("retryModels")
        retry_specs: List[ModelRunSpec] | None = None
        if isinstance(raw_retry, list) and raw_retry:
            replayed, _ = parse_model_selections(raw_retry)
            retry_specs = list(replayed) or None

        # Base URL for OpenAI API
        openai_base_url: str | None = None
        # Disable user-specified OpenAI Base URL in prod
        if not IS_PROD:
            openai_base_url = self._get_from_settings_dialog_or_env(
                params, "openAiBaseURL", OPENAI_BASE_URL
            )
        if not openai_base_url:
            print("Using official OpenAI URL")

        # Feature preferences default to enabled for older clients.
        should_generate_images = bool(params.get("isImageGenerationEnabled", True))
        should_extract_assets = bool(params.get("isAssetExtractionEnabled", True))

        # Extract and validate generation type
        generation_type = params.get("generationType", "create")
        if generation_type not in ["create", "update"]:
            await self.throw_error(f"Invalid generation type: {generation_type}")
            raise ValueError(f"Invalid generation type: {generation_type}")
        generation_type = cast(Literal["create", "update"], generation_type)

        # Extract prompt content
        prompt: UserTurnInput = parse_prompt_content(params.get("prompt"))

        # Extract history (default to empty list)
        history: List[PromptHistoryMessage] = parse_prompt_history(
            params.get("history")
        )

        prompt = append_uploaded_asset_ids_to_prompt(prompt, self.asset_base_url)
        history = append_uploaded_asset_ids_to_history(history, self.asset_base_url)

        # Extract file state for agent edits
        raw_file_state = params.get("fileState")
        file_state: Dict[str, str] | None = None
        if isinstance(raw_file_state, dict):
            content = raw_file_state.get("content")
            if isinstance(content, str) and content.strip():
                path = raw_file_state.get("path") or "index.html"
                file_state = {"path": path, "content": content}

        raw_option_codes = params.get("optionCodes")
        option_codes: List[str] = []
        if isinstance(raw_option_codes, list):
            for entry in raw_option_codes:
                if isinstance(entry, str):
                    option_codes.append(entry)
                elif entry is None:
                    option_codes.append("")
                else:
                    option_codes.append(str(entry))

        raw_design_system = params.get("designSystem")
        design_system = (
            raw_design_system.strip()
            if isinstance(raw_design_system, str) and raw_design_system.strip()
            else None
        )

        return ExtractedParams(
            stack=validated_stack,
            input_mode=validated_input_mode,
            should_generate_images=should_generate_images,
            should_extract_assets=should_extract_assets,
            openai_api_key=openai_api_key,
            anthropic_api_key=anthropic_api_key,
            gemini_api_key=gemini_api_key,
            replicate_api_key=replicate_api_key,
            openai_base_url=openai_base_url,
            copilot_github_token=copilot_github_token,
            selected_specs=list(selected_specs),
            unknown_selected_models=list(unknown_selected_models),
            retry_specs=retry_specs,
            generation_type=generation_type,
            prompt=prompt,
            history=history,
            file_state=file_state,
            option_codes=option_codes,
            asset_base_url=self.asset_base_url,
            design_system=design_system,
            integrations=integrations,
        )

    def _get_from_settings_dialog_or_env(
        self, params: dict[str, Any], key: str, env_var: str | None
    ) -> str | None:
        """Get value from client settings or environment variable"""
        value = params.get(key)
        if value:
            print(f"Using {key} from client-side settings dialog")
            return value

        if env_var:
            print(f"Using {key} from environment variable")
            return env_var

        return None


class ModelSelectionStage:
    """Turns a user's picks (or the lack of them) into what each variant runs."""

    def __init__(self, throw_error: Callable[[str], Coroutine[Any, Any, None]]):
        self.throw_error = throw_error

    async def select_models(
        self,
        generation_type: Literal["create", "update"],
        input_mode: InputMode,
        openai_api_key: str | None = None,
        anthropic_api_key: str | None = None,
        gemini_api_key: str | None = None,
        copilot_available: bool = False,
        copilot_model_ids: Sequence[str] = (),
        selected_models: Sequence[Llm] = (),
        selected_specs: Sequence[ModelRunSpec] = (),
        unknown_selected_models: Sequence[str] = (),
        retry_models: List[Llm] | None = None,
        retry_specs: List[ModelRunSpec] | None = None,
        byok_reason: str | None = None,
        catalog: ModelCatalog | None = None,
    ) -> ModelSelection:
        """Pick what each variant runs on, and say what was skipped."""
        resolved_catalog = catalog or build_catalog(
            ProviderCredentials(
                openai_api_key=openai_api_key,
                anthropic_api_key=anthropic_api_key,
                gemini_api_key=gemini_api_key,
                copilot_available=copilot_available,
                copilot_model_ids=tuple(copilot_model_ids),
            )
        )
        limit = variant_limit(generation_type, input_mode)

        # Callers may pass plain models (native picks only) or full run specs.
        picks: List[ModelRunSpec] = list(selected_specs) or [
            ModelRunSpec.native(model) for model in selected_models
        ]
        replay: List[ModelRunSpec] | None = retry_specs or (
            [ModelRunSpec.native(model) for model in retry_models]
            if retry_models
            else None
        )

        # A retry replays the exact lineup the original run used, so it is not
        # re-filtered: reproducing the earlier result is the point. Identity is
        # replayed, but the connection behind a BYOK id comes from the settings
        # this request carries.
        if replay:
            return self._describe(ModelSelection(specs=list(replay)))

        notices: List[str] = []
        if picks or unknown_selected_models:
            result = filter_run_specs(
                picks,
                resolved_catalog,
                unknown_ids=unknown_selected_models,
                input_mode=input_mode,
                byok_reason=byok_reason,
            )
            if result.notice:
                notices.append(result.notice)
            if result.specs:
                return self._describe(
                    ModelSelection(
                        specs=list(result.specs[:limit]),
                        notices=notices,
                        dropped=[item.id for item in result.dropped],
                    )
                )

        try:
            models = self._auto_models(
                generation_type,
                input_mode,
                limit,
                resolved_catalog,
            )
        except Exception:
            await self.throw_error(self._no_credentials_message(input_mode, notices))
            raise Exception("No API key")

        if notices:
            notices.append("Fell back to automatic model selection.")
        return self._describe(
            # Automatic selection is always native: BYOK is opt-in per pick.
            ModelSelection(
                specs=[ModelRunSpec.native(model) for model in models],
                notices=notices,
                dropped=[],
            )
        )

    def _describe(self, selection: "ModelSelection") -> "ModelSelection":
        print("Variant models:")
        for index, spec in enumerate(selection.specs):
            suffix = " (Copilot SDK BYOK)" if spec.is_byok else ""
            print(f"Variant {index + 1}: {spec.selection_id}{suffix}")
        for notice in selection.notices:
            print(f"Model selection notice: {notice}")
        return selection

    def _no_credentials_message(
        self, input_mode: InputMode, notices: Sequence[str]
    ) -> str:
        if input_mode == "video":
            base = (
                "Video needs a Gemini API key or GitHub Copilot credentials. Add "
                "GEMINI_API_KEY to backend/.env or in the settings dialog, or sign in "
                "with GitHub (run `gh auth login` or `copilot`) to use your Copilot "
                "subscription."
            )
        else:
            base = (
                "No API key found and no GitHub Copilot credentials detected. Either sign in "
                "with GitHub (run `gh auth login` or `copilot`) to use your Copilot subscription, "
                "or add OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY to backend/.env or "
                "in the settings dialog. If you add it to .env, restart the backend server."
            )
        if notices:
            return f"{' '.join(notices)} {base}"
        return base

    def _auto_models(
        self,
        generation_type: Literal["create", "update"],
        input_mode: InputMode,
        num_variants: int,
        catalog: ModelCatalog,
    ) -> List[Llm]:
        """The default lineup when the user has not picked models."""
        available = set(catalog.available_providers)
        has_openai = "openai" in available
        has_anthropic = "anthropic" in available
        has_gemini = "gemini" in available

        # Video mode: Gemini reads a recording natively and stays the default.
        # Copilot can also do it - the provider samples the recording into
        # frames - so it is the fallback when there is no Gemini key.
        if input_mode == "video":
            if has_gemini:
                return list(VIDEO_VARIANT_MODELS)
            copilot_models = self._copilot_auto_models(catalog)
            if copilot_models:
                return _cycle(copilot_models, NUM_VARIANTS_VIDEO)
            raise Exception("No video-capable credentials")

        if has_gemini and has_anthropic and has_openai:
            if input_mode == "text" and generation_type == "create":
                models = list(ALL_KEYS_MODELS_TEXT_CREATE)
            elif generation_type == "update":
                models = list(ALL_KEYS_MODELS_UPDATE)
            else:
                models = list(ALL_KEYS_MODELS_DEFAULT)
        elif has_gemini and has_anthropic:
            models = list(GEMINI_ANTHROPIC_MODELS)
        elif has_gemini and has_openai:
            models = list(GEMINI_OPENAI_MODELS)
        elif has_openai and has_anthropic:
            models = list(OPENAI_ANTHROPIC_MODELS)
        elif has_gemini:
            models = list(GEMINI_ONLY_MODELS)
        elif has_anthropic:
            models = list(ANTHROPIC_ONLY_MODELS)
        elif has_openai:
            models = list(OPENAI_ONLY_MODELS)
        else:
            # No provider keys, but the user may have Copilot credentials - run
            # entirely on their Copilot subscription.
            models = self._copilot_auto_models(catalog)
            if not models:
                raise Exception("No usable credentials")

        return _cycle(models, num_variants)

    def _copilot_auto_models(self, catalog: ModelCatalog) -> List[Llm]:
        """Preferred Copilot models first, then whatever else the plan offers."""
        offered = {
            model.id
            for provider in catalog.providers
            if provider.id == "copilot" and provider.available
            for model in provider.models
        }
        preferred = [
            model for model in COPILOT_ONLY_MODELS if model.value in offered
        ]
        remaining = [
            model
            for model in COPILOT_MODELS
            if model.value in offered and model not in preferred
        ]
        return preferred + remaining


class PromptCreationStage:
    """Handles prompt assembly for code generation"""

    def __init__(self, throw_error: Callable[[str], Coroutine[Any, Any, None]]):
        self.throw_error = throw_error

    async def build_prompt_messages(
        self,
        extracted_params: ExtractedParams,
    ) -> List[ChatCompletionMessageParam]:
        """Create prompt messages"""
        try:
            prompt_messages = await build_prompt_messages(
                stack=extracted_params.stack,
                input_mode=extracted_params.input_mode,
                generation_type=extracted_params.generation_type,
                prompt=extracted_params.prompt,
                history=extracted_params.history,
                file_state=extracted_params.file_state,
                image_generation_enabled=extracted_params.should_generate_images,
                design_system=extracted_params.design_system,
            )
            print_prompt_preview(prompt_messages)

            return prompt_messages
        except Exception:
            await self.throw_error(
                "Error assembling prompt. Contact support at support@getwhimsyworks.com"
            )
            raise


class PostProcessingStage:
    """Handles post-processing after code generation completes"""

    def __init__(self):
        pass

    async def process_completions(
        self,
        completions: List[str],
        websocket: WebSocket,
    ) -> None:
        """Process completions and perform cleanup."""
        return None


class AgenticGenerationStage:
    """Handles agent tool-calling generation for each variant."""

    def __init__(
        self,
        send_message: Callable[[MessageType, str | None, int, Dict[str, Any] | None, str | None], Coroutine[Any, Any, None]],
        openai_api_key: str | None,
        openai_base_url: str | None,
        anthropic_api_key: str | None,
        gemini_api_key: str | None,
        replicate_api_key: str | None,
        should_generate_images: bool,
        file_state: Dict[str, str] | None,
        asset_base_url: str,
        option_codes: List[str] | None,
        should_extract_assets: bool = True,
        generation_id: str | None = None,
        stack: str | None = None,
        input_mode: str | None = None,
        generation_type: str | None = None,
        copilot_github_token: str | None = None,
        integrations: IntegrationSettings | None = None,
    ):
        self.send_message = send_message
        self.openai_api_key = openai_api_key
        self.openai_base_url = openai_base_url
        self.anthropic_api_key = anthropic_api_key
        self.gemini_api_key = gemini_api_key
        self.replicate_api_key = replicate_api_key
        self.copilot_github_token = copilot_github_token
        self.integrations = integrations or IntegrationSettings()
        self.should_generate_images = should_generate_images
        self.should_extract_assets = should_extract_assets
        self.file_state = file_state
        self.asset_base_url = asset_base_url
        self.option_codes = option_codes or []
        self.generation_id = (
            generation_id
            or f"gen_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        )
        self.stack = stack
        self.input_mode = input_mode
        self.generation_type = generation_type

    async def process_variants(
        self,
        variant_specs: List[ModelRunSpec],
        prompt_messages: List[ChatCompletionMessageParam],
    ) -> Dict[int, str]:
        tasks: List[asyncio.Task[str]] = []
        for index, spec in enumerate(variant_specs):
            tasks.append(
                asyncio.create_task(
                    self._run_variant(index, spec, prompt_messages)
                )
            )

        results = await asyncio.gather(*tasks, return_exceptions=True)
        variant_completions: Dict[int, str] = {}
        for index, result in enumerate(results):
            if isinstance(result, BaseException):
                print(f"Variant {index + 1} failed: {result}")
                continue
            if result:
                variant_completions[index] = result

        return variant_completions

    def _byok_connection_for(self, spec: ModelRunSpec) -> ByokConnection | None:
        """The BYOK connection a variant runs on, or None for a native run.

        A native spec always returns ``None``, so it reaches its own provider
        even when BYOK is configured and usable.
        """
        if not spec.is_byok:
            return None
        connection = self.integrations.byok_for(spec.selection_id)
        if connection is None:
            raise ValueError(
                f"Copilot SDK BYOK is no longer configured for "
                f"'{spec.selection_id}'. Re-select a model for this variant."
            )
        return connection

    async def _run_variant(
        self,
        index: int,
        spec: ModelRunSpec,
        prompt_messages: List[ChatCompletionMessageParam],
    ) -> str:
        model = spec.model
        try:
            async def send_runner_message(
                type: str,
                value: str | None,
                variant_index: int,
                data: Dict[str, Any] | None,
                event_id: str | None,
            ) -> None:
                await self.send_message(
                    cast(MessageType, type),
                    value,
                    variant_index,
                    data,
                    event_id,
                )

            recorder = AgentRunRecorder(
                generation_id=self.generation_id,
                variant_index=index,
                entry_point="websocket",
                stack=self.stack,
                input_mode=self.input_mode,
                generation_type=self.generation_type,
            )
            runner = Agent(
                send_message=send_runner_message,
                variant_index=index,
                openai_api_key=self.openai_api_key,
                openai_base_url=self.openai_base_url,
                anthropic_api_key=self.anthropic_api_key,
                gemini_api_key=self.gemini_api_key,
                replicate_api_key=self.replicate_api_key,
                copilot_github_token=self.copilot_github_token,
                should_generate_images=self.should_generate_images,
                should_extract_assets=self.should_extract_assets,
                asset_base_url=self.asset_base_url,
                initial_file_state=self.file_state,
                option_codes=self.option_codes,
                recorder=recorder,
                integrations=self.integrations,
            )
            completion = await runner.run(
                model,
                prompt_messages,
                byok_connection=self._byok_connection_for(spec),
            )
            if completion:
                await self.send_message("setCode", completion, index, None, None)
            await self.send_message(
                "variantComplete",
                "Variant generation complete",
                index,
                None,
                None,
            )
            return completion
        except openai.AuthenticationError as e:
            print(f"[VARIANT {index + 1}] OpenAI Authentication failed", e)
            error_message = (
                "Incorrect OpenAI key. Please make sure your OpenAI API key is correct, "
                "or create a new OpenAI API key on your OpenAI dashboard."
            )
            await self.send_message("variantError", error_message, index, None, None)
            return ""
        except openai.NotFoundError as e:
            print(f"[VARIANT {index + 1}] OpenAI Model not found", e)
            error_message = (
                e.message
                + ". Please make sure you have followed the instructions correctly to obtain "
                "an OpenAI key with GPT vision access: "
                "https://github.com/ArasaniRohithReddy/shot2code/blob/main/Troubleshooting.md"
            )
            await self.send_message("variantError", error_message, index, None, None)
            return ""
        except openai.RateLimitError as e:
            print(f"[VARIANT {index + 1}] OpenAI Rate limit exceeded", e)
            error_message = (
                "OpenAI error - 'You exceeded your current quota, please check your plan and billing details.'"
            )
            await self.send_message("variantError", error_message, index, None, None)
            return ""
        except Exception as e:
            print(f"Error in variant {index + 1}: {e}")
            traceback.print_exception(type(e), e, e.__traceback__)
            await self.send_message("variantError", str(e), index, None, None)
            return ""


# Pipeline Middleware Implementations


class WebSocketSetupMiddleware(Middleware):
    """Handles WebSocket setup and teardown"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        # Create and setup WebSocket communicator
        context.ws_comm = WebSocketCommunicator(context.websocket)
        await context.ws_comm.accept()

        try:
            await next_func()
        finally:
            # Always close the WebSocket
            await context.ws_comm.close()


class ParameterExtractionMiddleware(Middleware):
    """Handles parameter extraction and validation"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        # Receive parameters
        assert context.ws_comm is not None
        context.params = await context.ws_comm.receive_params()

        # Extract and validate
        param_extractor = ParameterExtractionStage(
            context.throw_error,
            infer_local_asset_base_url(context.websocket),
        )
        context.extracted_params = await param_extractor.extract_and_validate(
            context.params
        )

        # Log what we're generating
        print(
            f"Generating {context.extracted_params.stack} code in {context.extracted_params.input_mode} mode"
        )

        await next_func()


class StatusBroadcastMiddleware(Middleware):
    """Sends initial status messages to all variants"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        # The planned count. One variant runs per selected model, capped by the
        # per-mode limit; with no selection the automatic lineup fills the cap.
        # Stale filtering can still shrink this, in which case the generation
        # middleware sends a corrected count before any variant starts.
        assert context.extracted_params is not None
        params = context.extracted_params
        limit = variant_limit(params.generation_type, params.input_mode)
        if params.retry_specs:
            num_variants = len(params.retry_specs)
        elif params.selected_specs:
            num_variants = min(len(params.selected_specs), limit)
        else:
            num_variants = limit

        context.planned_variant_count = num_variants

        # Tell frontend how many variants we're using
        await context.send_message("variantCount", str(num_variants), 0)

        for i in range(num_variants):
            await context.send_message("status", "Generating code...", i)

        await next_func()


class PromptCreationMiddleware(Middleware):
    """Handles prompt creation"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        prompt_creator = PromptCreationStage(context.throw_error)
        assert context.extracted_params is not None
        context.prompt_messages = await prompt_creator.build_prompt_messages(
            context.extracted_params,
        )
        await next_func()


class CodeGenerationMiddleware(Middleware):
    """Handles the main code generation logic"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        try:
            assert context.extracted_params is not None
            params = context.extracted_params

            # The catalog is what makes a pick runnable: it knows which
            # providers have credentials and, for Copilot, which models the
            # signed-in plan currently lists.
            copilot_snapshot = await get_copilot_snapshot(params.copilot_github_token)
            catalog = build_catalog(
                ProviderCredentials(
                    openai_api_key=params.openai_api_key,
                    anthropic_api_key=params.anthropic_api_key,
                    gemini_api_key=params.gemini_api_key,
                    copilot_available=copilot_snapshot.available,
                    copilot_login=copilot_snapshot.login,
                    copilot_model_ids=tuple(
                        str(model["id"])
                        for model in copilot_snapshot.models
                        if bool(model.get("vision"))
                    ),
                    # The BYOK runtime is its own provider group; the direct
                    # providers above are untouched by it.
                    byok=params.integrations.byok_summary,
                )
            )

            model_selector = ModelSelectionStage(context.throw_error)
            selection = await model_selector.select_models(
                generation_type=params.generation_type,
                input_mode=params.input_mode,
                selected_specs=params.selected_specs,
                unknown_selected_models=params.unknown_selected_models,
                retry_specs=params.retry_specs,
                byok_reason=(
                    params.integrations.byok_summary.reason
                    if params.integrations.byok_summary is not None
                    else None
                ),
                catalog=catalog,
            )
            context.variant_specs = selection.specs

            # Stale picks can shrink the run below the count already announced;
            # correct it before any variant reports progress.
            if len(context.variant_specs) != context.planned_variant_count:
                await context.send_message(
                    "variantCount", str(len(context.variant_specs)), 0
                )
                context.planned_variant_count = len(context.variant_specs)

            # Ids, not model names: a BYOK profile must round-trip through a
            # retry as itself rather than as the model it borrows.
            model_data: Dict[str, Any] = {"models": selection.selection_ids}
            if selection.dropped:
                model_data["droppedModels"] = selection.dropped
            if selection.notices:
                model_data["notice"] = " ".join(selection.notices)
            await context.send_message("variantModels", None, 0, model_data, None)

            generation_stage = AgenticGenerationStage(
                send_message=context.send_message,
                openai_api_key=context.extracted_params.openai_api_key,
                openai_base_url=context.extracted_params.openai_base_url,
                anthropic_api_key=context.extracted_params.anthropic_api_key,
                gemini_api_key=context.extracted_params.gemini_api_key,
                replicate_api_key=context.extracted_params.replicate_api_key,
                copilot_github_token=context.extracted_params.copilot_github_token,
                should_generate_images=context.extracted_params.should_generate_images,
                should_extract_assets=context.extracted_params.should_extract_assets,
                file_state=context.extracted_params.file_state,
                asset_base_url=context.extracted_params.asset_base_url,
                option_codes=context.extracted_params.option_codes,
                stack=str(context.extracted_params.stack),
                input_mode=str(context.extracted_params.input_mode),
                generation_type=context.extracted_params.generation_type,
                integrations=context.extracted_params.integrations,
            )

            context.variant_completions = await generation_stage.process_variants(
                variant_specs=context.variant_specs,
                prompt_messages=context.prompt_messages,
            )

            # Check if all variants failed
            if len(context.variant_completions) == 0:
                await context.throw_error(
                    "Error generating code. Please contact support."
                )
                return  # Don't continue the pipeline

            # Convert to list format
            context.completions = []
            for i in range(len(context.variant_specs)):
                if i in context.variant_completions:
                    context.completions.append(context.variant_completions[i])
                else:
                    context.completions.append("")

        except Exception as e:
            print(f"[GENERATE_CODE] Unexpected error: {e}")
            await context.throw_error(f"An unexpected error occurred: {str(e)}")
            return  # Don't continue the pipeline

        await next_func()


class PostProcessingMiddleware(Middleware):
    """Handles post-processing and logging"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        post_processor = PostProcessingStage()
        await post_processor.process_completions(
            context.completions, context.websocket
        )

        await next_func()


@router.websocket("/generate-code")
async def stream_code(websocket: WebSocket):
    """Handle WebSocket code generation requests using a pipeline pattern"""
    pipeline = Pipeline()

    # Configure the pipeline
    pipeline.use(WebSocketSetupMiddleware())
    pipeline.use(ParameterExtractionMiddleware())
    pipeline.use(StatusBroadcastMiddleware())
    pipeline.use(PromptCreationMiddleware())
    pipeline.use(CodeGenerationMiddleware())
    pipeline.use(PostProcessingMiddleware())

    # Execute the pipeline
    await pipeline.execute(websocket)
