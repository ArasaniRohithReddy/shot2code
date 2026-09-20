"""One classifier, one answer: which kind of provider problem this is.

The categories drive what the UI tells a user to do, so each family of failure
is pinned here - especially the OpenAI "no credits remaining" APIError, which
must read as a billing problem rather than a mystery.
"""

import asyncio

import pytest

from provider_errors import (
    ProviderErrorInfo,
    classify_error_text,
    classify_provider_error,
    redact_secrets,
)


class FakeStatusError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class APIError(Exception):
    """Shaped like openai.APIError for classification purposes."""


class TestBilling:
    def test_the_observed_openai_no_credits_error_is_billing(self) -> None:
        error = APIError(
            "You have no credits remaining. Please add credits at "
            "https://platform.openai.com/settings/organization/billing"
        )

        info = classify_provider_error(error, "openai")

        assert info.category == "billing"
        assert "credit" in info.message.lower()
        assert "add credits" in info.message.lower()

    @pytest.mark.parametrize(
        "message",
        [
            "Your credit balance is too low to access the Anthropic API",
            "insufficient_quota: You exceeded your current quota, please check "
            "your plan and billing details.",
            "Payment required",
            "Please purchase more credits to continue",
        ],
    )
    def test_billing_wording_beats_quota_wording(self, message: str) -> None:
        assert classify_error_text(message) == "billing"

    def test_a_402_is_billing(self) -> None:
        info = classify_provider_error(
            FakeStatusError("Payment issue", 402), "anthropic"
        )

        assert info.category == "billing"


class TestOtherCategories:
    @pytest.mark.parametrize(
        ("message", "expected"),
        [
            ("Incorrect API key provided", "credentials"),
            ("invalid x-api-key", "credentials"),
            ("API key not valid. Please pass a valid API key.", "credentials"),
            ("Rate limit reached for gpt-5.5", "quota"),
            ("RESOURCE_EXHAUSTED: too many requests", "quota"),
            ("The model `gpt-9000` does not exist", "model"),
            ("model_not_found", "model"),
            ("Your organization must be verified to use this model", "permissions"),
            ("Connection error while contacting the endpoint", "network"),
            ("Request timed out", "network"),
        ],
    )
    def test_representative_provider_messages(
        self, message: str, expected: str
    ) -> None:
        assert classify_error_text(message) == expected

    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (401, "credentials"),
            (403, "permissions"),
            (404, "model"),
            (429, "quota"),
        ],
    )
    def test_status_codes_classify_when_wording_does_not(
        self, status: int, expected: str
    ) -> None:
        info = classify_provider_error(FakeStatusError("Request failed", status))

        assert info.category == expected

    def test_transport_exception_types_are_network(self) -> None:
        class APIConnectionError(Exception):
            pass

        assert classify_provider_error(APIConnectionError("boom")).category == "network"
        assert classify_provider_error(asyncio.TimeoutError()).category == "network"

    def test_an_unrecognised_error_is_unknown_not_a_guess(self) -> None:
        info = classify_provider_error(Exception("something odd happened"), "gemini")

        assert info.category == "unknown"
        assert "Google Gemini" in info.message


class TestMessagesAreActionable:
    @pytest.mark.parametrize(
        ("message", "needle"),
        [
            ("Incorrect API key provided", "API key in Settings"),
            ("You have no credits remaining", "Add credits"),
            ("Rate limit reached", "Wait for the limit"),
            ("The model does not exist", "different model"),
            ("Connection error", "network connection"),
        ],
    )
    def test_each_category_tells_the_user_what_to_change(
        self, message: str, needle: str
    ) -> None:
        info = classify_provider_error(Exception(message), "openai")

        assert needle in info.message

    def test_the_provider_is_named(self) -> None:
        info = classify_provider_error(Exception("Rate limit reached"), "anthropic")

        assert info.message.startswith("Anthropic")

    def test_byok_is_named_as_its_own_runtime(self) -> None:
        info = classify_provider_error(Exception("Unauthorized"), "copilot-byok")

        assert "Copilot SDK BYOK" in info.message

    def test_long_provider_detail_is_bounded(self) -> None:
        info = classify_provider_error(Exception("x" * 5000), "openai")

        assert len(info.message) < 1000


class TestRedaction:
    @pytest.mark.parametrize(
        "secret",
        [
            "sk-proj-abc123def456ghi789",
            "sk-ant-api03-abcdefghijklmnop",
            "r8_abcdefghijklmnopqrst",
            "github_pat_11ABCDEFG0abcdefghij",
            "ghp_abcdefghijklmnopqrst",
            "AIzaSyABCDEFGHIJKLMNOPQRSTUV",
        ],
    )
    def test_vendor_keys_are_masked(self, secret: str) -> None:
        redacted = redact_secrets(f"Incorrect API key provided: {secret}.")

        assert secret not in redacted
        assert "[redacted]" in redacted

    def test_authorization_headers_are_masked(self) -> None:
        redacted = redact_secrets(
            "request failed: {'Authorization': 'Bearer abcdef123456', "
            "'x-api-key': 'topsecretvalue'}"
        )

        assert "abcdef123456" not in redacted
        assert "topsecretvalue" not in redacted

    def test_credentials_in_a_url_are_masked(self) -> None:
        redacted = redact_secrets("could not reach https://user:hunter2@api.example.com")

        assert "hunter2" not in redacted

    def test_a_classified_message_never_carries_the_secret(self) -> None:
        error = Exception(
            "Incorrect API key provided: sk-proj-supersecretvalue1234. "
            "You can find your API key at https://platform.openai.com/account/api-keys"
        )

        info = classify_provider_error(error, "openai")

        assert "sk-proj-supersecretvalue1234" not in info.message
        assert "sk-proj-supersecretvalue1234" not in info.detail

    def test_redacting_empty_text_is_safe(self) -> None:
        assert redact_secrets("") == ""


class TestReadyCategory:
    def test_ready_is_only_ever_constructed_explicitly(self) -> None:
        info = ProviderErrorInfo(category="ready", message="fine")

        assert info.is_ready is True
        assert classify_provider_error(Exception("boom")).is_ready is False
