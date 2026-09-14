"""The catalog decides what a user may pick, so these pin its rules down."""

import pytest

from llm import (
    ANTHROPIC_MODELS,
    COPILOT_MODELS,
    GEMINI_MODELS,
    MODEL_PROVIDERS,
    OPENAI_MODELS,
    Llm,
    MODELS_BY_VALUE,
    get_model_api_name,
    get_model_effort,
    model_from_value,
    provider_for_model,
)
from model_catalog import (
    DEPRECATED_MODELS,
    ProviderCredentials,
    build_catalog,
    filter_selection,
    parse_selected_models,
    stale_selection_ids,
)


class TestModelIdentity:
    def test_every_model_has_exactly_one_provider(self) -> None:
        for model in Llm:
            assert provider_for_model(model) in MODEL_PROVIDERS

    def test_provider_sets_partition_the_enum(self) -> None:
        union = OPENAI_MODELS | ANTHROPIC_MODELS | GEMINI_MODELS | COPILOT_MODELS
        assert union == set(Llm)
        assert len(union) == sum(
            len(group)
            for group in (OPENAI_MODELS, ANTHROPIC_MODELS, GEMINI_MODELS, COPILOT_MODELS)
        )

    def test_wire_values_round_trip(self) -> None:
        for model in Llm:
            assert model_from_value(model.value) is model
        assert len(MODELS_BY_VALUE) == len(list(Llm))

    def test_unknown_and_non_string_values_resolve_to_none(self) -> None:
        assert model_from_value("gpt-9000") is None
        assert model_from_value(None) is None
        assert model_from_value(42) is None

    def test_every_model_reports_an_api_name(self) -> None:
        for model in Llm:
            assert get_model_api_name(model)

    def test_effort_is_reported_only_when_configured(self) -> None:
        assert get_model_effort(Llm.GPT_5_6_SOL_MAX) == "max"
        assert get_model_effort(Llm.CLAUDE_OPUS_5_LOW) == "low"
        assert get_model_effort(Llm.GEMINI_3_6_FLASH_MINIMAL) == "minimal"
        assert get_model_effort(Llm.CLAUDE_SONNET_4_6) is None
        assert get_model_effort(Llm.COPILOT_CLAUDE_OPUS_5) is None


class TestProviderAvailability:
    def test_a_provider_without_a_key_offers_nothing(self) -> None:
        catalog = build_catalog(ProviderCredentials())

        assert catalog.available_providers == ()
        for provider in catalog.providers:
            assert provider.models == ()
            assert provider.credential_source is None
            assert provider.credential_label

    def test_only_providers_with_credentials_are_available(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(openai_api_key="key", gemini_api_key="key")
        )

        assert set(catalog.available_providers) == {"openai", "gemini"}

    def test_credential_source_distinguishes_request_from_environment(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                openai_api_key="from-browser",
                anthropic_api_key="from-env",
                request_providers=frozenset({"openai"}),
            )
        )

        by_id = {provider.id: provider for provider in catalog.providers}
        assert by_id["openai"].credential_source == "request"
        assert by_id["anthropic"].credential_source == "environment"

    def test_copilot_availability_comes_from_the_live_snapshot(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                copilot_available=True,
                copilot_login="octocat",
                copilot_model_ids=("claude-opus-5", "gpt-5.6-sol"),
            )
        )

        copilot = next(p for p in catalog.providers if p.id == "copilot")
        assert copilot.available is True
        assert copilot.source_kind == "discovered"
        assert "octocat" in copilot.detail
        assert [model.id for model in copilot.models] == [
            Llm.COPILOT_CLAUDE_OPUS_5.value,
            Llm.COPILOT_GPT_5_6_SOL.value,
        ]

    def test_no_credential_value_is_ever_returned(self) -> None:
        secret = "sk-super-secret-value"
        catalog = build_catalog(
            ProviderCredentials(
                openai_api_key=secret,
                anthropic_api_key=secret,
                gemini_api_key=secret,
            )
        )

        assert secret not in repr(catalog)


class TestCatalogContents:
    def test_curated_providers_expose_their_whole_validated_list(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                openai_api_key="key",
                anthropic_api_key="key",
                gemini_api_key="key",
            )
        )

        by_id = {provider.id: provider for provider in catalog.providers}
        assert {m.id for m in by_id["openai"].models} == {
            m.value for m in OPENAI_MODELS
        }
        assert {m.id for m in by_id["anthropic"].models} == {
            m.value for m in ANTHROPIC_MODELS
        }
        assert {m.id for m in by_id["gemini"].models} == {
            m.value for m in GEMINI_MODELS
        }
        for provider in ("openai", "anthropic", "gemini"):
            assert by_id[provider].source_kind == "curated"

    def test_deprecated_models_are_marked_and_sorted_last(self) -> None:
        catalog = build_catalog(ProviderCredentials(gemini_api_key="key"))
        gemini = next(p for p in catalog.providers if p.id == "gemini")

        statuses = [model.status for model in gemini.models]
        assert "deprecated" in statuses
        assert statuses == sorted(statuses, key=lambda s: s == "deprecated")
        deprecated_ids = {
            model.id for model in gemini.models if model.status == "deprecated"
        }
        assert deprecated_ids == {
            model.value for model in DEPRECATED_MODELS if model in GEMINI_MODELS
        }

    def test_labels_are_human_readable(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                openai_api_key="key",
                anthropic_api_key="key",
                gemini_api_key="key",
                copilot_available=True,
                copilot_model_ids=("mai-code-1.1-flash", "gpt-6-astra"),
            )
        )

        labels = {model.id: model.label for model in catalog.find_all()}
        assert labels[Llm.GPT_5_6_SOL_MAX.value] == "GPT 5.6 Sol (max)"
        assert labels[Llm.CLAUDE_OPUS_4_8_HIGH.value] == "Claude Opus 4.8 (high)"
        assert labels[Llm.CLAUDE_SONNET_4_6.value] == "Claude Sonnet 4.6"
        assert labels[Llm.GEMINI_3_1_PRO_PREVIEW_LOW.value] == "Gemini 3.1 Pro (low)"
        assert labels[Llm.COPILOT_MAI_CODE_1_1_FLASH.value] == "MAI Code 1.1 Flash"
        assert labels[Llm.COPILOT_GPT_6_ASTRA.value] == "GPT 6 Astra"

    def test_only_gemini_and_copilot_models_claim_video(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                openai_api_key="key",
                anthropic_api_key="key",
                gemini_api_key="key",
                copilot_available=True,
                copilot_model_ids=("claude-opus-5",),
            )
        )

        for model in catalog.find_all():
            assert model.supports_video == (model.provider in {"gemini", "copilot"})

    def test_copilot_ids_this_build_cannot_route_are_reported(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                copilot_available=True,
                copilot_model_ids=("claude-opus-5", "brand-new-model-9"),
            )
        )

        copilot = next(p for p in catalog.providers if p.id == "copilot")
        assert [m.id for m in copilot.models] == [Llm.COPILOT_CLAUDE_OPUS_5.value]
        assert copilot.unsupported_model_ids == ("brand-new-model-9",)

    def test_duplicate_live_copilot_ids_are_collapsed(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                copilot_available=True,
                copilot_model_ids=("claude-opus-5", "claude-opus-5"),
            )
        )

        copilot = next(p for p in catalog.providers if p.id == "copilot")
        assert len(copilot.models) == 1


class TestParseSelectedModels:
    def test_splits_known_models_from_unknown_ids(self) -> None:
        known, unknown = parse_selected_models(
            [Llm.GPT_5_5_HIGH.value, "nope", 3, None, ""]
        )

        assert known == (Llm.GPT_5_5_HIGH,)
        assert unknown == ("nope",)

    def test_preserves_order_and_removes_duplicates(self) -> None:
        known, _ = parse_selected_models(
            [
                Llm.GEMINI_3_6_FLASH_LOW.value,
                Llm.GPT_5_5_HIGH.value,
                Llm.GEMINI_3_6_FLASH_LOW.value,
            ]
        )

        assert known == (Llm.GEMINI_3_6_FLASH_LOW, Llm.GPT_5_5_HIGH)

    @pytest.mark.parametrize("value", [None, "gpt-5.5 (high thinking)", {}, 7])
    def test_non_list_payloads_select_nothing(self, value: object) -> None:
        assert parse_selected_models(value) == ((), ())


class TestFilterSelection:
    def test_reports_why_each_model_was_dropped(self) -> None:
        catalog = build_catalog(ProviderCredentials(openai_api_key="key"))

        result = filter_selection(
            [Llm.GPT_5_5_HIGH, Llm.CLAUDE_OPUS_5_HIGH],
            catalog,
            unknown_ids=("ghost-model",),
        )

        assert result.models == (Llm.GPT_5_5_HIGH,)
        reasons = {item.id: item.reason for item in result.dropped}
        assert reasons["ghost-model"] == "unknown model"
        assert "Anthropic API key" in reasons[Llm.CLAUDE_OPUS_5_HIGH.value]
        assert result.notice is not None

    def test_a_fully_runnable_selection_has_no_notice(self) -> None:
        catalog = build_catalog(ProviderCredentials(openai_api_key="key"))

        result = filter_selection([Llm.GPT_5_5_HIGH], catalog)

        assert result.dropped == ()
        assert result.notice is None

    def test_deprecated_models_remain_selectable(self) -> None:
        catalog = build_catalog(ProviderCredentials(gemini_api_key="key"))

        result = filter_selection([Llm.GEMINI_3_5_FLASH_HIGH], catalog)

        assert result.models == (Llm.GEMINI_3_5_FLASH_HIGH,)


class TestStaleSelectionIds:
    def test_flags_ids_the_catalog_no_longer_offers(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                openai_api_key="key",
                copilot_available=True,
                copilot_model_ids=("claude-opus-5",),
            )
        )

        stale = stale_selection_ids(
            [
                Llm.GPT_5_5_HIGH.value,
                Llm.CLAUDE_OPUS_5_HIGH.value,
                Llm.COPILOT_CLAUDE_OPUS_5.value,
                Llm.COPILOT_GROK_4_5.value,
                "ghost-model",
            ],
            catalog,
        )

        assert stale == (
            Llm.CLAUDE_OPUS_5_HIGH.value,
            Llm.COPILOT_GROK_4_5.value,
            "ghost-model",
        )

    def test_nothing_is_stale_when_everything_is_offered(self) -> None:
        catalog = build_catalog(ProviderCredentials(openai_api_key="key"))

        assert stale_selection_ids([Llm.GPT_5_5_HIGH.value], catalog) == ()
