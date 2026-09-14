from unittest.mock import AsyncMock

import pytest

from llm import Llm
from routes.generate_code import ParameterExtractionStage


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("request_value", "expected"),
    [(None, True), (False, False), (True, True)],
)
async def test_asset_extraction_preference_defaults_on_and_supports_opt_out(
    request_value: bool | None, expected: bool
) -> None:
    stage = ParameterExtractionStage(AsyncMock())
    params: dict[str, object] = {
        "generatedCodeConfig": "html_tailwind",
        "inputMode": "text",
        "prompt": {"text": "hello"},
    }
    if request_value is not None:
        params["isAssetExtractionEnabled"] = request_value

    extracted = await stage.extract_and_validate(params)

    assert extracted.should_extract_assets is expected


@pytest.mark.asyncio
async def test_extracts_gemini_api_key_from_settings_dialog() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "openAiApiKey": "",
            "anthropicApiKey": "",
            "geminiApiKey": "gemini-from-ui",
            "prompt": {"text": "hello"},
        }
    )

    assert extracted.gemini_api_key == "gemini-from-ui"


@pytest.mark.asyncio
async def test_extracts_gemini_api_key_from_env_when_not_in_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("routes.generate_code.GEMINI_API_KEY", "gemini-from-env")
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
        }
    )

    assert extracted.gemini_api_key == "gemini-from-env"


@pytest.mark.asyncio
async def test_extracts_replicate_api_key_from_settings_dialog() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "replicateApiKey": "replicate-from-ui",
            "prompt": {"text": "hello"},
        }
    )

    assert extracted.replicate_api_key == "replicate-from-ui"


@pytest.mark.asyncio
async def test_extracts_replicate_api_key_from_env_when_not_in_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("routes.generate_code.REPLICATE_API_KEY", "replicate-from-env")
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
        }
    )

    assert extracted.replicate_api_key == "replicate-from-env"


@pytest.mark.asyncio
async def test_extracts_design_system_from_request() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_css",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "designSystem": "  Reuse .mockup-frame  ",
        }
    )

    assert extracted.design_system == "Reuse .mockup-frame"


@pytest.mark.asyncio
async def test_extracts_retry_models_in_order_and_drops_unknown_values() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "retryModels": [
                Llm.GPT_5_6_SOL_HIGH.value,
                "removed-model",
                Llm.CLAUDE_OPUS_5_HIGH.value,
            ],
        }
    )

    assert extracted.retry_models == [
        Llm.GPT_5_6_SOL_HIGH,
        Llm.CLAUDE_OPUS_5_HIGH,
    ]


@pytest.mark.asyncio
async def test_extracts_selected_models_across_providers() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "selectedModels": [
                Llm.GPT_5_6_SOL_HIGH.value,
                Llm.CLAUDE_OPUS_5_MAX.value,
                Llm.GEMINI_3_6_FLASH_LOW.value,
                Llm.COPILOT_GPT_5_6_SOL.value,
            ],
        }
    )

    assert extracted.selected_models == [
        Llm.GPT_5_6_SOL_HIGH,
        Llm.CLAUDE_OPUS_5_MAX,
        Llm.GEMINI_3_6_FLASH_LOW,
        Llm.COPILOT_GPT_5_6_SOL,
    ]
    assert extracted.unknown_selected_models == []


@pytest.mark.asyncio
async def test_selected_models_keeps_unknown_ids_for_reporting() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "selectedModels": [
                Llm.GPT_5_5_HIGH.value,
                "gpt-9000 (max thinking)",
                "",
                17,
                Llm.GPT_5_5_HIGH.value,
            ],
        }
    )

    assert extracted.selected_models == [Llm.GPT_5_5_HIGH]
    assert extracted.unknown_selected_models == ["gpt-9000 (max thinking)"]


@pytest.mark.asyncio
async def test_legacy_copilot_models_field_still_selects_models() -> None:
    """Clients saved before the picker covered every provider send this name."""
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "copilotModels": [Llm.COPILOT_CLAUDE_OPUS_5.value],
        }
    )

    assert extracted.selected_models == [Llm.COPILOT_CLAUDE_OPUS_5]


@pytest.mark.asyncio
async def test_selected_models_wins_over_the_legacy_field() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "selectedModels": [Llm.GPT_5_5_HIGH.value],
            "copilotModels": [Llm.COPILOT_CLAUDE_OPUS_5.value],
        }
    )

    assert extracted.selected_models == [Llm.GPT_5_5_HIGH]


@pytest.mark.asyncio
async def test_no_selection_means_automatic() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
        }
    )

    assert extracted.selected_models == []
    assert extracted.unknown_selected_models == []
