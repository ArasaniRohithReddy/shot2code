from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import re
from typing import cast

from PIL import Image

MAX_RUNTIME_ERRORS = 5
MAX_RUNTIME_ERROR_CHARS = 240
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class ScreenshotEvidence:
    image: bytes
    nearly_blank: bool = False
    body_text_chars: int = 0
    rendered_elements: int = 0
    console_errors: tuple[str, ...] = ()
    page_errors: tuple[str, ...] = ()


def png_is_nearly_blank(data: bytes) -> bool:
    try:
        with Image.open(BytesIO(data)) as image:
            sample = image.convert("RGB")
            sample.thumbnail((64, 64))
            extrema = cast(tuple[tuple[int, int], ...], sample.getextrema())
            return all(high - low <= 8 for low, high in extrema)
    except (OSError, ValueError):
        return False


def sanitize_runtime_message(value: object) -> str:
    text = _SPACE.sub(" ", str(value)).strip()
    if len(text) <= MAX_RUNTIME_ERROR_CHARS:
        return text
    return text[: MAX_RUNTIME_ERROR_CHARS - 1].rstrip() + "…"


def bounded_runtime_messages(values: list[str]) -> tuple[str, ...]:
    unique: list[str] = []
    for value in values:
        sanitized = sanitize_runtime_message(value)
        if sanitized and sanitized not in unique:
            unique.append(sanitized)
        if len(unique) >= MAX_RUNTIME_ERRORS:
            break
    return tuple(unique)
