"""Ask a provider whether it would actually work, before a generation does.

"Is this key valid?" cannot be answered from the key's shape: a syntactically
perfect key can still be out of credit, and a perfectly good key can lack
access to the model a user picked. So each check makes one *minimal, explicit*
request - tiny, but a real request that the account may be billed a negligible
amount for - and reports what came back through the shared classifier in
:mod:`provider_errors`.

Three rules hold for every provider here:

* the credential comes from the request when present and from the backend's
  own environment otherwise, and is never echoed back;
* every check is bounded by a timeout and closes whatever it opened, including
  the Copilot SDK session a BYOK check needs;
* BYOK keeps its additive identity - the connection is parsed by the existing
  validator, addressed by its ``sdk-byok/...`` id, and run in ``mode="empty"``
  with no built-in tools.

Nothing here is specific to one vendor, endpoint or model name: a BYOK check
works against any standards-compatible base URL, asks it what it serves when
it implements ``/models``, and falls back to the manually named wire model
when it does not.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional, cast

from integrations.config import (
    ByokConnection,
    ByokSelection,
    IntegrationConfigError,
    byok_selection_id,
    is_valid_wire_model,
    parse_byok_selection_id,
    parse_integration_settings,
    validate_endpoint_url,
)
from llm import (
    Llm,
    ModelProvider,
    get_anthropic_api_name,
    get_gemini_api_name,
    get_openai_api_name,
    model_from_value,
    provider_for_model,
)
from provider_errors import (
    CAPABILITY_REQUIREMENT,
    ErrorCategory,
    ProviderErrorInfo,
    classify_provider_error,
    provider_label,
    redact_values,
)

ValidatableProvider = Literal[
    "openai", "anthropic", "gemini", "replicate", "copilot-byok"
]

VALIDATABLE_PROVIDERS: tuple[ValidatableProvider, ...] = (
    "openai",
    "anthropic",
    "gemini",
    "replicate",
    "copilot-byok",
)

# A maintained, inexpensive model per provider. Used when the caller does not
# name one, so "is my key good" never depends on the user's current pick.
DEFAULT_VALIDATION_MODELS: dict[ModelProvider, Llm] = {
    "openai": Llm.GPT_5_4_MINI_LOW,
    "anthropic": Llm.CLAUDE_SONNET_4_6,
    "gemini": Llm.GEMINI_3_6_FLASH_MINIMAL,
}

# The smallest prompt that still proves the round trip works.
PROBE_PROMPT = "ping"
PROBE_MAX_TOKENS = 16

# Direct HTTP providers answer fast; the SDK has a runtime to boot first.
VALIDATION_TIMEOUT_SECONDS = 30.0
BYOK_VALIDATION_TIMEOUT_SECONDS = 120.0

REPLICATE_ACCOUNT_URL = "https://api.replicate.com/v1/account"


@dataclass(frozen=True)
class ProviderValidationRequest:
    provider: ValidatableProvider
    model_id: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    copilot_sdk_byok: dict[str, Any] | None = None


@dataclass(frozen=True)
class ProviderValidationResult:
    provider: str
    ok: bool
    category: ErrorCategory
    message: str
    model_id: str | None = None
    # Model ids the endpoint itself reports, when it can be asked. Bounded and
    # sanitised; empty when listing is not available for that provider.
    models: tuple[str, ...] = ()


# An organisation endpoint can host a long list; the picker only needs enough
# to choose from, and the response has to stay small.
MAX_DISCOVERED_MODELS = 100

# ``/models`` is optional in practice. These answers mean "not implemented
# here", which is a manual-wire-model situation rather than a failure.
MODEL_LISTING_UNSUPPORTED_STATUSES = frozenset({404, 405, 501})


def _ready(
    provider: str,
    model_id: str | None,
    detail: str = "",
    models: tuple[str, ...] = (),
) -> ProviderValidationResult:
    label = provider_label(provider)
    message = f"{label} responded successfully."
    if model_id:
        message = f"{label} responded successfully using {model_id}."
    if detail:
        message = f"{message} {detail}"
    return ProviderValidationResult(
        provider=provider,
        ok=True,
        category="ready",
        message=message,
        model_id=model_id,
        models=models,
    )


def _problem(
    provider: str,
    info: ProviderErrorInfo,
    model_id: str | None = None,
    secrets: tuple[str | None, ...] = (),
    models: tuple[str, ...] = (),
) -> ProviderValidationResult:
    """A failure, with any credential we actually hold removed literally.

    Providers quote the failing request back, and a user's own key has no
    recognisable prefix, so pattern matching alone is not enough here.
    """
    return ProviderValidationResult(
        provider=provider,
        ok=False,
        category=info.category,
        message=redact_values(info.message, secrets),
        model_id=model_id,
        models=models,
    )


def _supports_model_listing(connection: ByokConnection) -> bool:
    """Whether this connection can be asked what it serves.

    Any standards-compatible endpoint may implement ``/models``; Azure lists
    deployments through its management API (not this route) and Anthropic has
    no equivalent, so both stay honest and the wire model is set by hand.
    Whether the route actually exists is decided by asking it.
    """
    return connection.provider == "openai" and bool(connection.base_url)


def _configuration(
    provider: str, message: str, model_id: str | None = None
) -> ProviderValidationResult:
    return ProviderValidationResult(
        provider=provider,
        ok=False,
        category="configuration",
        message=message,
        model_id=model_id,
    )


def _environment_key(provider: ValidatableProvider) -> str | None:
    """The backend's own credential, read at call time.

    Read from the environment rather than from ``config`` so a key added to
    ``backend/.env`` after import is still picked up, and so tests can set one.
    """
    variable = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "gemini": "GEMINI_API_KEY",
        "replicate": "REPLICATE_API_KEY",
    }.get(provider)
    if variable is None:
        return None
    value = os.environ.get(variable)
    return value.strip() or None if isinstance(value, str) else None


def resolve_credential(
    provider: ValidatableProvider, requested: str | None
) -> str | None:
    """The request's credential when it sent one, else the backend's."""
    if isinstance(requested, str) and requested.strip():
        return requested.strip()
    return _environment_key(provider)


def _resolve_openai_endpoint(
    request: ProviderValidationRequest,
) -> tuple[str | None, str | None, ProviderValidationResult | None]:
    """The key and base URL an OpenAI check may use.

    The backend's own ``OPENAI_API_KEY`` belongs to the backend's own endpoint.
    A request that names a different base URL must therefore carry its own
    credential: otherwise anyone able to reach this API could name a host they
    control and have the server post its key to it. So a caller-supplied URL
    requires a caller-supplied key, and the environment key is only ever used
    with the base URL this backend was configured with.
    """
    requested_url = (request.base_url or "").strip()
    requested_key = (request.api_key or "").strip()

    if requested_url:
        try:
            base_url = validate_endpoint_url(
                requested_url, "The OpenAI base URL"
            )
        except IntegrationConfigError as error:
            return None, None, _configuration("openai", str(error))

        if not requested_key:
            return (
                None,
                None,
                _configuration(
                    "openai",
                    "A custom OpenAI base URL needs its own API key in the same "
                    "request. The key configured on this server is only used "
                    "with the server's own endpoint.",
                ),
            )
        return requested_key, base_url, None

    # No URL named: the backend's configured endpoint, with either the
    # request's key or the backend's own. Read at call time, like the keys, so
    # a value added to backend/.env after import is still honoured.
    key = requested_key or _environment_key("openai")
    if not key:
        return (
            None,
            None,
            _configuration(
                "openai",
                "Add an OpenAI API key in Settings or to backend/.env first.",
            ),
        )
    configured = (os.environ.get("OPENAI_BASE_URL") or "").strip() or None
    return key, configured, None


def resolve_model(
    provider: ValidatableProvider, model_id: str | None
) -> tuple[Llm | None, ProviderValidationResult | None]:
    """The model to probe with, or the reason the requested one is unusable."""
    expected: ModelProvider = "openai" if provider == "copilot-byok" else provider  # pyright: ignore[reportAssignmentType]

    if not model_id or not model_id.strip():
        default = DEFAULT_VALIDATION_MODELS.get(expected)
        return default, None

    candidate = model_id.strip()
    model = model_from_value(candidate)
    if model is None:
        return None, ProviderValidationResult(
            provider=provider,
            ok=False,
            category="model",
            message=(
                f"'{candidate}' is not a model this build knows. Pick one from "
                "the model list."
            ),
            model_id=candidate,
        )

    actual = provider_for_model(model)
    if actual != expected:
        return None, ProviderValidationResult(
            provider=provider,
            ok=False,
            category="model",
            message=(
                f"'{candidate}' is a {provider_label(actual)} model, so it "
                f"cannot be validated against {provider_label(provider)}."
            ),
            model_id=candidate,
        )
    return model, None


async def _validate_openai(
    request: ProviderValidationRequest,
) -> ProviderValidationResult:
    from openai import AsyncOpenAI

    key, base_url, problem = _resolve_openai_endpoint(request)
    if problem is not None:
        return problem
    assert key is not None

    model, model_problem = resolve_model("openai", request.model_id)
    if model_problem is not None:
        return model_problem
    assert model is not None
    api_name = get_openai_api_name(model)

    client = AsyncOpenAI(api_key=key, base_url=base_url, timeout=VALIDATION_TIMEOUT_SECONDS)
    try:
        await asyncio.wait_for(
            client.chat.completions.create(
                model=api_name,
                messages=[{"role": "user", "content": PROBE_PROMPT}],
                max_completion_tokens=PROBE_MAX_TOKENS,
            ),
            timeout=VALIDATION_TIMEOUT_SECONDS,
        )
        return _ready("openai", model.value)
    except Exception as exc:
        return _problem(
            "openai",
            classify_provider_error(exc, "openai"),
            model.value,
            secrets=(key,),
        )
    finally:
        await _close_quietly(client)


async def _validate_anthropic(
    request: ProviderValidationRequest,
) -> ProviderValidationResult:
    from anthropic import AsyncAnthropic

    key = resolve_credential("anthropic", request.api_key)
    if not key:
        return _configuration(
            "anthropic",
            "Add an Anthropic API key in Settings or to backend/.env first.",
        )

    model, problem = resolve_model("anthropic", request.model_id)
    if problem is not None:
        return problem
    assert model is not None
    api_name = get_anthropic_api_name(model)

    client = AsyncAnthropic(api_key=key, timeout=VALIDATION_TIMEOUT_SECONDS)
    try:
        await asyncio.wait_for(
            client.messages.create(
                model=api_name,
                max_tokens=PROBE_MAX_TOKENS,
                messages=[{"role": "user", "content": PROBE_PROMPT}],
            ),
            timeout=VALIDATION_TIMEOUT_SECONDS,
        )
        return _ready("anthropic", model.value)
    except Exception as exc:
        return _problem(
            "anthropic",
            classify_provider_error(exc, "anthropic"),
            model.value,
            secrets=(key,),
        )
    finally:
        await _close_quietly(client)


async def _validate_gemini(
    request: ProviderValidationRequest,
) -> ProviderValidationResult:
    from google import genai

    key = resolve_credential("gemini", request.api_key)
    if not key:
        return _configuration(
            "gemini",
            "Add a Gemini API key in Settings or to backend/.env first.",
        )

    model, problem = resolve_model("gemini", request.model_id)
    if problem is not None:
        return problem
    assert model is not None
    api_name = get_gemini_api_name(model)

    client = genai.Client(api_key=key)
    try:
        await asyncio.wait_for(
            client.aio.models.generate_content(
                model=api_name,
                contents=PROBE_PROMPT,
            ),
            timeout=VALIDATION_TIMEOUT_SECONDS,
        )
        return _ready("gemini", model.value)
    except Exception as exc:
        return _problem(
            "gemini",
            classify_provider_error(exc, "gemini"),
            model.value,
            secrets=(key,),
        )


async def _validate_replicate(
    request: ProviderValidationRequest,
) -> ProviderValidationResult:
    import httpx

    key = resolve_credential("replicate", request.api_key)
    if not key:
        return _configuration(
            "replicate",
            "Add REPLICATE_API_KEY to backend/.env first; Replicate cannot be "
            "configured from the browser.",
        )

    try:
        async with httpx.AsyncClient(timeout=VALIDATION_TIMEOUT_SECONDS) as client:
            # Replicate charges per prediction, so the account endpoint is the
            # honest "are these credentials live" check.
            response = await client.get(
                REPLICATE_ACCOUNT_URL,
                headers={"Authorization": f"Bearer {key}"},
            )
        if response.status_code < 400:
            return _ready("replicate", None)
        response.raise_for_status()
        return _ready("replicate", None)
    except Exception as exc:
        return _problem(
            "replicate", classify_provider_error(exc, "replicate"), secrets=(key,)
        )


class ModelListingUnsupported(Exception):
    """The endpoint answered, but it does not implement ``/models``.

    Not an error: the standard does not require the route, so the wire model
    is simply set by hand instead.
    """


async def discover_openai_compatible_models(
    base_url: str,
    credential: str,
    timeout_seconds: float = VALIDATION_TIMEOUT_SECONDS,
) -> tuple[str, ...]:
    """Model ids a standards-compatible endpoint reports at ``/models``.

    Only the endpoint knows what it serves, so this asks rather than assuming a
    catalog. Raises :class:`ModelListingUnsupported` when the route simply is
    not implemented, and the underlying error for anything else - the caller
    turns that into an actionable message, because inventing a model list would
    be worse than saying the listing could not be read.
    """
    import httpx

    url = base_url.rstrip("/") + "/models"
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.get(
            url, headers={"Authorization": f"Bearer {credential}"}
        )
        if response.status_code in MODEL_LISTING_UNSUPPORTED_STATUSES:
            raise ModelListingUnsupported(url)
        response.raise_for_status()
        payload: object = response.json()

    raw_entries: object = payload
    if isinstance(payload, dict):
        raw_entries = cast("dict[str, Any]", payload).get("data")
    if not isinstance(raw_entries, list):
        return ()
    entries: list[Any] = list(cast("list[Any]", raw_entries))

    discovered: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        identifier: object = (
            cast("dict[str, Any]", entry).get("id")
            if isinstance(entry, dict)
            else entry
        )
        if not isinstance(identifier, str):
            continue
        candidate = identifier.strip()
        # Same bound the selection ids use, so anything listed here can
        # actually be selected afterwards.
        if not is_valid_wire_model(candidate) or candidate in seen:
            continue
        seen.add(candidate)
        discovered.append(candidate)
        if len(discovered) >= MAX_DISCOVERED_MODELS:
            break
    return tuple(discovered)


def _byok_model(
    connection: ByokConnection, model_id: str | None
) -> tuple[ByokSelection | None, ProviderValidationResult | None]:
    """The selection to probe a BYOK connection with.

    ``model_id`` may be a synthetic identity - known-model or custom - or a
    bare base model id. When the connection names an endpoint model, that model
    is what gets probed, because it is the only one the endpoint serves.
    """
    candidate = (model_id or "").strip()
    if candidate:
        parsed = parse_byok_selection_id(candidate)
        if parsed is not None:
            if parsed.provider != connection.provider:
                return None, ProviderValidationResult(
                    provider="copilot-byok",
                    ok=False,
                    category="configuration",
                    message=(
                        f"'{candidate}' belongs to a {parsed.provider} connection, "
                        f"but the configured connection is {connection.provider}."
                    ),
                    model_id=candidate,
                )
            if parsed.is_custom and connection.wire_model != parsed.wire_model:
                return None, ProviderValidationResult(
                    provider="copilot-byok",
                    ok=False,
                    category="configuration",
                    message=(
                        f"'{parsed.wire_model}' is not the endpoint model this "
                        "connection is configured for. Update the wire model "
                        "and try again."
                    ),
                    model_id=candidate,
                )
            if not parsed.is_custom and not connection.serves(parsed.base_model):
                return None, ProviderValidationResult(
                    provider="copilot-byok",
                    ok=False,
                    category="configuration",
                    message=(
                        f"The {connection.provider} BYOK connection cannot run "
                        f"{parsed.base_model.value}."
                    ),
                    model_id=candidate,
                )
            return parsed, None

        # A bare endpoint model name is honoured when it is the configured one.
        if connection.wire_model and candidate == connection.wire_model:
            custom = connection.custom_selection
            assert custom is not None
            return custom, None

        model = model_from_value(candidate)
        if model is None:
            return None, ProviderValidationResult(
                provider="copilot-byok",
                ok=False,
                category="model",
                message=(
                    f"'{candidate}' is not a model this build knows, and it is "
                    "not the endpoint model this connection is configured for."
                ),
                model_id=candidate,
            )
        if not connection.serves(model):
            return None, ProviderValidationResult(
                provider="copilot-byok",
                ok=False,
                category="configuration",
                message=(
                    f"The {connection.provider} BYOK connection cannot run "
                    f"{model.value}."
                ),
                model_id=candidate,
            )
        return ByokSelection(provider=connection.provider, base_model=model), None

    # Nothing named: probe the endpoint model when there is one, else a
    # maintained default of the connection's family.
    custom = connection.custom_selection
    if custom is not None:
        return custom, None

    default = DEFAULT_VALIDATION_MODELS.get(connection.base_provider)
    if default is None:
        return None, _configuration(
            "copilot-byok",
            f"No default model is known for a {connection.provider} connection.",
        )
    return ByokSelection(provider=connection.provider, base_model=default), None


async def _validate_byok(
    request: ProviderValidationRequest,
) -> ProviderValidationResult:
    import copilot

    from integrations.copilot_sdk import base_model_api_name, build_provider_config

    try:
        settings = parse_integration_settings(
            {"copilotSdkByok": request.copilot_sdk_byok or {}}
        )
    except IntegrationConfigError as error:
        return _configuration("copilot-byok", str(error))

    connection = settings.byok
    if connection is None:
        return _configuration(
            "copilot-byok",
            "Configure a Copilot SDK BYOK connection first.",
        )
    reason = connection.unusable_reason
    if reason is not None:
        return _configuration("copilot-byok", f"Copilot SDK BYOK {reason}.")

    selection, problem = _byok_model(connection, request.model_id)
    if problem is not None:
        return problem
    assert selection is not None

    # The identity stays synthetic, so a BYOK check can never be mistaken for
    # the direct model it borrows capabilities from.
    identity = selection.selection_id
    secrets = (connection.api_key, connection.bearer_token)

    # Step one: prove the base URL and the dedicated credential work, and ask
    # the endpoint what it serves. This is cheap, and it fails fast before the
    # SDK runtime is booted.
    discovered: tuple[str, ...] = ()
    listing_supported = _supports_model_listing(connection)
    credential = connection.bearer_token or connection.api_key
    if listing_supported and connection.base_url and credential:
        try:
            discovered = await discover_openai_compatible_models(
                connection.base_url, credential
            )
        except ModelListingUnsupported:
            # The route is optional in the ecosystem. Fall through to the live
            # probe and let the user keep naming the wire model by hand.
            listing_supported = False
        except Exception as exc:
            info = classify_provider_error(exc, "copilot-byok")
            return _problem(
                "copilot-byok",
                ProviderErrorInfo(
                    category=info.category,
                    message=(
                        f"Could not list models at {connection.base_url.rstrip('/')}"
                        f"/models. {info.message}"
                    ),
                    provider="copilot-byok",
                    detail=info.detail,
                ),
                identity,
                secrets=secrets,
            )

        if (
            selection.is_custom
            and discovered
            and selection.wire_model not in discovered
        ):
            return ProviderValidationResult(
                provider="copilot-byok",
                ok=False,
                category="model",
                message=(
                    f"The endpoint does not list '{selection.wire_model}'. Pick "
                    "one of the models it reports."
                ),
                model_id=identity,
                models=discovered,
            )

    try:
        provider_config = build_provider_config(
            connection, selection.base_model, wire_model=selection.wire_model
        )
    except IntegrationConfigError as error:
        return _configuration("copilot-byok", str(error), identity)

    from integrations.copilot_sdk import copilot_base_directory

    base_directory = copilot_base_directory()
    os.makedirs(base_directory, exist_ok=True)

    client = copilot.CopilotClient(
        mode="empty",
        use_logged_in_user=False,
        base_directory=base_directory,
        log_level="error",
    )
    session: Any = None
    try:
        await asyncio.wait_for(client.start(), timeout=BYOK_VALIDATION_TIMEOUT_SECONDS)
        session = await asyncio.wait_for(
            client.create_session(
                model=base_model_api_name(selection.base_model),
                provider=provider_config,
                streaming=False,
                # No custom tools are registered and no built-in tool is
                # allowed: this session may only answer. No reasoning effort is
                # sent either - a custom model has no thinking level.
                available_tools=copilot.ToolSet().add_custom("*"),
                skip_custom_instructions=True,
                enable_config_discovery=False,
            ),
            timeout=BYOK_VALIDATION_TIMEOUT_SECONDS,
        )
        await asyncio.wait_for(
            session.send_and_wait(
                PROBE_PROMPT, timeout=BYOK_VALIDATION_TIMEOUT_SECONDS
            ),
            timeout=BYOK_VALIDATION_TIMEOUT_SECONDS,
        )
        detail = (
            "Model listing is not available here; set the wire model by hand."
            if not listing_supported
            else ""
        )
        # The probe proves the endpoint answers. It does not prove the model
        # can see an image or call a tool, so say what is still required.
        detail = f"{detail} {CAPABILITY_REQUIREMENT}".strip()
        return _ready(
            "copilot-byok",
            identity,
            detail=detail,
            models=discovered,
        )
    except Exception as exc:
        return _problem(
            "copilot-byok",
            classify_provider_error(exc, "copilot-byok"),
            identity,
            secrets=secrets,
            models=discovered,
        )
    finally:
        if session is not None:
            await _disconnect_quietly(session)
        await _stop_quietly(client)


async def _close_quietly(client: Any) -> None:
    close = getattr(client, "close", None)
    if close is None:
        return
    try:
        result = close()
        if asyncio.iscoroutine(result):
            await result
    except Exception:
        pass


async def _disconnect_quietly(session: Any) -> None:
    try:
        await asyncio.wait_for(session.disconnect(), timeout=10)
    except Exception:
        pass


async def _stop_quietly(client: Any) -> None:
    try:
        await asyncio.wait_for(client.stop(), timeout=10)
        await asyncio.sleep(0)
    except Exception:
        pass


_VALIDATORS = {
    "openai": _validate_openai,
    "anthropic": _validate_anthropic,
    "gemini": _validate_gemini,
    "replicate": _validate_replicate,
    "copilot-byok": _validate_byok,
}


async def validate_provider(
    request: ProviderValidationRequest,
) -> ProviderValidationResult:
    """Run one provider's live check, never raising and never leaking."""
    validator: Optional[Any] = _VALIDATORS.get(request.provider)
    if validator is None:
        return _configuration(
            request.provider, f"'{request.provider}' cannot be validated."
        )
    try:
        return await validator(request)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # A bug in the check itself must still come back as a safe answer.
        return _problem(
            request.provider, classify_provider_error(exc, request.provider)
        )
