from typing import Any, cast

from prompts.create.image import build_image_prompt_messages
from prompts.message_builder import build_history_message
from prompts.request_parsing import parse_prompt_content


def user_prompt_text(messages: list[dict[str, Any]]) -> str:
    return content_text(messages[1].get("content"))


def content_text(content: object) -> str:
    assert isinstance(content, list)
    for raw_part in cast(list[object], content):
        if not isinstance(raw_part, dict):
            continue
        part = cast(dict[str, object], raw_part)
        if part.get("type") != "text":
            continue
        text = part.get("text")
        assert isinstance(text, str)
        return text
    raise AssertionError("Expected a text content part")


def test_multiple_screenshots_default_to_distinct_pages() -> None:
    messages = cast(
        list[dict[str, Any]],
        build_image_prompt_messages(
            image_data_urls=["data:image/png;base64,one", "data:image/png;base64,two"],
            stack="html_tailwind",
            text_prompt="",
            image_generation_enabled=False,
        ),
    )

    prompt = user_prompt_text(messages)
    assert "2 screenshots are distinct pages or views" in prompt
    assert "exactly 2 distinct views" in prompt
    assert "do not omit any screenshot" in prompt


def test_responsive_mode_requests_one_page() -> None:
    messages = cast(
        list[dict[str, Any]],
        build_image_prompt_messages(
            image_data_urls=["data:image/png;base64,desktop", "data:image/png;base64,mobile"],
            stack="html_css",
            text_prompt="",
            image_generation_enabled=False,
            multi_image_mode="responsive",
        ),
    )

    prompt = user_prompt_text(messages)
    assert "same page at different viewport sizes" in prompt
    assert "Build one responsive page, not duplicate pages" in prompt


def test_parser_accepts_multi_image_mode_from_frontend() -> None:
    parsed = parse_prompt_content(
        {
            "text": "",
            "images": ["one", "two"],
            "videos": [],
            "multiImageMode": "states",
        }
    )

    assert parsed.get("multi_image_mode") == "states"


def test_history_preserves_multi_screenshot_relationship() -> None:
    message = build_history_message(
        {
            "role": "user",
            "text": "Match these screens",
            "images": ["desktop", "mobile"],
            "videos": [],
            "multi_image_mode": "responsive",
        }
    )
    assert "one page at different responsive sizes" in content_text(
        message.get("content")
    )
