import json
from typing import Any

import pytest

import routes.ai_review as ai_review
from agent.providers.base import ProviderTurn
from llm import Llm


class StubSession:
    async def stream_turn(self, _on_event: Any) -> ProviderTurn:
        return ProviderTurn(
            assistant_text=json.dumps(
                [
                    {
                        "severity": "warning",
                        "title": "Fixed width",
                        "evidence": "The card uses width: 900px.",
                        "guidance": "Use a fluid max-width.",
                    }
                ]
            ),
            tool_calls=[],
        )

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_ai_review_uses_no_tools_and_returns_bounded_findings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def create_session(**kwargs: Any) -> StubSession:
        captured.update(kwargs)
        return StubSession()

    monkeypatch.setattr(ai_review, "create_provider_session", create_session)
    result = await ai_review.review_with_ai(
        ai_review.AiReviewRequest(
            source="<main style='width:900px'>Hello</main>",
            viewportWidths=[390, 1440],
            model=Llm.GPT_5_4_MINI_LOW.value,
            openAiApiKey="key",
        )
    )

    assert captured["canonical_tools_override"] == []
    assert captured["copilot_web_search_enabled"] is False
    assert captured["copilot_skills_enabled"] is False
    assert result.findings[0].title == "Fixed width"
