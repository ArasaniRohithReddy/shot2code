"""The canonical, provider-neutral ``search_icons`` tool."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict

import httpx

from icon_search.config import (
    DEFAULT_ICONS,
    EGRESS_NOTICE,
    IconSearchSettings,
    MAX_ICON_DOWNLOAD_ATTEMPTS,
    MAX_ICONS,
    MAX_QUERY_CHARS,
    MAX_SEARCHES_PER_GENERATION,
    MAX_SEARCHES_PER_TURN,
    MIN_ICONS,
    MIN_QUERY_CHARS,
    PERMISSIVE_LICENSES,
    THIRD_PARTY_METADATA_WARNING,
    TRADEMARK_WARNING,
)
from icon_search.iconify import (
    IconCandidate,
    IconifyError,
    create_iconify_client,
    fetch_icon_svg,
    search_icon_candidates,
)
from icon_search.sanitize import SvgRejected, sanitize_svg

ICON_SEARCH_TOOL_NAME = "search_icons"

ICON_SEARCH_TOOL_DESCRIPTION = (
    "Find interface icons through Iconify, sanitize the SVGs and save them as "
    "local project assets. Use the returned local URLs directly in HTML/CSS; "
    "never hotlink api.iconify.design and never add @iconify/react. Automatic "
    "results are restricted to a permissive SPDX allowlist, and each saved SVG "
    "contains source, author, licence and retrieval-date provenance. Keep that "
    "notice with the asset. Brand icons can still be trademarks, so use them "
    "only when the design clearly calls for that brand and preserve the warning. "
    f"Ask for {MIN_ICONS}-{MAX_ICONS} icons with one short visual/semantic query. "
    f"At most {MAX_SEARCHES_PER_TURN} searches per turn and "
    f"{MAX_SEARCHES_PER_GENERATION} per generation."
)

_UNSAFE_FILENAME = re.compile(r"[^a-z0-9-]+")


def icon_search_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "A short semantic or visual icon query such as 'home', "
                    "'upload cloud' or 'rounded warning'. "
                    f"{MIN_QUERY_CHARS}-{MAX_QUERY_CHARS} characters; never "
                    "include credentials, source code or page content."
                ),
            },
            "count": {
                "type": "integer",
                "minimum": MIN_ICONS,
                "maximum": MAX_ICONS,
                "default": DEFAULT_ICONS,
                "description": (
                    f"How many sanitized local icons to keep, {MIN_ICONS}-{MAX_ICONS}."
                ),
            },
        },
        "required": ["query"],
    }


@dataclass(frozen=True)
class IconSearchToolDefinition:
    name: str
    description: str
    parameters: Dict[str, Any]


@dataclass(frozen=True)
class LocalIconAsset:
    filename_stem: str
    data: bytes


@dataclass(frozen=True)
class IconSearchToolOutcome:
    ok: bool
    result: Dict[str, Any]
    summary: Dict[str, Any]
    assets: tuple[LocalIconAsset, ...] = ()


def icon_search_tool_definition() -> IconSearchToolDefinition:
    return IconSearchToolDefinition(
        name=ICON_SEARCH_TOOL_NAME,
        description=ICON_SEARCH_TOOL_DESCRIPTION,
        parameters=icon_search_schema(),
    )


@dataclass
class IconSearchBudget:
    per_turn: int = MAX_SEARCHES_PER_TURN
    per_generation: int = MAX_SEARCHES_PER_GENERATION
    used_this_turn: int = 0
    used_this_generation: int = 0

    def start_turn(self) -> None:
        self.used_this_turn = 0

    @property
    def turn_remaining(self) -> int:
        return max(0, self.per_turn - self.used_this_turn)

    @property
    def generation_remaining(self) -> int:
        return max(0, self.per_generation - self.used_this_generation)

    def exhausted_reason(self) -> str | None:
        if self.generation_remaining <= 0:
            return (
                "The icon-search budget for this generation is used up "
                f"({self.per_generation} searches). Use the icons already found."
            )
        if self.turn_remaining <= 0:
            return (
                f"This turn has used all {self.per_turn} icon searches. Use the "
                "current icons, then search in a later turn if needed."
            )
        return None

    def consume(self) -> None:
        self.used_this_turn += 1
        self.used_this_generation += 1


def clamp_query(raw: object) -> str:
    text = raw.strip() if isinstance(raw, str) else ""
    return " ".join(text.split())[:MAX_QUERY_CHARS]


def clamp_count(raw: object) -> int:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return DEFAULT_ICONS
    return max(MIN_ICONS, min(MAX_ICONS, int(raw)))


def summarize_icon_search_input(args: Dict[str, Any]) -> Dict[str, Any]:
    """Closed safe summary for activity events and durable run logs."""

    return {
        "query": clamp_query(args.get("query")),
        "count": clamp_count(args.get("count")),
    }


def _failure(message: str, code: str) -> IconSearchToolOutcome:
    return IconSearchToolOutcome(
        ok=False,
        result={"error": message, "error_code": code},
        summary={"error": message, "status": "error"},
    )


def _filename_stem(candidate: IconCandidate) -> str:
    raw = f"iconify-{candidate.prefix}-{candidate.name}".lower()
    cleaned = _UNSAFE_FILENAME.sub("-", raw).strip("-")[:96].rstrip("-")
    return cleaned or "iconify-icon"


def _retrieval_date() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _metadata(candidate: IconCandidate, retrieved_at: str) -> Dict[str, Any]:
    collection = candidate.collection
    license_notice = (
        f"{collection.name} by {collection.author}; "
        f"{collection.license.title} ({collection.license.spdx}); "
        f"source {candidate.source_url}; licence {collection.license.url}; "
        f"retrieved {retrieved_at}."
    )
    metadata: Dict[str, Any] = {
        "id": candidate.icon_id,
        "icon": candidate.name,
        "collection": collection.name,
        "collection_prefix": collection.prefix,
        "author": collection.author,
        "source_url": candidate.source_url,
        "license_spdx": collection.license.spdx,
        "license_name": collection.license.title,
        "license_url": collection.license.url,
        "license_notice": license_notice,
        "retrieved_at": retrieved_at,
        "brand_or_trademark": collection.is_brand,
    }
    if collection.author_url:
        metadata["author_url"] = collection.author_url
    if collection.category:
        metadata["category"] = collection.category
    if collection.is_brand:
        metadata["trademark_warning"] = TRADEMARK_WARNING
    return metadata


@dataclass
class IconSearchRuntime:
    """Runs bounded Iconify search for one generation and owns its budget."""

    settings: IconSearchSettings = field(default_factory=IconSearchSettings)
    budget: IconSearchBudget = field(default_factory=IconSearchBudget)
    transport: httpx.AsyncBaseTransport | None = None

    @property
    def is_available(self) -> bool:
        return self.settings.is_usable

    def start_turn(self) -> None:
        self.budget.start_turn()

    async def execute(self, args: Dict[str, Any]) -> IconSearchToolOutcome:
        reason = self.settings.unusable_reason
        if reason is not None:
            return _failure(reason, "not_enabled")

        query = clamp_query(args.get("query"))
        if len(query) < MIN_QUERY_CHARS:
            return _failure(
                f"{ICON_SEARCH_TOOL_NAME} needs a query of at least "
                f"{MIN_QUERY_CHARS} characters.",
                "invalid_request",
            )
        exhausted = self.budget.exhausted_reason()
        if exhausted is not None:
            return _failure(exhausted, "budget_exhausted")

        count = clamp_count(args.get("count"))
        self.budget.consume()
        client = create_iconify_client(self.transport)
        try:
            try:
                candidates, excluded = await search_icon_candidates(
                    query, client=client
                )
            except IconifyError as error:
                return _failure(error.message, error.code)

            if not candidates:
                return IconSearchToolOutcome(
                    ok=False,
                    result={
                        "error": (
                            f"No icons matched '{query}' under the permissive "
                            "licence policy. Try a broader description."
                        ),
                        "error_code": "no_permissive_results",
                        "query": query,
                        "found": 0,
                        "requested": count,
                        "excluded_collections": excluded,
                        "permissive_licenses": list(PERMISSIVE_LICENSES),
                    },
                    summary={
                        "query": query,
                        "found": 0,
                        "requested": count,
                        "status": "error",
                        "message": f"No permissively licensed icons matched '{query}'.",
                    },
                )

            retrieved_at = _retrieval_date()
            items: list[Dict[str, Any]] = []
            assets: list[LocalIconAsset] = []
            rejected: list[Dict[str, Any]] = []

            for candidate in candidates[:MAX_ICON_DOWNLOAD_ATTEMPTS]:
                if len(items) >= count:
                    break
                metadata = _metadata(candidate, retrieved_at)
                try:
                    raw_svg = await fetch_icon_svg(candidate, client=client)
                    sanitized = sanitize_svg(raw_svg, metadata)
                except (IconifyError, SvgRejected) as error:
                    rejected.append(
                        {
                            "id": candidate.icon_id,
                            "collection": candidate.collection.name,
                            "source_url": candidate.source_url,
                            "status": "error",
                            "error": getattr(error, "message", None)
                            or getattr(error, "reason", "the SVG was rejected"),
                            "error_code": getattr(error, "code", "rejected"),
                        }
                    )
                    continue

                item = dict(metadata)
                item.update(
                    {
                        "status": "ok",
                        "filename": f"{_filename_stem(candidate)}.svg",
                        "bytes": len(sanitized),
                        "notice_preserved": True,
                    }
                )
                items.append(item)
                assets.append(
                    LocalIconAsset(
                        filename_stem=_filename_stem(candidate), data=sanitized
                    )
                )
        finally:
            await client.aclose()

        found = len(items)
        message = (
            f"Found {found} icon{'s' if found != 1 else ''} for '{query}'."
            if found == count
            else f"Found {found} of {count} icons for '{query}'."
        )
        payload: Dict[str, Any] = {
            "query": query,
            "found": found,
            "requested": count,
            "message": message,
            "icons": items,
            "provider": "iconify",
            "origin": "api.iconify.design",
            "retrieved_at": retrieved_at,
            "permissive_licenses": list(PERMISSIVE_LICENSES),
            "metadata_warning": THIRD_PARTY_METADATA_WARNING,
            "trademark_warning": TRADEMARK_WARNING,
            "egress": EGRESS_NOTICE,
            "searches_remaining_this_turn": self.budget.turn_remaining,
            "searches_remaining_this_generation": self.budget.generation_remaining,
        }
        summary = dict(payload)
        if excluded:
            payload["excluded_collections"] = excluded
            summary["excluded_collections"] = excluded
        if rejected:
            payload["rejected"] = rejected
            summary["rejected"] = rejected

        if found == 0:
            payload["error"] = (
                f"Iconify returned candidates for '{query}', but none could be "
                "downloaded and sanitized safely."
            )
            payload["error_code"] = "download_failed"
            summary["error"] = payload["error"]
            summary["status"] = "error"
            return IconSearchToolOutcome(ok=False, result=payload, summary=summary)

        return IconSearchToolOutcome(
            ok=True,
            result=payload,
            summary=summary,
            assets=tuple(assets),
        )


__all__ = [
    "ICON_SEARCH_TOOL_NAME",
    "IconSearchBudget",
    "IconSearchRuntime",
    "IconSearchToolDefinition",
    "IconSearchToolOutcome",
    "LocalIconAsset",
    "clamp_count",
    "clamp_query",
    "icon_search_schema",
    "icon_search_tool_definition",
    "summarize_icon_search_input",
]
