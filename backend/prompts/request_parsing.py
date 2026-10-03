from typing import List, cast

from prompts.prompt_types import (
    DesignSource,
    DesignSourceAsset,
    MultiImageMode,
    PromptHistoryMessage,
    UserTurnInput,
)


MAX_DESIGN_SOURCE_ASSETS = 40
MAX_DESIGN_ASSET_NAME_CHARS = 120
MAX_DESIGN_ASSET_KIND_CHARS = 80
MAX_DESIGN_ASSET_MIME_CHARS = 100


def _to_string_list(value: object) -> List[str]:
    if not isinstance(value, list):
        return []
    raw_list = cast(List[object], value)
    return [item for item in raw_list if isinstance(item, str)]


def _clean_text(value: object, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > max_chars:
        return None
    return text


def _parse_source_assets(value: object) -> List[DesignSourceAsset]:
    if not isinstance(value, list):
        return []
    parsed: List[DesignSourceAsset] = []
    for raw in cast(List[object], value)[:MAX_DESIGN_SOURCE_ASSETS]:
        if not isinstance(raw, dict):
            continue
        record = cast(dict[str, object], raw)
        name = _clean_text(record.get("name"), MAX_DESIGN_ASSET_NAME_CHARS)
        url = _clean_text(record.get("url"), 2048)
        mime_type = _clean_text(
            record.get("mimeType"), MAX_DESIGN_ASSET_MIME_CHARS
        )
        source = record.get("source")
        kind = _clean_text(record.get("kind"), MAX_DESIGN_ASSET_KIND_CHARS)
        if (
            name is None
            or url is None
            or mime_type is None
            or source not in ("figma", "github", "stitch")
            or kind is None
        ):
            continue
        parsed.append(
            {
                "name": name,
                "url": url,
                "mime_type": mime_type,
                "source": cast(DesignSource, source),
                "kind": kind,
            }
        )
    return parsed


def parse_prompt_content(raw_prompt: object) -> UserTurnInput:
    if not isinstance(raw_prompt, dict):
        return {"text": "", "images": [], "videos": []}

    prompt_dict = cast(dict[str, object], raw_prompt)
    text = prompt_dict.get("text")
    parsed: UserTurnInput = {
        "text": text if isinstance(text, str) else "",
        "images": _to_string_list(prompt_dict.get("images")),
        "videos": _to_string_list(prompt_dict.get("videos")),
    }

    full_text = prompt_dict.get("fullText")
    if isinstance(full_text, str) and full_text.strip():
        parsed["full_text"] = full_text

    raw_multi_image_mode = prompt_dict.get("multiImageMode")
    if raw_multi_image_mode in ("pages", "responsive", "states", "references"):
        parsed["multi_image_mode"] = cast(MultiImageMode, raw_multi_image_mode)

    source_assets = _parse_source_assets(prompt_dict.get("sourceAssets"))
    if source_assets:
        parsed["source_assets"] = source_assets

    return parsed


def parse_prompt_history(raw_history: object) -> List[PromptHistoryMessage]:
    if not isinstance(raw_history, list):
        return []

    history: List[PromptHistoryMessage] = []
    raw_items = cast(List[object], raw_history)
    for item in raw_items:
        if not isinstance(item, dict):
            continue

        item_dict = cast(dict[str, object], item)
        role_value = item_dict.get("role")
        if not isinstance(role_value, str) or role_value not in ("user", "assistant"):
            continue

        text = item_dict.get("text")
        history_item: PromptHistoryMessage = {
            "role": role_value,
            "text": text if isinstance(text, str) else "",
            "images": _to_string_list(item_dict.get("images")),
            "videos": _to_string_list(item_dict.get("videos")),
        }
        if item_dict.get("multiImageMode") in (
            "pages",
            "responsive",
            "states",
            "references",
        ):
            history_item["multi_image_mode"] = cast(
                MultiImageMode, item_dict["multiImageMode"]
            )
        history.append(history_item)

    return history
