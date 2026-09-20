"""Validation for the integrations a user configures in Settings.

Two things arrive from the browser and both are hostile input until proven
otherwise: a *BYOK connection* (an endpoint plus its own dedicated credential)
and a list of MCP servers (commands to spawn or URLs to call). Everything here
is about turning that raw JSON into a narrow, typed, bounded description - or
refusing it with a sentence a person can act on.

The BYOK connection is **additive and separate**. It never reinterprets the
direct OpenAI/Anthropic/Gemini/Replicate credentials, never borrows their keys,
and never takes over one of their model ids. It is reached only by selecting a
*BYOK run identity* - ``sdk-byok/<provider>/<base model>`` - which is a
different id from the direct model it borrows capabilities from. That is what
lets a direct variant and a BYOK variant of the same base model run side by
side in one generation.

Nothing in this module imports the Copilot SDK, so the model catalog and the
validation route can use it on the critical import path. The SDK-shaped
conversion lives in :mod:`integrations.copilot_sdk`.

Secrets never leave this module except through the objects that hold them.
Every ``safe_metadata``/``summary`` helper returns presence flags and hosts,
never values, which is what diagnostics, logs and API responses are built from.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Sequence
from urllib.parse import quote, unquote, urlsplit

from llm import Llm, ModelProvider, model_from_value, provider_for_model

ByokProvider = Literal["openai", "azure", "anthropic"]
WireApi = Literal["responses", "completions"]
McpTransport = Literal["stdio", "http", "sse"]

# How one variant is executed. A selection carries this, not a provider: the
# same base model can appear twice in one run, once per runtime.
ModelRuntime = Literal["native", "copilot-byok"]

BYOK_PROVIDERS: tuple[ByokProvider, ...] = ("openai", "azure", "anthropic")
WIRE_APIS: tuple[WireApi, ...] = ("responses", "completions")
MCP_TRANSPORTS: tuple[McpTransport, ...] = ("stdio", "http", "sse")
MODEL_RUNTIMES: tuple[ModelRuntime, ...] = ("native", "copilot-byok")

# Every BYOK run identity starts with this. No ``Llm`` value does, which is
# what guarantees it can never collide with a direct model id.
BYOK_SELECTION_PREFIX = "sdk-byok/"

# Which shot2code models a BYOK provider type may be based on. Azure serves
# OpenAI deployments, so both map onto the OpenAI catalog. There is no Gemini
# provider in the Copilot SDK and Copilot's own models are not BYOK.
BYOK_BASE_PROVIDERS: dict[ByokProvider, ModelProvider] = {
    "openai": "openai",
    "azure": "openai",
    "anthropic": "anthropic",
}

# The segment that marks an endpoint's own model rather than a catalog one.
CUSTOM_ID_SEGMENT = "custom"

# Compatibility templates for a custom endpoint model. Both are non-reasoning
# entries: an arbitrary endpoint model has no GPT or Claude thinking level, so
# the template must not imply one and no effort is ever derived from it.
NEUTRAL_BASE_MODELS: dict[ModelProvider, Llm] = {
    "openai": Llm.GPT_5_5_NONE,
    "anthropic": Llm.CLAUDE_SONNET_4_6,
}

# What an endpoint model name may look like. Real deployments use slashes,
# colons, dots and at-signs (``vendor/model:tag``); nothing else is allowed,
# and never whitespace.
MAX_WIRE_MODEL_LENGTH = 128
_WIRE_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$")


def byok_selection_id(provider: ByokProvider, model: Llm) -> str:
    """The run identity for one known base model on the BYOK connection."""
    return f"{BYOK_SELECTION_PREFIX}{provider}/{model.value}"


def byok_custom_selection_id(provider: ByokProvider, wire_model: str) -> str:
    """The run identity for a model only the user's own endpoint knows.

    A standards-compatible endpoint serves whatever its operator deployed, and
    those names are not in shot2code's catalog. The name is URL-encoded into a
    ``custom/`` segment so a slash or a colon in a model id can never be
    mistaken for structure, and so the id can never collide with a known-model
    identity.
    """
    return (
        f"{BYOK_SELECTION_PREFIX}{provider}/{CUSTOM_ID_SEGMENT}/"
        f"{quote(wire_model, safe='')}"
    )


@dataclass(frozen=True)
class ByokSelection:
    """What a BYOK run identity resolves to.

    ``base_model`` is an *internal compatibility* reference only: the runtime
    needs a known model to look up prompt shape and limits. ``wire_model`` is
    what the endpoint is actually asked for, and for a custom selection it is
    the only model name that is true.
    """

    provider: ByokProvider
    base_model: Llm
    wire_model: str | None = None

    @property
    def is_custom(self) -> bool:
        return self.wire_model is not None

    @property
    def selection_id(self) -> str:
        if self.wire_model is not None:
            return byok_custom_selection_id(self.provider, self.wire_model)
        return byok_selection_id(self.provider, self.base_model)

    @property
    def display_model(self) -> str:
        """The model name a person should see for this selection."""
        return self.wire_model or self.base_model.value


def neutral_base_model(provider: ByokProvider) -> Llm:
    """The compatibility template a custom endpoint model runs under.

    Deliberately a *non-reasoning* model: an arbitrary endpoint model has no
    relationship to GPT or Claude thinking levels, so the template must not
    imply one. Nothing about it is shown to the user and no effort derived
    from it is ever sent.
    """
    return NEUTRAL_BASE_MODELS[BYOK_BASE_PROVIDERS[provider]]


def byok_custom_selection(provider: ByokProvider, wire_model: str) -> ByokSelection:
    """The selection for one endpoint model, mapped when shot2code knows it.

    A deployment named after a model in the catalog (rare, but it happens)
    keeps that model as its base, so its thinking level still applies.
    Every other endpoint model runs under the neutral non-reasoning template.
    """
    mapped = model_from_value(wire_model)
    expected = BYOK_BASE_PROVIDERS[provider]
    if mapped is not None and provider_for_model(mapped) == expected:
        return ByokSelection(
            provider=provider, base_model=mapped, wire_model=wire_model
        )
    return ByokSelection(
        provider=provider,
        base_model=neutral_base_model(provider),
        wire_model=wire_model,
    )


def parse_byok_selection_id(value: object) -> ByokSelection | None:
    """Split a BYOK run identity, or ``None`` when it is not one.

    Both shapes are understood, so ids saved before custom endpoints existed
    keep working:

    * ``sdk-byok/<provider>/<known model id>``
    * ``sdk-byok/<provider>/custom/<url-encoded endpoint model>``
    """
    if not isinstance(value, str) or not value.startswith(BYOK_SELECTION_PREFIX):
        return None
    remainder = value[len(BYOK_SELECTION_PREFIX) :]
    provider_value, separator, rest = remainder.partition("/")
    if not separator or provider_value not in BYOK_PROVIDERS:
        return None
    provider: ByokProvider = provider_value  # pyright: ignore[reportAssignmentType]

    custom_prefix = f"{CUSTOM_ID_SEGMENT}/"
    if rest.startswith(custom_prefix):
        encoded = rest[len(custom_prefix) :]
        if not encoded:
            return None
        try:
            wire_model = unquote(encoded)
        except Exception:
            return None
        if not is_valid_wire_model(wire_model):
            return None
        return byok_custom_selection(provider, wire_model)

    model = model_from_value(rest)
    if model is None:
        return None
    return ByokSelection(provider=provider, base_model=model)


def is_byok_selection_id(value: object) -> bool:
    """True for ids that address the BYOK runtime rather than a direct model."""
    return isinstance(value, str) and value.startswith(BYOK_SELECTION_PREFIX)


def is_valid_wire_model(value: object) -> bool:
    """Whether a string is usable as an endpoint model name.

    Deliberately permissive about the shapes real endpoints use
    (``org/model:tag``, ``model@version``) and strict about everything else:
    no whitespace, no control characters, bounded length.
    """
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate or len(candidate) > MAX_WIRE_MODEL_LENGTH:
        return False
    return bool(_WIRE_MODEL.match(candidate))


# Limits. A user can misconfigure these by hand, and an imported config can
# carry anything at all, so each one is bounded rather than trusted.
MAX_MODEL_SELECTIONS = 16
MAX_MCP_SERVERS = 8
MAX_MCP_ARGS = 32
MAX_MCP_ENV = 32
MAX_MCP_HEADERS = 16
MAX_MCP_TOOLS = 64
MAX_NAME_LENGTH = 64
MAX_LABEL_LENGTH = 96
MAX_VALUE_LENGTH = 4096
MAX_COMMAND_LENGTH = 512
MAX_URL_LENGTH = 2048
MIN_MCP_TIMEOUT_MS = 1_000
MAX_MCP_TIMEOUT_MS = 600_000

# The SDK validates tool-filter entries against this, and server names are
# used to build those entries, so a server key has to satisfy it too.
_SAFE_SDK_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")
_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# RFC 7230 token, which is what a header field-name may contain.
_HEADER_NAME = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")
_TOOL_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")
_UNSAFE_TEXT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Argument/header/env keys whose *values* must never be displayed or recorded.
_SECRET_KEY_HINTS = (
    "token",
    "key",
    "secret",
    "password",
    "passwd",
    "authorization",
    "auth",
    "cookie",
    "credential",
)

REDACTED = "[redacted]"


class IntegrationConfigError(ValueError):
    """A configuration the backend refuses to use, phrased for the user."""


def _fail(message: str) -> "IntegrationConfigError":
    return IntegrationConfigError(message)


def _as_mapping(value: object, label: str) -> Mapping[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise _fail(f"{label} must be an object.")
    return {str(key): item for key, item in value.items()}  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]


def _clean_text(value: object, label: str, limit: int) -> str:
    """A trimmed single-line string, or a refusal naming the field."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise _fail(f"{label} must be text.")
    text = value.strip()
    if not text:
        return ""
    if len(text) > limit:
        raise _fail(f"{label} is too long (limit {limit} characters).")
    if _UNSAFE_TEXT.search(text) or "\n" in text or "\r" in text:
        raise _fail(f"{label} contains characters that are not allowed.")
    return text


def _clean_bool(value: object, label: str, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    raise _fail(f"{label} must be true or false.")


def _normalize_key(raw: str) -> str:
    """A stable SDK-safe name for something the user named however they liked."""
    lowered = raw.strip().lower()
    slug = re.sub(r"[^a-z0-9_-]+", "-", lowered).strip("-_")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:MAX_NAME_LENGTH]


def _is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return any(hint in lowered for hint in _SECRET_KEY_HINTS)


def redact_mapping(values: Mapping[str, Any]) -> dict[str, Any]:
    """Same keys, with anything that looks like a credential masked."""
    redacted: dict[str, Any] = {}
    for key, value in values.items():
        redacted[key] = REDACTED if _is_secret_key(str(key)) else value
    return redacted


def _host_of(url: str) -> str:
    try:
        return urlsplit(url).hostname or ""
    except ValueError:
        return ""


def _is_loopback(host: str) -> bool:
    return host in {"localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"}


@dataclass(frozen=True)
class IntegrationDiagnostic:
    """Why something the user configured is not being used, safely worded."""

    scope: Literal["byok", "mcp"]
    code: str
    message: str
    target: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "scope": self.scope,
            "code": self.code,
            "message": self.message,
        }
        if self.target is not None:
            payload["target"] = self.target
        return payload


@dataclass(frozen=True)
class ByokConnectionSummary:
    """The BYOK connection with every secret removed.

    This is what the catalog, the API responses and the logs are allowed to
    see. It is deliberately a separate type from :class:`ByokConnection` so a
    credential cannot reach them by accident.
    """

    enabled: bool
    provider: ByokProvider
    base_provider: ModelProvider
    wire_api: WireApi
    wire_model: str | None
    base_url_host: str | None
    has_api_key: bool
    has_bearer_token: bool
    azure_api_version: str | None
    usable: bool
    reason: str | None
    # Set when the endpoint serves its own model rather than a catalog one.
    custom_selection_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "provider": self.provider,
            "baseProvider": self.base_provider,
            "wireApi": self.wire_api,
            "wireModel": self.wire_model,
            "baseUrlHost": self.base_url_host,
            "hasApiKey": self.has_api_key,
            "hasBearerToken": self.has_bearer_token,
            "azureApiVersion": self.azure_api_version,
            "usable": self.usable,
            "reason": self.reason,
            "customSelectionId": self.custom_selection_id,
        }


@dataclass(frozen=True)
class ByokConnection:
    """The user's own endpoint, reached through the Copilot SDK.

    ``api_key`` and ``bearer_token`` are the only secret-bearing fields in this
    module's BYOK surface. They are dedicated to this connection: the direct
    OpenAI/Anthropic keys are never consulted as a fallback, because a direct
    key belongs to the direct provider runtime and must keep working there
    untouched.
    """

    enabled: bool
    provider: ByokProvider
    wire_api: WireApi = "responses"
    base_url: str | None = None
    api_key: str | None = None
    bearer_token: str | None = None
    wire_model: str | None = None
    azure_api_version: str | None = None

    @property
    def base_provider(self) -> ModelProvider:
        """The shot2code provider whose models this connection can serve."""
        return BYOK_BASE_PROVIDERS[self.provider]

    @property
    def has_credential(self) -> bool:
        return bool(self.api_key or self.bearer_token)

    def serves(self, model: Llm) -> bool:
        """Whether this connection can run a given base model at all."""
        return provider_for_model(model) == self.base_provider

    def selection_id(self, model: Llm) -> str:
        return byok_selection_id(self.provider, model)

    @property
    def has_custom_model(self) -> bool:
        """Whether the endpoint was pointed at a model shot2code does not know."""
        return bool(self.wire_model) and model_from_value(self.wire_model) is None

    @property
    def custom_selection(self) -> "ByokSelection | None":
        """The single truthful selection a custom endpoint model produces.

        When the user names a ``wireModel``, that one model is what the
        endpoint serves - so the catalog offers exactly it, under its real
        name, instead of pretending the endpoint hosts a whole GPT family.
        """
        if not self.wire_model:
            return None
        return byok_custom_selection(self.provider, self.wire_model)

    @property
    def unusable_reason(self) -> str | None:
        """Why this connection cannot run, in the words the user will see."""
        if not self.enabled:
            return "switched off"
        if self.provider == "azure":
            if not self.base_url:
                return "needs the endpoint URL of your Azure OpenAI resource"
            if not self.has_credential:
                return "needs its own API key or bearer token"
            return None
        if self.provider == "anthropic":
            if not self.has_credential:
                return "needs its own API key or bearer token"
            return None
        if not self.has_credential and not _is_loopback(_host_of(self.base_url or "")):
            return "needs its own API key unless it points at localhost"
        return None

    @property
    def is_usable(self) -> bool:
        return self.unusable_reason is None

    def summary(self) -> ByokConnectionSummary:
        reason = self.unusable_reason
        custom = self.custom_selection
        return ByokConnectionSummary(
            enabled=self.enabled,
            provider=self.provider,
            base_provider=self.base_provider,
            wire_api=self.wire_api,
            wire_model=self.wire_model,
            base_url_host=_host_of(self.base_url) if self.base_url else None,
            has_api_key=bool(self.api_key),
            has_bearer_token=bool(self.bearer_token),
            azure_api_version=self.azure_api_version,
            usable=reason is None,
            reason=reason,
            custom_selection_id=custom.selection_id if custom is not None else None,
        )

    def safe_metadata(self) -> dict[str, Any]:
        """Everything about this connection except the credential itself."""
        return self.summary().to_dict()


def _no_args() -> tuple[str, ...]:
    return ()


def _no_env() -> dict[str, str]:
    return {}


@dataclass(frozen=True)
class McpServerSettings:
    """One validated MCP server.

    ``env`` and ``headers`` carry whatever the user put there, including
    tokens, so they are excluded from ``safe_metadata`` and from every log
    line. Only ``key`` (an SDK-safe name) is ever displayed.
    """

    id: str
    key: str
    name: str
    enabled: bool
    trusted: bool
    transport: McpTransport
    command: str | None = None
    args: tuple[str, ...] = field(default_factory=_no_args)
    env: dict[str, str] = field(default_factory=_no_env)
    working_directory: str | None = None
    url: str | None = None
    headers: dict[str, str] = field(default_factory=_no_env)
    tools: tuple[str, ...] = field(default_factory=_no_args)
    timeout_ms: int | None = None
    allow_write_tools: bool = False

    @property
    def is_active(self) -> bool:
        """Only an enabled *and* trusted server may run or answer a prompt."""
        return self.enabled and self.trusted

    def safe_metadata(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "key": self.key,
            "name": self.name,
            "enabled": self.enabled,
            "trusted": self.trusted,
            "transport": self.transport,
            "command": self.command,
            "argCount": len(self.args),
            "envKeys": sorted(self.env),
            "workingDirectory": self.working_directory,
            "urlHost": _host_of(self.url) if self.url else None,
            "headerNames": sorted(self.headers),
            "tools": list(self.tools),
            "timeoutMs": self.timeout_ms,
            "allowWriteTools": self.allow_write_tools,
            "active": self.is_active,
        }


def _no_servers() -> tuple[McpServerSettings, ...]:
    return ()


def _no_diagnostics() -> tuple[IntegrationDiagnostic, ...]:
    return ()


@dataclass(frozen=True)
class IntegrationSettings:
    """Everything a request configured, already validated.

    The BYOK connection is additive: nothing here changes how a direct OpenAI,
    Anthropic, Gemini or Replicate credential behaves. It only matters once the
    user explicitly selects a ``sdk-byok/...`` run identity.
    """

    byok: ByokConnection | None = None
    mcp_servers: tuple[McpServerSettings, ...] = field(default_factory=_no_servers)
    diagnostics: tuple[IntegrationDiagnostic, ...] = field(
        default_factory=_no_diagnostics
    )

    @property
    def byok_enabled(self) -> bool:
        return self.byok is not None and self.byok.enabled

    @property
    def usable_byok(self) -> ByokConnection | None:
        """The connection a BYOK selection may actually run on."""
        if self.byok is not None and self.byok.is_usable:
            return self.byok
        return None

    @property
    def byok_summary(self) -> ByokConnectionSummary | None:
        """Secret-free description of the connection, for catalogs and APIs."""
        return self.byok.summary() if self.byok is not None else None

    def byok_for(self, selection_id: str) -> ByokConnection | None:
        """The connection a BYOK run identity resolves to, if it is usable."""
        selection = self.byok_selection_for(selection_id)
        return self.usable_byok if selection is not None else None

    def byok_selection_for(self, selection_id: str) -> "ByokSelection | None":
        """The resolved BYOK selection behind an identity, if it can run.

        A custom identity only resolves when the connection is actually
        pointed at that endpoint model, so a stale id from a previous
        endpoint fails loudly instead of silently running something else.
        """
        parsed = parse_byok_selection_id(selection_id)
        if parsed is None:
            return None
        connection = self.usable_byok
        if connection is None or connection.provider != parsed.provider:
            return None
        if parsed.is_custom:
            if connection.wire_model != parsed.wire_model:
                return None
            return parsed
        if not connection.serves(parsed.base_model):
            return None
        return parsed

    @property
    def active_mcp_servers(self) -> tuple[McpServerSettings, ...]:
        """Servers that may actually be handed to a Copilot SDK session."""
        return tuple(server for server in self.mcp_servers if server.is_active)

    def safe_metadata(self) -> dict[str, Any]:
        summary = self.byok_summary
        return {
            "byok": summary.to_dict() if summary else None,
            "mcpServers": [server.safe_metadata() for server in self.mcp_servers],
            "diagnostics": [item.to_dict() for item in self.diagnostics],
        }


EMPTY_INTEGRATIONS = IntegrationSettings()


def _parse_byok(
    raw: object,
    diagnostics: list[IntegrationDiagnostic],
) -> ByokConnection | None:
    """Read the BYOK connection block.

    Structural mistakes are refused; a connection that is merely incomplete or
    switched off comes back usable=False with a diagnostic, so the rest of the
    request - and every direct provider - still runs.
    """
    if raw is None:
        return None
    payload = _as_mapping(raw, "copilotSdkByok")
    if not payload:
        return None

    enabled = _clean_bool(payload.get("enabled"), "copilotSdkByok.enabled")
    if not enabled:
        diagnostics.append(
            IntegrationDiagnostic(
                scope="byok",
                code="disabled",
                message=(
                    "Copilot SDK BYOK is switched off, so its saved fields are "
                    "not validated or offered. Direct provider models are unaffected."
                ),
            )
        )
        return None

    provider_value = _clean_text(
        payload.get("provider"), "copilotSdkByok.provider", MAX_NAME_LENGTH
    ).lower()
    if not provider_value:
        raise _fail(
            "Copilot SDK BYOK needs a provider: openai, azure or anthropic."
        )
    if provider_value not in BYOK_PROVIDERS:
        raise _fail(
            f"Unsupported BYOK provider '{provider_value}'. The Copilot SDK "
            "supports openai, azure and anthropic."
        )
    provider: ByokProvider = provider_value  # pyright: ignore[reportAssignmentType]

    wire_value = _clean_text(
        payload.get("wireApi"), "copilotSdkByok.wireApi", MAX_NAME_LENGTH
    ).lower()
    if wire_value and wire_value not in WIRE_APIS:
        raise _fail(
            f"Unsupported wire API '{wire_value}'. Use responses or completions."
        )
    base_url = _clean_text(
        payload.get("baseUrl"), "copilotSdkByok.baseUrl", MAX_URL_LENGTH
    )
    if base_url:
        base_url = _validate_endpoint(base_url, "copilotSdkByok.baseUrl")
    if not wire_value:
        # Chat Completions is the interface every standards-compatible endpoint
        # implements; Responses is not. So a connection pointed at someone
        # else's endpoint defaults to completions, and only a vendor endpoint
        # (no base URL of its own) keeps the responses default. An explicit
        # wireApi always wins.
        wire_value = "completions" if base_url else "responses"
    wire_api: WireApi = wire_value  # pyright: ignore[reportAssignmentType]

    azure_api_version = _clean_text(
        payload.get("azureApiVersion"),
        "copilotSdkByok.azureApiVersion",
        MAX_NAME_LENGTH,
    )
    if azure_api_version and provider != "azure":
        raise _fail("azureApiVersion only applies to an azure BYOK connection.")

    wire_model = _clean_text(
        payload.get("wireModel"), "copilotSdkByok.wireModel", MAX_WIRE_MODEL_LENGTH
    )
    if wire_model and not is_valid_wire_model(wire_model):
        raise _fail(
            f"'{wire_model}' is not a usable endpoint model name. Use the id the "
            "endpoint itself reports, with no spaces."
        )

    connection = ByokConnection(
        enabled=enabled,
        provider=provider,
        wire_api=wire_api,
        base_url=base_url or None,
        # Dedicated credentials only. The direct OpenAI/Anthropic key fields are
        # never read here, so enabling BYOK cannot change what they do.
        api_key=_clean_text(
            payload.get("apiKey"), "copilotSdkByok.apiKey", MAX_VALUE_LENGTH
        )
        or None,
        bearer_token=_clean_text(
            payload.get("bearerToken"),
            "copilotSdkByok.bearerToken",
            MAX_VALUE_LENGTH,
        )
        or None,
        wire_model=wire_model or None,
        azure_api_version=azure_api_version or None,
    )

    reason = connection.unusable_reason
    if reason is not None:
        diagnostics.append(
            IntegrationDiagnostic(
                scope="byok",
                code="disabled" if not enabled else "incomplete",
                message=(
                    f"Copilot SDK BYOK {reason}, so its models are not offered. "
                    "Direct provider models are unaffected."
                ),
                target=provider,
            )
        )
    else:
        diagnostics.append(
            IntegrationDiagnostic(
                scope="byok",
                code="gemini_not_supported",
                message=(
                    "The Copilot SDK has no Gemini provider, so BYOK cannot serve "
                    "Gemini models. Gemini keeps using its own API key directly."
                ),
                target="gemini",
            )
        )

    return connection




def validate_endpoint_url(url: str, label: str) -> str:
    """Refuse an endpoint URL that is unsafe to send a credential to.

    Shared so every caller-supplied URL - BYOK connection or validation
    request - is held to the same rule: http/https only, no embedded
    credentials, and plaintext http only when it cannot leave the machine.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise _fail(f"{label} must be an http:// or https:// URL.")
    if parts.username or parts.password:
        raise _fail(f"{label} must not embed a username or password.")
    host = parts.hostname or ""
    if not host:
        raise _fail(f"{label} must include a host name.")
    if parts.scheme == "http" and not _is_loopback(host):
        raise _fail(
            f"{label} must use https:// unless it points at localhost."
        )
    return url


def _validate_endpoint(url: str, label: str) -> str:
    return validate_endpoint_url(url, label)


def _parse_string_list(
    raw: object,
    label: str,
    limit: int,
    value_limit: int,
    pattern: re.Pattern[str] | None = None,
    allow_wildcard: bool = False,
) -> tuple[str, ...]:
    if raw is None:
        return ()
    if isinstance(raw, (str, bytes)) or not isinstance(raw, Sequence):
        raise _fail(f"{label} must be a list.")
    entries: list[Any] = list(raw)  # pyright: ignore[reportUnknownArgumentType]
    if len(entries) > limit:
        raise _fail(f"{label} has too many entries (limit {limit}).")

    values: list[str] = []
    for index, entry in enumerate(entries):
        text = _clean_text(entry, f"{label}[{index}]", value_limit)
        if not text:
            continue
        if pattern is not None and not pattern.match(text):
            if not (allow_wildcard and text == "*"):
                raise _fail(f"{label}[{index}] '{text}' is not a valid name.")
        values.append(text)
    return tuple(values)


def _parse_string_map(
    raw: object,
    label: str,
    limit: int,
    key_pattern: re.Pattern[str],
) -> dict[str, str]:
    if raw is None:
        return {}
    mapping = _as_mapping(raw, label)
    if len(mapping) > limit:
        raise _fail(f"{label} has too many entries (limit {limit}).")

    values: dict[str, str] = {}
    for key, value in mapping.items():
        name = _clean_text(key, f"{label} key", MAX_NAME_LENGTH)
        if not name:
            raise _fail(f"{label} has an entry with an empty name.")
        if not key_pattern.match(name):
            raise _fail(f"{label} name '{name}' is not allowed.")
        # The value may be a secret; the message must never quote it.
        if value is None:
            values[name] = ""
            continue
        if not isinstance(value, str):
            raise _fail(f"{label} value for '{name}' must be text.")
        text = value.strip()
        if len(text) > MAX_VALUE_LENGTH:
            raise _fail(
                f"{label} value for '{name}' is too long "
                f"(limit {MAX_VALUE_LENGTH} characters)."
            )
        if _UNSAFE_TEXT.search(text) or "\n" in text or "\r" in text:
            raise _fail(
                f"{label} value for '{name}' contains characters that are not "
                "allowed."
            )
        values[name] = text
    return values


def _parse_timeout(raw: object) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise _fail("mcpServers[].timeoutMs must be a number of milliseconds.")
    timeout = int(raw)
    if timeout < MIN_MCP_TIMEOUT_MS or timeout > MAX_MCP_TIMEOUT_MS:
        raise _fail(
            "mcpServers[].timeoutMs must be between "
            f"{MIN_MCP_TIMEOUT_MS} and {MAX_MCP_TIMEOUT_MS} milliseconds."
        )
    return timeout


def _parse_mcp_server(
    raw: object,
    index: int,
    used_keys: dict[str, str],
) -> McpServerSettings:
    payload = _as_mapping(raw, f"mcpServers[{index}]")
    if not payload:
        raise _fail(f"mcpServers[{index}] is empty.")

    identifier = _clean_text(
        payload.get("id"), f"mcpServers[{index}].id", MAX_NAME_LENGTH
    )
    name = _clean_text(
        payload.get("name"), f"mcpServers[{index}].name", MAX_NAME_LENGTH
    )
    if not identifier and not name:
        raise _fail(f"mcpServers[{index}] needs an id or a name.")
    identifier = identifier or name

    key = _normalize_key(name or identifier) or _normalize_key(identifier)
    if not key or not _SAFE_SDK_NAME.match(key):
        raise _fail(
            f"MCP server '{name or identifier}' needs a name containing letters "
            "or digits."
        )
    if key in used_keys:
        raise _fail(
            f"MCP servers '{used_keys[key]}' and '{name or identifier}' resolve "
            f"to the same name '{key}'. Give them distinct names."
        )
    used_keys[key] = name or identifier

    transport_value = _clean_text(
        payload.get("transport"), f"mcpServers[{index}].transport", MAX_NAME_LENGTH
    ).lower()
    if not transport_value:
        raise _fail(
            f"MCP server '{name or identifier}' needs a transport: stdio, http or sse."
        )
    if transport_value not in MCP_TRANSPORTS:
        raise _fail(
            f"MCP server '{name or identifier}' has an unsupported transport "
            f"'{transport_value}'. Use stdio, http or sse."
        )
    transport: McpTransport = transport_value  # pyright: ignore[reportAssignmentType]

    enabled = _clean_bool(payload.get("enabled"), f"mcpServers[{index}].enabled")
    trusted = _clean_bool(payload.get("trusted"), f"mcpServers[{index}].trusted")
    allow_write_tools = _clean_bool(
        payload.get("allowWriteTools"), f"mcpServers[{index}].allowWriteTools"
    )

    command: str | None = None
    args: tuple[str, ...] = ()
    env: dict[str, str] = {}
    working_directory: str | None = None
    url: str | None = None
    headers: dict[str, str] = {}

    if transport == "stdio":
        command = _clean_text(
            payload.get("command"), f"mcpServers[{index}].command", MAX_COMMAND_LENGTH
        )
        if not command:
            raise _fail(
                f"MCP server '{name or identifier}' is a stdio server, so it needs "
                "a command to run."
            )
        # The SDK spawns the command directly (never through a shell), so the
        # argument vector must be explicit rather than one quoted string.
        args = _parse_string_list(
            payload.get("args"),
            f"mcpServers[{index}].args",
            MAX_MCP_ARGS,
            MAX_VALUE_LENGTH,
        )
        env = _parse_string_map(
            payload.get("env"), f"mcpServers[{index}].env", MAX_MCP_ENV, _ENV_NAME
        )
        working_directory = (
            _clean_text(
                payload.get("workingDirectory"),
                f"mcpServers[{index}].workingDirectory",
                MAX_VALUE_LENGTH,
            )
            or None
        )
        if payload.get("url"):
            raise _fail(
                f"MCP server '{name or identifier}' is a stdio server, so it must "
                "not set a url."
            )
    else:
        url = _clean_text(
            payload.get("url"), f"mcpServers[{index}].url", MAX_URL_LENGTH
        )
        if not url:
            raise _fail(
                f"MCP server '{name or identifier}' is a {transport} server, so it "
                "needs a url."
            )
        url = _validate_endpoint(url, f"MCP server '{name or identifier}' url")
        headers = _parse_string_map(
            payload.get("headers"),
            f"mcpServers[{index}].headers",
            MAX_MCP_HEADERS,
            _HEADER_NAME,
        )
        if payload.get("command"):
            raise _fail(
                f"MCP server '{name or identifier}' is a {transport} server, so it "
                "must not set a command."
            )

    tools = _parse_string_list(
        payload.get("tools"),
        f"mcpServers[{index}].tools",
        MAX_MCP_TOOLS,
        MAX_NAME_LENGTH,
        pattern=_TOOL_NAME,
        allow_wildcard=True,
    )

    return McpServerSettings(
        id=identifier,
        key=key,
        name=name or identifier,
        enabled=enabled,
        trusted=trusted,
        transport=transport,
        command=command or None,
        args=args,
        env=env,
        working_directory=working_directory,
        url=url or None,
        headers=headers,
        tools=tools,
        timeout_ms=_parse_timeout(payload.get("timeoutMs")),
        allow_write_tools=allow_write_tools,
    )


def _parse_mcp_servers(
    raw: object,
    diagnostics: list[IntegrationDiagnostic],
) -> tuple[McpServerSettings, ...]:
    if raw is None:
        return ()
    if isinstance(raw, (str, bytes)) or not isinstance(raw, Sequence):
        raise _fail("mcpServers must be a list.")
    entries: list[Any] = list(raw)  # pyright: ignore[reportUnknownArgumentType]
    if len(entries) > MAX_MCP_SERVERS:
        raise _fail(
            f"Too many MCP servers ({len(entries)}); at most {MAX_MCP_SERVERS} "
            "can be configured."
        )

    used_keys: dict[str, str] = {}
    servers: list[McpServerSettings] = []
    for index, entry in enumerate(entries):
        payload: Mapping[str, Any] = (
            _as_mapping(entry, f"mcpServers[{index}]")
            if isinstance(entry, Mapping)
            else {}
        )
        requested_active = (
            payload.get("enabled") is True and payload.get("trusted") is True
        )
        entry_keys = used_keys if requested_active else {}
        try:
            server = _parse_mcp_server(entry, index, entry_keys)
        except IntegrationConfigError as error:
            if requested_active:
                raise
            diagnostics.append(
                IntegrationDiagnostic(
                    scope="mcp",
                    code="incomplete",
                    message=(
                        f"Saved MCP server {index + 1} is inactive and incomplete: "
                        f"{error}"
                    ),
                    target=f"mcp-{index + 1}",
                )
            )
            continue
        servers.append(server)
        if not server.enabled:
            diagnostics.append(
                IntegrationDiagnostic(
                    scope="mcp",
                    code="disabled",
                    message=f"'{server.name}' is switched off, so it is not started.",
                    target=server.key,
                )
            )
        elif not server.trusted:
            diagnostics.append(
                IntegrationDiagnostic(
                    scope="mcp",
                    code="untrusted",
                    message=(
                        f"'{server.name}' is not marked trusted, so shot2code will "
                        "not start it or approve its tools."
                    ),
                    target=server.key,
                )
            )
    return tuple(servers)


def parse_integration_settings(params: object) -> IntegrationSettings:
    """Validate ``copilotSdkByok`` and ``mcpServers`` from a request payload.

    Raises :class:`IntegrationConfigError` with a user-facing sentence when the
    configuration cannot be used at all. Choices that are merely inactive
    (switched off, incomplete, untrusted) come back as diagnostics, because a
    half-configured extra never justifies failing a generation that the direct
    providers could have run.
    """
    payload = _as_mapping(params, "request")
    diagnostics: list[IntegrationDiagnostic] = []
    byok = _parse_byok(payload.get("copilotSdkByok"), diagnostics)
    servers = _parse_mcp_servers(payload.get("mcpServers"), diagnostics)
    return IntegrationSettings(
        byok=byok,
        mcp_servers=servers,
        diagnostics=tuple(diagnostics),
    )
