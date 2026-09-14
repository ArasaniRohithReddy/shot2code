"""Which models a user can actually pick, and which of their picks still work.

Two very different questions live here.

*What exists* differs per provider. GitHub Copilot publishes the models a plan
can use through the SDK, so that list is discovered live and the catalog simply
reflects it. OpenAI, Anthropic and Google have no equivalent endpoint wired into
shot2code that reports *vision-capable, agent-usable* models with the reasoning
variants this app drives, so those providers use the maintained table in
``llm.py``: every entry there is a model shot2code has been run against.

*What a user may pick* additionally depends on credentials. A model whose
provider has no key configured is not offered, and a saved selection that points
at something the catalog no longer contains is reported as stale rather than
silently dropped, so the UI can say what happened.

Nothing in here reads or returns a secret. Callers pass the credentials they
already hold; the catalog only answers "is one present".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Literal, Sequence

from llm import (
    ANTHROPIC_MODELS,
    COPILOT_MODEL_CONFIG,
    COPILOT_MODELS,
    GEMINI_MODELS,
    MODEL_PROVIDERS,
    OPENAI_MODELS,
    Llm,
    ModelProvider,
    get_copilot_api_name,
    get_model_api_name,
    get_model_effort,
    model_from_value,
    provider_for_model,
)

ModelStatus = Literal["available", "deprecated"]

# Where a provider's credential came from. Never the credential itself.
CredentialSource = Literal["request", "environment", "session"]

PROVIDER_LABELS: dict[ModelProvider, str] = {
    "copilot": "GitHub Copilot",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "gemini": "Google Gemini",
}

# What the user has to supply to unlock each provider, in UI wording.
PROVIDER_CREDENTIAL_LABELS: dict[ModelProvider, str] = {
    "copilot": "GitHub sign-in or token",
    "openai": "OpenAI API key",
    "anthropic": "Anthropic API key",
    "gemini": "Gemini API key",
}

# How the catalog for each provider is produced, so the UI can explain why a
# list looks the way it does.
PROVIDER_SOURCE_KIND: dict[ModelProvider, Literal["discovered", "curated"]] = {
    "copilot": "discovered",
    "openai": "curated",
    "anthropic": "curated",
    "gemini": "curated",
}

# Order providers are presented in. Copilot first because it needs no API key.
PROVIDER_ORDER: tuple[ModelProvider, ...] = (
    "copilot",
    "openai",
    "anthropic",
    "gemini",
)

# Only Gemini reads a recording natively; the Copilot provider samples it into
# frames. OpenAI and Anthropic get no video path here, so their models are not
# offered for video input.
VIDEO_CAPABLE_PROVIDERS: frozenset[ModelProvider] = frozenset({"gemini", "copilot"})

# Superseded inside this same catalog: a newer member of the same family is
# offered alongside them. Still selectable (and still honoured when already
# selected) but hidden by default and never auto-selected.
DEPRECATED_MODELS: frozenset[Llm] = frozenset(
    {
        # Dated gpt-5.4 snapshots, superseded by gpt-5.5 and gpt-5.6.
        Llm.GPT_5_4_2026_03_05_NONE,
        Llm.GPT_5_4_2026_03_05_LOW,
        Llm.GPT_5_4_2026_03_05_MEDIUM,
        Llm.GPT_5_4_2026_03_05_HIGH,
        Llm.GPT_5_4_2026_03_05_XHIGH,
        # gemini-3.5-flash, superseded by gemini-3.6-flash at every level.
        Llm.GEMINI_3_5_FLASH_HIGH,
        Llm.GEMINI_3_5_FLASH_MEDIUM,
        Llm.GEMINI_3_5_FLASH_LOW,
        Llm.GEMINI_3_5_FLASH_MINIMAL,
    }
)

# Models the auto-selection prefers, surfaced so the picker can mark them.
RECOMMENDED_MODELS: frozenset[Llm] = frozenset(
    {
        Llm.GPT_5_6_SOL_MAX,
        Llm.GPT_5_6_SOL_HIGH,
        Llm.CLAUDE_OPUS_5_MEDIUM,
        Llm.CLAUDE_OPUS_5_HIGH,
        Llm.GEMINI_3_FLASH_PREVIEW_HIGH,
        Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
        Llm.GEMINI_3_1_PRO_PREVIEW_HIGH,
    }
)

# Display names for the model families the curated providers expose. Anything
# missing (including every live Copilot id) falls back to _prettify_family.
FAMILY_LABELS: dict[str, str] = {
    "gpt-5.4-mini": "GPT 5.4 Mini",
    "gpt-5.4-2026-03-05": "GPT 5.4 (2026-03-05)",
    "gpt-5.5": "GPT 5.5",
    "gpt-5.6-sol": "GPT 5.6 Sol",
    "gpt-5.6-terra": "GPT 5.6 Terra",
    "claude-opus-5": "Claude Opus 5",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-fable-5": "Claude Fable 5",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "gemini-3-flash-preview": "Gemini 3 Flash",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
    "gemini-3.5-flash": "Gemini 3.5 Flash",
    "gemini-3.6-flash": "Gemini 3.6 Flash",
}

# Tokens that are acronyms rather than words when prettifying an id.
_UPPERCASE_TOKENS = {"gpt", "mai", "ai", "llm", "xai"}


def _prettify_family(api_name: str) -> str:
    """Turn a provider's model id into something a person can read."""
    if api_name in FAMILY_LABELS:
        return FAMILY_LABELS[api_name]

    words: list[str] = []
    for token in api_name.split("-"):
        if not token:
            continue
        if token.lower() in _UPPERCASE_TOKENS:
            words.append(token.upper())
        elif token[0].isdigit():
            words.append(token)
        else:
            words.append(token[0].upper() + token[1:])
    return " ".join(words) or api_name


@dataclass(frozen=True)
class CatalogModel:
    """One selectable model, identified by the value that crosses the wire."""

    id: str
    provider: ModelProvider
    label: str
    family: str
    effort: str | None
    status: ModelStatus
    recommended: bool
    supports_video: bool

    @property
    def model(self) -> Llm:
        resolved = model_from_value(self.id)
        assert resolved is not None, self.id
        return resolved


@dataclass(frozen=True)
class ProviderCatalog:
    """A provider, whether it is usable right now, and what it offers."""

    id: ModelProvider
    label: str
    available: bool
    credential_label: str
    credential_source: CredentialSource | None
    source_kind: Literal["discovered", "curated"]
    models: tuple[CatalogModel, ...]
    # Live Copilot ids this build has no mapping for. Surfaced so the UI can say
    # why a model the plan lists is not offered instead of hiding it silently.
    unsupported_model_ids: tuple[str, ...] = ()
    detail: str = ""


@dataclass(frozen=True)
class ModelCatalog:
    providers: tuple[ProviderCatalog, ...]

    @property
    def available_providers(self) -> tuple[ModelProvider, ...]:
        return tuple(p.id for p in self.providers if p.available)

    def model_ids(self) -> set[str]:
        return {model.id for provider in self.providers for model in provider.models}

    def find_all(self) -> tuple[CatalogModel, ...]:
        return tuple(
            model for provider in self.providers for model in provider.models
        )

    def find(self, model_id: str) -> CatalogModel | None:
        for provider in self.providers:
            for model in provider.models:
                if model.id == model_id:
                    return model
        return None


def _no_request_providers() -> frozenset[ModelProvider]:
    return frozenset()


@dataclass(frozen=True)
class ProviderCredentials:
    """Credentials as presented for this request. Values are never returned."""

    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    copilot_available: bool = False
    copilot_login: str | None = None
    copilot_model_ids: tuple[str, ...] = ()
    # Which providers took their key from the request rather than the process
    # environment, so the UI can say where a credential came from.
    request_providers: frozenset[ModelProvider] = field(
        default_factory=_no_request_providers
    )


def _curated_models(models: Iterable[Llm]) -> tuple[CatalogModel, ...]:
    entries: list[CatalogModel] = []
    for model in models:
        provider = provider_for_model(model)
        family = get_model_api_name(model)
        effort = get_model_effort(model)
        family_label = _prettify_family(family)
        entries.append(
            CatalogModel(
                id=model.value,
                provider=provider,
                label=f"{family_label} ({effort})" if effort else family_label,
                family=family_label,
                effort=effort,
                status="deprecated" if model in DEPRECATED_MODELS else "available",
                recommended=model in RECOMMENDED_MODELS,
                supports_video=provider in VIDEO_CAPABLE_PROVIDERS,
            )
        )
    # Available before deprecated, then stable by label so the UI never
    # reshuffles between requests.
    entries.sort(key=lambda entry: (entry.status == "deprecated", entry.label))
    return tuple(entries)


def _copilot_models(
    live_ids: Sequence[str],
) -> tuple[tuple[CatalogModel, ...], tuple[str, ...]]:
    """Map live Copilot ids onto the models this build can actually route to."""
    known_by_api_name = {
        get_copilot_api_name(model): model for model in COPILOT_MODEL_CONFIG
    }

    entries: list[CatalogModel] = []
    unsupported: list[str] = []
    seen: set[str] = set()
    for api_name in live_ids:
        if api_name in seen:
            continue
        seen.add(api_name)
        model = known_by_api_name.get(api_name)
        if model is None:
            unsupported.append(api_name)
            continue
        entries.append(
            CatalogModel(
                id=model.value,
                provider="copilot",
                label=_prettify_family(api_name),
                family=_prettify_family(api_name),
                effort=get_model_effort(model),
                status="available",
                recommended=False,
                supports_video=True,
            )
        )
    return tuple(entries), tuple(unsupported)


def build_catalog(credentials: ProviderCredentials) -> ModelCatalog:
    """The providers and models this caller may choose from right now.

    Credentials are taken as given: callers merge their own defaults (the
    request, then the process environment) before calling, so this stays a pure
    function of its input and can be reasoned about - and tested - in isolation.
    """
    key_by_provider: dict[ModelProvider, str | None] = {
        "openai": credentials.openai_api_key,
        "anthropic": credentials.anthropic_api_key,
        "gemini": credentials.gemini_api_key,
    }
    curated_by_provider: dict[ModelProvider, frozenset[Llm]] = {
        "openai": frozenset(OPENAI_MODELS),
        "anthropic": frozenset(ANTHROPIC_MODELS),
        "gemini": frozenset(GEMINI_MODELS),
    }

    providers: list[ProviderCatalog] = []
    for provider_id in PROVIDER_ORDER:
        if provider_id == "copilot":
            models, unsupported = _copilot_models(credentials.copilot_model_ids)
            detail = (
                f"Signed in as {credentials.copilot_login}"
                if credentials.copilot_available and credentials.copilot_login
                else (
                    "Models your Copilot plan currently offers."
                    if credentials.copilot_available
                    else "Sign in with `gh auth login` or `copilot`, or paste a token."
                )
            )
            providers.append(
                ProviderCatalog(
                    id=provider_id,
                    label=PROVIDER_LABELS[provider_id],
                    available=credentials.copilot_available,
                    credential_label=PROVIDER_CREDENTIAL_LABELS[provider_id],
                    credential_source=(
                        ("request" if provider_id in credentials.request_providers else "session")
                        if credentials.copilot_available
                        else None
                    ),
                    source_kind=PROVIDER_SOURCE_KIND[provider_id],
                    models=models,
                    unsupported_model_ids=unsupported,
                    detail=detail,
                )
            )
            continue

        key = key_by_provider[provider_id]
        available = bool(key)
        providers.append(
            ProviderCatalog(
                id=provider_id,
                label=PROVIDER_LABELS[provider_id],
                available=available,
                credential_label=PROVIDER_CREDENTIAL_LABELS[provider_id],
                credential_source=(
                    (
                        "request"
                        if provider_id in credentials.request_providers
                        else "environment"
                    )
                    if available
                    else None
                ),
                source_kind=PROVIDER_SOURCE_KIND[provider_id],
                models=_curated_models(curated_by_provider[provider_id])
                if available
                else (),
                detail=(
                    "Validated model list maintained with shot2code."
                    if available
                    else f"Add an {PROVIDER_CREDENTIAL_LABELS[provider_id]} to use these models."
                ),
            )
        )

    assert {provider.id for provider in providers} == set(MODEL_PROVIDERS)
    return ModelCatalog(providers=tuple(providers))


@dataclass(frozen=True)
class DroppedModel:
    """A selected model that cannot run, and the reason in user-facing words."""

    id: str
    reason: str


@dataclass(frozen=True)
class SelectionResult:
    models: tuple[Llm, ...]
    dropped: tuple[DroppedModel, ...]

    @property
    def notice(self) -> str | None:
        if not self.dropped:
            return None
        details = ", ".join(f"{item.id} ({item.reason})" for item in self.dropped)
        return f"Skipped {len(self.dropped)} selected model(s): {details}"


def parse_selected_models(values: object) -> tuple[tuple[Llm, ...], tuple[str, ...]]:
    """Split a client-supplied id list into known models and unknown strings."""
    if not isinstance(values, list):
        return (), ()

    known: list[Llm] = []
    unknown: list[str] = []
    seen: set[Llm] = set()
    for value in values:  # pyright: ignore[reportUnknownVariableType]
        model = model_from_value(value)
        if model is None:
            if isinstance(value, str) and value.strip():
                unknown.append(value)
            continue
        if model in seen:
            continue
        seen.add(model)
        known.append(model)
    return tuple(known), tuple(unknown)


def filter_selection(
    models: Sequence[Llm],
    catalog: ModelCatalog,
    unknown_ids: Sequence[str] = (),
    input_mode: str | None = None,
) -> SelectionResult:
    """Keep the picks that can still run, and say why the rest cannot."""
    available_ids = catalog.model_ids()
    available_providers = set(catalog.available_providers)

    kept: list[Llm] = []
    dropped: list[DroppedModel] = [
        DroppedModel(id=value, reason="unknown model") for value in unknown_ids
    ]

    for model in models:
        provider = provider_for_model(model)
        if provider not in available_providers:
            dropped.append(
                DroppedModel(
                    id=model.value,
                    reason=f"no {PROVIDER_CREDENTIAL_LABELS[provider]} configured",
                )
            )
            continue
        if model.value not in available_ids:
            dropped.append(
                DroppedModel(
                    id=model.value,
                    reason="no longer offered by "
                    f"{PROVIDER_LABELS[provider]}",
                )
            )
            continue
        if input_mode == "video" and provider not in VIDEO_CAPABLE_PROVIDERS:
            dropped.append(
                DroppedModel(id=model.value, reason="cannot read video")
            )
            continue
        kept.append(model)

    return SelectionResult(models=tuple(kept), dropped=tuple(dropped))


def stale_selection_ids(
    selected_ids: Sequence[str], catalog: ModelCatalog
) -> tuple[str, ...]:
    """Saved ids the catalog no longer offers, for the UI to flag and clear."""
    available = catalog.model_ids()
    return tuple(
        value for value in dict.fromkeys(selected_ids) if value not in available
    )
