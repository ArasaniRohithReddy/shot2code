from typing import Any, cast

from prompts.create.image import build_image_prompt_messages
from prompts.message_builder import build_history_message
from prompts.request_parsing import parse_prompt_content


def user_prompt_text(messages: list[dict[str, Any]]) -> str:
    content = messages[1]["content"]
    assert isinstance(content, list)
    text_part = next(part for part in content if part.get("type") == "text")
    return cast(str, text_part["text"])


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

    assert parsed["multi_image_mode"] == "states"


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
    content = message["content"]
    assert isinstance(content, list)
    text_part = next(part for part in content if part.get("type") == "text")
    assert "one page at different responsive sizes" in text_part["text"]
