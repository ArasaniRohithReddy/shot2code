"""Sanitize hostile SVG before it crosses the local-asset boundary."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from typing import Mapping

from icon_search.config import (
    MAX_SANITIZED_SVG_BYTES,
    MAX_SVG_ATTRIBUTES,
    MAX_SVG_BYTES,
    MAX_SVG_CHARS,
    MAX_SVG_ELEMENTS,
)

SVG_NAMESPACE = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NAMESPACE)

_FORBIDDEN_ELEMENTS = frozenset(
    {
        "a",
        "animate",
        "animatecolor",
        "animatemotion",
        "animatetransform",
        "audio",
        "base",
        "button",
        "canvas",
        "discard",
        "embed",
        "feimage",
        "font-face-uri",
        "foreignobject",
        "form",
        "handler",
        "iframe",
        "image",
        "input",
        "link",
        "metadata",
        "meta",
        "mpath",
        "object",
        "script",
        "select",
        "set",
        "style",
        "textarea",
        "video",
    }
)
_URL_ATTRIBUTES = frozenset(
    {"action", "data", "formaction", "href", "ping", "poster", "src"}
)
_DRAWING_ELEMENTS = frozenset(
    {
        "circle",
        "ellipse",
        "line",
        "path",
        "polygon",
        "polyline",
        "rect",
        "text",
        "tspan",
        "use",
    }
)
_LOCAL_FRAGMENT = re.compile(r"^#[A-Za-z_][A-Za-z0-9_.:-]*$")
_URL_FUNCTION = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)


class SvgRejected(Exception):
    """The SVG was unsafe or malformed, with a safe explanation."""

    def __init__(self, reason: str, code: str = "unsafe_svg") -> None:
        super().__init__(reason)
        self.reason = reason
        self.code = code


def _local_name(name: object) -> str:
    if not isinstance(name, str):
        return ""
    return name.rsplit("}", 1)[-1].split(":", 1)[-1].lower()


def _root_is_svg(root: ET.Element) -> bool:
    if _local_name(root.tag) != "svg":
        return False
    if isinstance(root.tag, str) and root.tag.startswith("{"):
        return root.tag.startswith(f"{{{SVG_NAMESPACE}}}")
    return True


def _only_local_url_functions(value: str) -> bool:
    matches = list(_URL_FUNCTION.finditer(value))
    if not matches:
        return True
    return all(
        _LOCAL_FRAGMENT.fullmatch(match.group(2).strip()) for match in matches
    )


def _sanitize_attributes(element: ET.Element) -> None:
    for raw_name, raw_value in list(element.attrib.items()):
        name = _local_name(raw_name)
        value = str(raw_value).strip()
        lowered = value.lower()
        remove = False

        if name.startswith("on") or name == "style" or name == "base":
            remove = True
        elif name in _URL_ATTRIBUTES:
            remove = name != "href" or not _LOCAL_FRAGMENT.fullmatch(value)
        elif "\\" in value:
            # CSS escapes can spell ``url`` or ``javascript`` without those
            # strings appearing literally. Iconify geometry needs no backslash.
            remove = True
        elif any(
            marker in lowered
            for marker in ("javascript:", "vbscript:", "data:text/html", "@import")
        ):
            remove = True
        elif "url(" in lowered and not _only_local_url_functions(value):
            remove = True

        if remove:
            del element.attrib[raw_name]


def _sanitize_tree(parent: ET.Element) -> None:
    _sanitize_attributes(parent)
    for child in list(parent):
        if _local_name(child.tag) in _FORBIDDEN_ELEMENTS:
            parent.remove(child)
            continue
        _sanitize_tree(child)
        if _local_name(child.tag) == "use" and not any(
            _local_name(name) == "href" for name in child.attrib
        ):
            parent.remove(child)


def _enforce_complexity(root: ET.Element) -> None:
    elements = 0
    attributes = 0
    for element in root.iter():
        elements += 1
        attributes += len(element.attrib)
        if elements > MAX_SVG_ELEMENTS or attributes > MAX_SVG_ATTRIBUTES:
            raise SvgRejected("the SVG is too structurally complex", "too_complex")


def _has_drawing(root: ET.Element) -> bool:
    return any(
        _local_name(element.tag) in _DRAWING_ELEMENTS for element in root.iter()
    )


def sanitize_svg(raw: bytes, provenance: Mapping[str, object]) -> bytes:
    """Return a bounded, inert SVG with an embedded provenance notice."""

    if not raw:
        raise SvgRejected("the SVG was empty", "empty")
    if len(raw) > MAX_SVG_BYTES:
        raise SvgRejected("the SVG exceeds the byte limit", "too_large")
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as error:
        raise SvgRejected("the SVG is not valid UTF-8", "bad_encoding") from error
    if len(text) > MAX_SVG_CHARS:
        raise SvgRejected("the decoded SVG exceeds the size limit", "too_large")

    lowered = text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise SvgRejected("SVG document types and entities are not allowed", "xml_entity")
    if "<?xml-stylesheet" in lowered:
        raise SvgRejected("external XML stylesheets are not allowed", "active_content")
    without_declaration = re.sub(
        r"^\s*<\?xml[^?]*\?>", "", text, count=1, flags=re.IGNORECASE
    )
    if "<?" in without_declaration:
        raise SvgRejected("SVG processing instructions are not allowed", "active_content")

    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise SvgRejected("the SVG XML could not be parsed", "bad_svg") from error
    if not _root_is_svg(root):
        raise SvgRejected("the downloaded document is not an SVG", "bad_svg")

    _enforce_complexity(root)
    _sanitize_tree(root)
    _enforce_complexity(root)
    if not _has_drawing(root):
        raise SvgRejected("the SVG contains no usable vector drawing", "empty_svg")

    notice = {
        key: provenance[key]
        for key in (
            "author",
            "author_url",
            "collection",
            "collection_prefix",
            "icon",
            "license_name",
            "license_notice",
            "license_spdx",
            "license_url",
            "retrieved_at",
            "source_url",
        )
        if key in provenance and provenance[key] not in (None, "")
    }
    metadata = ET.Element(f"{{{SVG_NAMESPACE}}}metadata")
    metadata.set("id", "shot2code-iconify-provenance")
    metadata.text = json.dumps(
        notice, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    )
    root.insert(0, metadata)
    human_notice = provenance.get("license_notice")
    if isinstance(human_notice, str) and human_notice.strip():
        description = ET.Element(f"{{{SVG_NAMESPACE}}}desc")
        description.set("id", "shot2code-iconify-license-notice")
        description.text = human_notice.strip()
        root.insert(1, description)

    sanitized = ET.tostring(root, encoding="utf-8", short_empty_elements=True)
    if len(sanitized) > MAX_SANITIZED_SVG_BYTES:
        raise SvgRejected("the sanitized SVG exceeds the size limit", "too_large")
    return sanitized


__all__ = ["SVG_NAMESPACE", "SvgRejected", "sanitize_svg"]
