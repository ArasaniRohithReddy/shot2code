"""Each model must reach its own provider, and say so when it cannot."""

import pytest

from agent.providers.anthropic import AnthropicProviderSession
from agent.providers.factory import (
    MissingProviderCredentialError,
    create_provider_session,
)
from agent.providers.gemini import GeminiProviderSession
from agent.providers.github_copilot import CopilotProviderSession
from agent.providers.openai import OpenAIProviderSession
from llm import Llm, provider_for_model


def session_for(model: Llm, **overrides: object):
    kwargs: dict[str, object] = {
        "model": model,
        # Anthropic and Gemini read the system prompt off the first message, so
        # a routing probe still needs a minimally shaped conversation.
        "prompt_messages": [
            {"role": "system", "content": "You are a test."},
            {"role": "user", "content": "Build a page."},
        ],
        "should_generate_images": False,
        "openai_api_key": None,
        "openai_base_url": None,
        "anthropic_api_key": None,
        "gemini_api_key": None,
        "replicate_api_key": None,
    }
    kwargs.update(overrides)
    return create_provider_session(**kwargs)  # pyright: ignore[reportArgumentType]


class TestProviderRouting:
    @pytest.mark.parametrize(
        ("model", "credential", "expected"),
        [
            (Llm.GPT_5_6_SOL_HIGH, "openai_api_key", OpenAIProviderSession),
            (Llm.CLAUDE_OPUS_5_MAX, "anthropic_api_key", AnthropicProviderSession),
            (Llm.GEMINI_3_6_FLASH_LOW, "gemini_api_key", GeminiProviderSession),
        ],
    )
    def test_api_key_models_route_to_their_own_provider(
        self, model: Llm, credential: str, expected: type
    ) -> None:
        session = session_for(model, **{credential: "key"})

        assert isinstance(session, expected)

    def test_copilot_models_route_to_the_copilot_session(self) -> None:
        session = session_for(
            Llm.COPILOT_CLAUDE_OPUS_5, copilot_github_token="github_pat_test"
        )

        assert isinstance(session, CopilotProviderSession)

    @pytest.mark.parametrize(
        ("model", "credential"),
        [
            (Llm.GPT_5_6_SOL_HIGH, "openai_api_key"),
            (Llm.CLAUDE_OPUS_5_MAX, "anthropic_api_key"),
            (Llm.GEMINI_3_6_FLASH_LOW, "gemini_api_key"),
        ],
    )
    def test_another_providers_key_does_not_satisfy_a_model(
        self, model: Llm, credential: str
    ) -> None:
        """An OpenAI key must not let a Claude variant start, and vice versa."""
        other_keys = {
            name: "key"
            for name in ("openai_api_key", "anthropic_api_key", "gemini_api_key")
            if name != credential
        }

        with pytest.raises(MissingProviderCredentialError):
            session_for(model, **other_keys)


class TestMissingCredentialErrors:
    @pytest.mark.parametrize(
        ("model", "expected_text"),
        [
            (Llm.GPT_5_6_SOL_HIGH, "OpenAI API key"),
            (Llm.CLAUDE_OPUS_5_MAX, "Anthropic API key"),
            (Llm.GEMINI_3_6_FLASH_LOW, "Gemini API key"),
        ],
    )
    def test_error_names_the_provider_and_the_missing_credential(
        self, model: Llm, expected_text: str
    ) -> None:
        with pytest.raises(MissingProviderCredentialError) as excinfo:
            session_for(model)

        message = str(excinfo.value)
        assert expected_text in message
        assert model.value in message
        assert excinfo.value.provider == provider_for_model(model)

    def test_the_error_never_contains_a_credential(self) -> None:
        with pytest.raises(MissingProviderCredentialError) as excinfo:
            session_for(Llm.CLAUDE_OPUS_5_MAX, openai_api_key="sk-secret-value")

        assert "sk-secret-value" not in str(excinfo.value)
