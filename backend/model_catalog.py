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
from typing import Iterable, Literal, Mapping, Sequence

from integrations.config import (
    BYOK_PROVIDERS,
    MAX_MODEL_SELECTIONS,
    MODEL_RUNTIMES,
    ByokConnectionSummary,
    ByokSelection,
    ModelRuntime,
    byok_custom_selection,
    byok_custom_selection_id,
    byok_selection_id,
    is_byok_selection_id,
    is_valid_wire_model,
    neutral_base_model,
    parse_byok_selection_id,
)
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
# "sdk-byok" means the provider is reachable through a Copilot SDK BYOK
# connection rather than its own API key.
CredentialSource = Literal["request", "environment", "session", "sdk-byok"]

PROVIDER_LABELS: dict[ModelProvider, str] = {
    "copilot": "GitHub Copilot",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "gemini": "Google Gemini",
    "sdk-byok": "Copilot SDK (BYOK)",
}

# What the user has to supply to unlock each provider, in UI wording.
PROVIDER_CREDENTIAL_LABELS: dict[ModelProvider, str] = {
    "copilot": "GitHub sign-in or token",
    "openai": "OpenAI API key",
    "anthropic": "Anthropic API key",
    "gemini": "Gemini API key",
    "sdk-byok": "BYOK profile with its own endpoint and key",
}

# How the catalog for each provider is produced, so the UI can explain why a
# list looks the way it does.
PROVIDER_SOURCE_KIND: dict[
    ModelProvider, Literal["discovered", "curated", "configured"]
] = {
    "copilot": "discovered",
    "openai": "curated",
    "anthropic": "curated",
    "gemini": "curated",
    "sdk-byok": "configured",
}

# Order providers are presented in. Copilot first because it needs no API key;
# the BYOK runtime last because it is an explicit, additive extra.
PROVIDER_ORDER: tuple[ModelProvider, ...] = (
    "copilot",
    "openai",
    "anthropic",
    "gemini",
    "sdk-byok",
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
    """One selectable entry, identified by the value that crosses the wire.

    For a direct model the id *is* the ``Llm`` value and the runtime is
    ``native``. For a Copilot SDK BYOK entry the id is the run identity
    ``sdk-byok/<provider>/<base model>`` and ``base_model_id`` names the
    ``Llm`` whose capabilities it borrows - the two ids are different, so both
    can be selected in the same generation.
    """

    id: str
    provider: ModelProvider
    label: str
    family: str
    effort: str | None
    status: ModelStatus
    recommended: bool
    supports_video: bool
    runtime: ModelRuntime = "native"
    base_model_id: str | None = None
    # The endpoint's own model name, when the entry is a custom BYOK model.
    wire_model: str | None = None

    @property
    def model(self) -> Llm:
        """The model whose capabilities this entry runs with."""
        if self.base_model_id is None and self.wire_model is not None:
            # A custom endpoint model runs under a neutral template.
            return neutral_base_model(
                self.id.split("/")[1] if "/" in self.id else "openai"  # pyright: ignore[reportArgumentType]
            )
        resolved = model_from_value(self.base_model_id or self.id)
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
    source_kind: Literal["discovered", "curated", "configured"]
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
    # Secret-free description of the user's Copilot SDK BYOK connection. It is
    # listed as its own provider group and never affects the direct ones.
    byok: ByokConnectionSummary | None = None


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


def _byok_models(
    connection: ByokConnectionSummary | None,
) -> tuple[CatalogModel, ...]:
    """What a usable BYOK connection offers.

    When the connection names a ``wireModel``, that is the *only* model the
    endpoint serves, so exactly one entry is published under that real name.
    Offering a whole vendor family for an endpoint that hosts one model would
    be a lie that many aliases all resolve to the same thing.

    Without a wire model the connection is addressing a vendor API that does
    host the family, so the catalog list is the family.
    """
    if connection is None or not connection.usable:
        return ()

    if connection.custom_selection_id and connection.wire_model:
        served = connection.wire_model
        return (
            CatalogModel(
                id=connection.custom_selection_id,
                provider="sdk-byok",
                label=f"{served} via {connection.provider}",
                family=served,
                # An arbitrary endpoint model has no thinking level to report.
                effort=None,
                status="available",
                recommended=False,
                supports_video=False,
                runtime="copilot-byok",
                base_model_id=None,
                wire_model=served,
            ),
        )

    curated: dict[ModelProvider, frozenset[Llm]] = {
        "openai": frozenset(OPENAI_MODELS),
        "anthropic": frozenset(ANTHROPIC_MODELS),
    }
    base_models = curated.get(connection.base_provider, frozenset())

    entries: list[CatalogModel] = []
    for base in _curated_models(base_models):
        model = base.model
        entries.append(
            CatalogModel(
                id=byok_selection_id(connection.provider, model),
                provider="sdk-byok",
                label=f"{base.label} via {connection.provider}",
                family=base.family,
                effort=base.effort,
                status=base.status,
                recommended=False,
                # The SDK has no video path for a BYOK endpoint.
                supports_video=False,
                runtime="copilot-byok",
                base_model_id=model.value,
            )
        )
    return tuple(entries)


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

        if provider_id == "sdk-byok":
            byok_models = _byok_models(credentials.byok)
            summary = credentials.byok
            providers.append(
                ProviderCatalog(
                    id=provider_id,
                    label=PROVIDER_LABELS[provider_id],
                    available=bool(byok_models),
                    credential_label=PROVIDER_CREDENTIAL_LABELS[provider_id],
                    # This group is always its own credential; a direct
                    # provider is never relabelled because of it.
                    credential_source="sdk-byok" if byok_models else None,
                    source_kind=PROVIDER_SOURCE_KIND[provider_id],
                    models=byok_models,
                    detail=(
                        "Your own endpoint, run through the Copilot SDK."
                        if byok_models
                        else (
                            f"Copilot SDK BYOK {summary.reason}."
                            if summary is not None and summary.reason
                            else "Add your own endpoint and key to use it."
                        )
                    ),
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
class ModelRunSpec:
    """What one variant runs: a base model plus the runtime that executes it.

    ``selection_id`` is the identity the user picked, what history persists and
    what a retry replays. A native spec's id is the model id itself; a BYOK
    spec's id is ``sdk-byok/<provider>/<base model>`` or, for a model only the
    user's endpoint knows, ``sdk-byok/<provider>/custom/<encoded model>``.
    Because the two differ, a direct and a BYOK variant of the *same* base
    model coexist happily in one generation, and a native spec is never
    re-routed just because BYOK is on.

    ``wire_model`` is the name the endpoint is actually asked for. When it is
    set, ``model`` is only a compatibility template - it says how to prompt,
    never what to call.
    """

    model: Llm
    selection_id: str
    runtime: ModelRuntime = "native"
    wire_model: str | None = None

    @staticmethod
    def native(model: Llm) -> "ModelRunSpec":
        return ModelRunSpec(model=model, selection_id=model.value, runtime="native")

    @staticmethod
    def byok(provider: str, model: Llm) -> "ModelRunSpec":
        return ModelRunSpec(
            model=model,
            selection_id=byok_selection_id(provider, model),  # pyright: ignore[reportArgumentType]
            runtime="copilot-byok",
        )

    @staticmethod
    def byok_custom(provider: str, wire_model: str) -> "ModelRunSpec":
        """A model only the user's own endpoint knows, run under a neutral
        non-reasoning template unless the name maps to a known model."""
        return ModelRunSpec.from_byok_selection(
            byok_custom_selection(provider, wire_model)  # pyright: ignore[reportArgumentType]
        )

    @staticmethod
    def from_byok_selection(selection: ByokSelection) -> "ModelRunSpec":
        return ModelRunSpec(
            model=selection.base_model,
            selection_id=selection.selection_id,
            runtime="copilot-byok",
            wire_model=selection.wire_model,
        )

    @property
    def is_byok(self) -> bool:
        return self.runtime == "copilot-byok"

    @property
    def is_custom_model(self) -> bool:
        """True when the endpoint's own model name is what goes on the wire."""
        return self.wire_model is not None


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


@dataclass(frozen=True)
class RunSpecSelectionResult:
    specs: tuple[ModelRunSpec, ...]
    dropped: tuple[DroppedModel, ...]

    @property
    def models(self) -> tuple[Llm, ...]:
        return tuple(spec.model for spec in self.specs)

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


def _spec_from_entry(entry: object) -> tuple[ModelRunSpec | None, str | None]:
    """One ``modelSelections`` entry, or a legacy id string, as a run spec.

    Returns ``(spec, unknown_id)``. A structured entry wins over guessing: the
    runtime comes from the entry, so an id the backend cannot parse is reported
    rather than silently downgraded to native.
    """
    if isinstance(entry, str):
        model = model_from_value(entry)
        if model is not None:
            return ModelRunSpec.native(model), None
        parsed = parse_byok_selection_id(entry)
        if parsed is not None:
            return ModelRunSpec.from_byok_selection(parsed), None
        return None, entry if entry.strip() else None

    if not isinstance(entry, Mapping):
        return None, None

    raw_id = entry.get("id")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    identity = raw_id if isinstance(raw_id, str) and raw_id.strip() else None
    raw_runtime = entry.get("runtime")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    runtime = raw_runtime if raw_runtime in MODEL_RUNTIMES else None
    raw_wire = entry.get("wireModel")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    wire_model = (
        raw_wire.strip()
        if isinstance(raw_wire, str) and is_valid_wire_model(raw_wire)
        else None
    )
    base = model_from_value(entry.get("baseModel"))  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]

    # The identity is authoritative: it already encodes provider, runtime and,
    # for a custom endpoint model, the exact name to send.
    parsed = parse_byok_selection_id(identity) if identity else None
    if parsed is not None:
        if parsed.is_custom:
            return ModelRunSpec.from_byok_selection(parsed), None
        return ModelRunSpec.from_byok_selection(parsed), None

    if base is None and identity is not None:
        # An entry may omit baseModel when the id already carries it.
        base = model_from_value(identity)

    if runtime == "copilot-byok":
        # A BYOK entry whose identity did not parse can still be honoured when
        # it names its endpoint model and provider explicitly.
        raw_provider = entry.get("provider")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        if wire_model and raw_provider in BYOK_PROVIDERS:
            return ModelRunSpec.byok_custom(raw_provider, wire_model), None  # pyright: ignore[reportArgumentType]
        # Otherwise the provider is unknown, so it cannot be run on the right
        # runtime and is reported instead of guessed.
        return None, identity

    if base is None:
        return None, identity
    return ModelRunSpec.native(base), None


def parse_model_selections(
    values: object,
) -> tuple[tuple[ModelRunSpec, ...], tuple[str, ...]]:
    """Resolve ``modelSelections`` (or a legacy id list) into run specs.

    Order is preserved and entries are de-duplicated by *identity*, so the same
    base model may appear twice when its runtimes differ.
    """
    if not isinstance(values, list):
        return (), ()

    specs: list[ModelRunSpec] = []
    unknown: list[str] = []
    seen: set[str] = set()
    for entry in values[:MAX_MODEL_SELECTIONS]:  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
        spec, unknown_id = _spec_from_entry(entry)
        if spec is None:
            if unknown_id:
                unknown.append(unknown_id)
            continue
        if spec.selection_id in seen:
            continue
        seen.add(spec.selection_id)
        specs.append(spec)
    return tuple(specs), tuple(unknown)


def filter_run_specs(
    specs: Sequence[ModelRunSpec],
    catalog: ModelCatalog,
    unknown_ids: Sequence[str] = (),
    input_mode: str | None = None,
    byok_reason: str | None = None,
) -> RunSpecSelectionResult:
    """Keep the picks that can still run, and say why the rest cannot."""
    available_ids = catalog.model_ids()
    available_providers = set(catalog.available_providers)

    kept: list[ModelRunSpec] = []
    dropped: list[DroppedModel] = [
        DroppedModel(id=value, reason="unknown model") for value in unknown_ids
    ]

    for spec in specs:
        provider: ModelProvider = (
            "sdk-byok" if spec.is_byok else provider_for_model(spec.model)
        )
        if spec.selection_id not in available_ids:
            if spec.is_byok:
                dropped.append(
                    DroppedModel(
                        id=spec.selection_id,
                        reason=byok_reason or "Copilot SDK BYOK is not configured",
                    )
                )
                continue
            if provider not in available_providers:
                dropped.append(
                    DroppedModel(
                        id=spec.selection_id,
                        reason=f"no {PROVIDER_CREDENTIAL_LABELS[provider]} configured",
                    )
                )
                continue
            dropped.append(
                DroppedModel(
                    id=spec.selection_id,
                    reason=f"no longer offered by {PROVIDER_LABELS[provider]}",
                )
            )
            continue
        if input_mode == "video" and provider not in VIDEO_CAPABLE_PROVIDERS:
            dropped.append(
                DroppedModel(id=spec.selection_id, reason="cannot read video")
            )
            continue
        kept.append(spec)

    return RunSpecSelectionResult(specs=tuple(kept), dropped=tuple(dropped))


def filter_selection(
    models: Sequence[Llm],
    catalog: ModelCatalog,
    unknown_ids: Sequence[str] = (),
    input_mode: str | None = None,
) -> SelectionResult:
    """Keep the direct picks that can still run, and say why the rest cannot."""
    result = filter_run_specs(
        [ModelRunSpec.native(model) for model in models],
        catalog,
        unknown_ids=unknown_ids,
        input_mode=input_mode,
    )
    return SelectionResult(models=result.models, dropped=result.dropped)


def stale_selection_ids(
    selected_ids: Sequence[str], catalog: ModelCatalog
) -> tuple[str, ...]:
    """Saved ids the catalog no longer offers, for the UI to flag and clear."""
    available = catalog.model_ids()
    return tuple(
        value for value in dict.fromkeys(selected_ids) if value not in available
    )
