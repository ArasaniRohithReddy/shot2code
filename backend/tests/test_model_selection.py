import pytest
from unittest.mock import AsyncMock

from llm import Llm
from model_catalog import ProviderCredentials, build_catalog
from routes.generate_code import ModelSelectionStage, variant_limit


def selector() -> ModelSelectionStage:
    return ModelSelectionStage(AsyncMock())


class TestModelSelectionAllKeys:
    """Model selection when Gemini, Anthropic, and OpenAI API keys are present."""

    def setup_method(self):
        self.model_selector = selector()

    @pytest.mark.asyncio
    async def test_gemini_anthropic_create(self):
        """All keys text create: fixed order for four variants."""
        selection = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        assert selection.models == [
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GPT_5_6_SOL_HIGH,
            Llm.CLAUDE_OPUS_5_HIGH,
            Llm.GEMINI_3_1_PRO_PREVIEW_LOW,
        ]
        assert selection.notices == []

    @pytest.mark.asyncio
    async def test_gemini_anthropic_create_image(self):
        """All keys image create: fixed order for four variants."""
        selection = await self.model_selector.select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        assert selection.models == [
            Llm.CLAUDE_OPUS_5_MEDIUM,
            Llm.GEMINI_3_FLASH_PREVIEW_HIGH,
            Llm.GEMINI_3_1_PRO_PREVIEW_HIGH,
            Llm.GPT_5_6_SOL_MAX,
        ]

    @pytest.mark.asyncio
    async def test_gemini_anthropic_update_text(self):
        """All keys text update: uses two fast edit variants."""
        selection = await self.model_selector.select_models(
            generation_type="update",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        assert selection.models == [
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GPT_5_6_TERRA_LOW,
        ]

    @pytest.mark.asyncio
    async def test_gemini_anthropic_update(self):
        """All keys image update: uses two fast edit variants."""
        selection = await self.model_selector.select_models(
            generation_type="update",
            input_mode="image",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        assert selection.models == [
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GPT_5_6_TERRA_LOW,
        ]

    @pytest.mark.asyncio
    async def test_video_create_prefers_gemini_minimal_then_3_1_high(self):
        """Video create always uses two Gemini variants in fixed order."""
        selection = await self.model_selector.select_models(
            generation_type="create",
            input_mode="video",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        assert selection.models == [
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GEMINI_3_1_PRO_PREVIEW_HIGH,
        ]

    @pytest.mark.asyncio
    async def test_video_update_prefers_gemini_minimal_then_3_1_high(self):
        """Video update always uses the same two Gemini variants as video create."""
        selection = await self.model_selector.select_models(
            generation_type="update",
            input_mode="video",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        assert selection.models == [
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GEMINI_3_1_PRO_PREVIEW_HIGH,
        ]


class TestModelSelectionOpenAIAnthropic:
    """Model selection when only OpenAI and Anthropic keys are present."""

    def setup_method(self):
        self.model_selector = selector()

    @pytest.mark.asyncio
    async def test_openai_anthropic(self):
        """OpenAI + Anthropic: Claude Opus 4.8 medium, GPT 5.5 high, GPT 5.5 low, cycling"""
        selection = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key=None,
        )

        assert selection.models == [
            Llm.CLAUDE_OPUS_4_8_MEDIUM,
            Llm.GPT_5_5_HIGH,
            Llm.GPT_5_5_LOW,
            Llm.CLAUDE_OPUS_4_8_MEDIUM,
        ]


class TestModelSelectionAnthropicOnly:
    """Model selection when only the Anthropic key is present."""

    def setup_method(self):
        self.model_selector = selector()

    @pytest.mark.asyncio
    async def test_anthropic_only(self):
        """Anthropic only: Claude Opus 4.8 medium and Claude Sonnet 4.6 cycling"""
        selection = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key=None,
            anthropic_api_key="key",
            gemini_api_key=None,
        )

        assert selection.models == [
            Llm.CLAUDE_OPUS_4_8_MEDIUM,
            Llm.CLAUDE_SONNET_4_6,
            Llm.CLAUDE_OPUS_4_8_MEDIUM,
            Llm.CLAUDE_SONNET_4_6,
        ]


class TestModelSelectionOpenAIOnly:
    """Model selection when only the OpenAI key is present."""

    def setup_method(self):
        self.model_selector = selector()

    @pytest.mark.asyncio
    async def test_openai_only(self):
        """OpenAI only: GPT 5.5 high and low, cycling"""
        selection = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key=None,
            gemini_api_key=None,
        )

        assert selection.models == [
            Llm.GPT_5_5_HIGH,
            Llm.GPT_5_5_LOW,
            Llm.GPT_5_5_HIGH,
            Llm.GPT_5_5_LOW,
        ]


class TestRetryModelSelection:
    """Retry requests reuse the exact original variant lineup."""

    @pytest.mark.asyncio
    async def test_retry_models_override_current_key_based_selection(self):
        retry_models = [
            Llm.GPT_5_6_SOL_HIGH,
            Llm.CLAUDE_OPUS_5_HIGH,
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
        ]

        selection = await selector().select_models(
            generation_type="update",
            input_mode="image",
            openai_api_key=None,
            anthropic_api_key=None,
            gemini_api_key=None,
            retry_models=retry_models,
        )

        assert selection.models == retry_models
        assert selection.notices == []

    @pytest.mark.asyncio
    async def test_retry_is_not_capped_by_the_update_variant_limit(self):
        """A four-option run retried as-is keeps all four options."""
        retry_models = [
            Llm.GPT_5_6_SOL_HIGH,
            Llm.CLAUDE_OPUS_5_HIGH,
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GEMINI_3_1_PRO_PREVIEW_HIGH,
        ]

        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            retry_models=retry_models,
        )

        assert selection.models == retry_models


class TestExplicitSelection:
    """An explicit pick produces exactly one variant per model."""

    @pytest.mark.asyncio
    async def test_one_variant_per_selected_model(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="key",
            gemini_api_key="key",
            selected_models=[Llm.GPT_5_6_SOL_HIGH, Llm.GEMINI_3_6_FLASH_LOW],
        )

        assert selection.models == [
            Llm.GPT_5_6_SOL_HIGH,
            Llm.GEMINI_3_6_FLASH_LOW,
        ]

    @pytest.mark.asyncio
    async def test_single_pick_produces_a_single_variant(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            anthropic_api_key="key",
            selected_models=[Llm.CLAUDE_OPUS_5_MAX],
        )

        assert selection.models == [Llm.CLAUDE_OPUS_5_MAX]

    @pytest.mark.asyncio
    async def test_selection_is_capped_by_the_variant_limit(self):
        picks = [
            Llm.GPT_5_5_LOW,
            Llm.GPT_5_5_MEDIUM,
            Llm.GPT_5_5_HIGH,
            Llm.GPT_5_5_XHIGH,
            Llm.GPT_5_6_SOL_LOW,
        ]

        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="key",
            selected_models=picks,
        )

        assert selection.models == picks[: variant_limit("create", "image")]

    @pytest.mark.asyncio
    async def test_update_selection_is_capped_at_two(self):
        picks = [
            Llm.GPT_5_5_LOW,
            Llm.GPT_5_5_MEDIUM,
            Llm.GPT_5_5_HIGH,
        ]

        selection = await selector().select_models(
            generation_type="update",
            input_mode="image",
            openai_api_key="key",
            selected_models=picks,
        )

        assert selection.models == picks[:2]

    @pytest.mark.asyncio
    async def test_mixed_provider_selection_runs_each_provider(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
            copilot_available=True,
            copilot_model_ids=("claude-opus-5",),
            selected_models=[
                Llm.GPT_5_6_SOL_HIGH,
                Llm.CLAUDE_OPUS_5_HIGH,
                Llm.GEMINI_3_6_FLASH_HIGH,
                Llm.COPILOT_CLAUDE_OPUS_5,
            ],
        )

        assert selection.models == [
            Llm.GPT_5_6_SOL_HIGH,
            Llm.CLAUDE_OPUS_5_HIGH,
            Llm.GEMINI_3_6_FLASH_HIGH,
            Llm.COPILOT_CLAUDE_OPUS_5,
        ]


class TestStaleSelectionFiltering:
    """Picks that can no longer run are dropped with an explicit reason."""

    @pytest.mark.asyncio
    async def test_model_without_provider_credentials_is_dropped(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="key",
            selected_models=[Llm.GPT_5_6_SOL_HIGH, Llm.CLAUDE_OPUS_5_HIGH],
        )

        assert selection.models == [Llm.GPT_5_6_SOL_HIGH]
        assert selection.dropped == [Llm.CLAUDE_OPUS_5_HIGH.value]
        assert "Anthropic API key" in " ".join(selection.notices)

    @pytest.mark.asyncio
    async def test_copilot_model_missing_from_the_plan_is_dropped(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            copilot_available=True,
            copilot_model_ids=("claude-opus-5",),
            selected_models=[Llm.COPILOT_CLAUDE_OPUS_5, Llm.COPILOT_GROK_4_6],
        )

        assert selection.models == [Llm.COPILOT_CLAUDE_OPUS_5]
        assert selection.dropped == [Llm.COPILOT_GROK_4_6.value]
        assert "no longer offered" in " ".join(selection.notices)

    @pytest.mark.asyncio
    async def test_unknown_model_ids_are_reported_not_silently_ignored(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="key",
            selected_models=[Llm.GPT_5_5_HIGH],
            unknown_selected_models=["gpt-9000 (max thinking)"],
        )

        assert selection.models == [Llm.GPT_5_5_HIGH]
        assert selection.dropped == ["gpt-9000 (max thinking)"]
        assert "unknown model" in " ".join(selection.notices)

    @pytest.mark.asyncio
    async def test_video_drops_models_that_cannot_read_video(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="video",
            openai_api_key="key",
            gemini_api_key="key",
            selected_models=[Llm.GPT_5_6_SOL_HIGH, Llm.GEMINI_3_1_PRO_PREVIEW_HIGH],
        )

        assert selection.models == [Llm.GEMINI_3_1_PRO_PREVIEW_HIGH]
        assert "cannot read video" in " ".join(selection.notices)

    @pytest.mark.asyncio
    async def test_all_picks_stale_falls_back_to_automatic_with_a_notice(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="key",
            selected_models=[Llm.CLAUDE_OPUS_5_HIGH],
        )

        assert selection.models == [
            Llm.GPT_5_5_HIGH,
            Llm.GPT_5_5_LOW,
            Llm.GPT_5_5_HIGH,
            Llm.GPT_5_5_LOW,
        ]
        assert "Fell back to automatic model selection." in selection.notices

    @pytest.mark.asyncio
    async def test_all_picks_stale_and_no_credentials_errors_explicitly(self):
        throw_error = AsyncMock()
        stage = ModelSelectionStage(throw_error)

        with pytest.raises(Exception, match="No API key"):
            await stage.select_models(
                generation_type="create",
                input_mode="text",
                selected_models=[Llm.CLAUDE_OPUS_5_HIGH],
            )

        message = throw_error.await_args.args[0] if throw_error.await_args else ""
        assert "Anthropic API key" in message
        assert "GitHub Copilot credentials" in message


class TestCopilotAutoSelection:
    """With no keys at all the run uses whatever the Copilot plan offers."""

    @pytest.mark.asyncio
    async def test_prefers_the_curated_copilot_lineup(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            copilot_available=True,
            copilot_model_ids=(
                "grok-4.6",
                "claude-sonnet-4.6",
                "gpt-5.6-sol",
                "claude-opus-5",
            ),
        )

        assert selection.models == [
            Llm.COPILOT_CLAUDE_OPUS_5,
            Llm.COPILOT_GPT_5_6_SOL,
            Llm.COPILOT_CLAUDE_SONNET_4_6,
            Llm.COPILOT_GROK_4_6,
        ]

    @pytest.mark.asyncio
    async def test_video_falls_back_to_copilot_without_a_gemini_key(self):
        selection = await selector().select_models(
            generation_type="create",
            input_mode="video",
            copilot_available=True,
            copilot_model_ids=("claude-opus-5", "gpt-5.6-sol"),
        )

        assert selection.models == [
            Llm.COPILOT_CLAUDE_OPUS_5,
            Llm.COPILOT_GPT_5_6_SOL,
        ]

    @pytest.mark.asyncio
    async def test_video_without_gemini_or_copilot_errors_explicitly(self):
        throw_error = AsyncMock()
        stage = ModelSelectionStage(throw_error)

        with pytest.raises(Exception, match="No API key"):
            await stage.select_models(
                generation_type="create",
                input_mode="video",
                openai_api_key="key",
            )

        message = throw_error.await_args.args[0] if throw_error.await_args else ""
        assert "Video needs a Gemini API key" in message


class TestModelSelectionNoKeys:
    """Model selection when no credentials at all are present."""

    def setup_method(self):
        self.model_selector = selector()

    @pytest.mark.asyncio
    async def test_no_keys_raises_error(self):
        with pytest.raises(Exception, match="No API key"):
            await self.model_selector.select_models(
                generation_type="create",
                input_mode="text",
                openai_api_key=None,
                anthropic_api_key=None,
                gemini_api_key=None,
            )


class TestVariantLimits:
    def test_limits_match_the_configured_variant_counts(self):
        assert variant_limit("create", "image") == 4
        assert variant_limit("create", "text") == 4
        assert variant_limit("update", "image") == 2
        assert variant_limit("create", "video") == 2
        assert variant_limit("update", "video") == 2


class TestSelectionUsesTheSuppliedCatalog:
    @pytest.mark.asyncio
    async def test_catalog_argument_overrides_credential_arguments(self):
        catalog = build_catalog(ProviderCredentials(gemini_api_key="key"))

        selection = await selector().select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="ignored-because-catalog-wins",
            selected_models=[Llm.GEMINI_3_6_FLASH_HIGH],
            catalog=catalog,
        )

        assert selection.models == [Llm.GEMINI_3_6_FLASH_HIGH]
