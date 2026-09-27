"""The canonical ``search_free_images`` tool.

Deliberately a *separate* tool from ``generate_images``, not a fallback inside
it. They answer different questions - "invent a picture of X" and "find a real
photograph of X that is free to use" - and quietly swapping one for the other
would hand a user stock photography where they asked for an illustration, or
an AI rendering where they needed a real product shot. The model picks, and the
activity feed says which happened.

It is also the only image path that works with no credential at all, so a
machine with no Replicate, Cloudflare or OpenAI-compatible configuration can
still fill a design with real imagery. Having those credentials changes nothing
here: both tools are offered when both are available.

Everything a model is told is bounded: one query, at most four images, one
Openverse request per call, and a per-turn and per-generation budget in line
with the other network tools. Everything a user is told travels with the
image: title, creator, source page, provider, licence name and licence URL,
plus a standing warning that Openverse aggregates other people's metadata and
can be wrong about it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

import httpx

from free_images.config import (
    ALLOWED_LICENSES,
    DEFAULT_IMAGES,
    EGRESS_NOTICE,
    FreeImageSearchSettings,
    MAX_IMAGES,
    MAX_QUERY_CHARS,
    MAX_SEARCHES_PER_GENERATION,
    MAX_SEARCHES_PER_TURN,
    MIN_IMAGES,
    MIN_QUERY_CHARS,
    ORIENTATION_VALUES,
    VERIFY_METADATA_WARNING,
)
from free_images.download import ImageDownloadRejected, download_image
from free_images.openverse import FreeImageResult, OpenverseError, search_images

FREE_IMAGE_SEARCH_TOOL_NAME = "search_free_images"

FREE_IMAGE_SEARCH_TOOL_DESCRIPTION = (
    "Find real, ready-to-use photographs and illustrations that are in the "
    "public domain (CC0 or Public Domain Mark), and save them into the "
    "project. Use this instead of generate_images when the design needs an "
    "actual photograph - a product shot, a place, a texture, a reference - "
    "rather than an invented or illustrated image. Every result is downloaded "
    "and served locally, so use the returned local URL in the HTML and never "
    "link to the original site. Results carry a title, creator, source page "
    "and licence; keep them if you add a credit. Send one focused subject per "
    f"call and ask for {MIN_IMAGES}-{MAX_IMAGES} images. At most "
    f"{MAX_SEARCHES_PER_TURN} searches per turn and "
    f"{MAX_SEARCHES_PER_GENERATION} per generation."
)


def free_image_search_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "What the image should show, as a short subject phrase - "
                    "'mountain lake at sunrise', 'ceramic coffee cup on wood'. "
                    f"{MIN_QUERY_CHARS}-{MAX_QUERY_CHARS} characters. Describe "
                    "the subject, not the layout, and never include page "
                    "content, file paths or credentials."
                ),
            },
            "count": {
                "type": "integer",
                "minimum": MIN_IMAGES,
                "maximum": MAX_IMAGES,
                "default": DEFAULT_IMAGES,
                "description": (
                    f"How many images to keep, {MIN_IMAGES}-{MAX_IMAGES}. Ask "
                    "for the fewest the design actually needs."
                ),
            },
            "orientation": {
                "type": "string",
                "enum": list(ORIENTATION_VALUES),
                "default": "any",
                "description": (
                    "Preferred shape: 'landscape' for a hero or banner, "
                    "'portrait' for a card or profile, 'square' for a tile. "
                    "Use 'any' when the shape does not matter - it returns "
                    "more choices."
                ),
            },
        },
        "required": ["query"],
    }


@dataclass(frozen=True)
class FreeImageToolDefinition:
    """Name, description and schema, free of any ``agent`` types.

    Kept plain for the same reason ``web_search`` keeps its definition plain:
    ``agent.tools.definitions`` imports this package, so this package must
    never import back into ``agent``.
    """

    name: str
    description: str
    parameters: Dict[str, Any]


@dataclass(frozen=True)
class FreeImageToolOutcome:
    """One tool execution, in the shape the agent runtime re-wraps."""

    ok: bool
    result: Dict[str, Any]
    summary: Dict[str, Any]
    # Local assets the runtime should show the model, as (name, mime, bytes).
    images: tuple[tuple[str, str, bytes], ...] = ()


def free_image_search_tool_definition() -> FreeImageToolDefinition:
    return FreeImageToolDefinition(
        name=FREE_IMAGE_SEARCH_TOOL_NAME,
        description=FREE_IMAGE_SEARCH_TOOL_DESCRIPTION,
        parameters=free_image_search_schema(),
    )


@dataclass
class FreeImageBudget:
    """How many searches one generation, and one turn inside it, may run."""

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
                "The free-image-search budget for this generation is used up "
                f"({self.per_generation} searches). Continue with the images "
                "you already have."
            )
        if self.turn_remaining <= 0:
            return (
                f"This turn has used all {self.per_turn} of its free-image "
                "searches. Use what you have, then search again in a later "
                "turn if you still need to."
            )
        return None

    def consume(self) -> None:
        self.used_this_turn += 1
        self.used_this_generation += 1


def clamp_query(raw: object) -> str:
    text = raw.strip() if isinstance(raw, str) else ""
    # Collapse whitespace so a pasted block of markup cannot become a "query".
    return " ".join(text.split())[:MAX_QUERY_CHARS]


def clamp_count(raw: object) -> int:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return DEFAULT_IMAGES
    return max(MIN_IMAGES, min(MAX_IMAGES, int(raw)))


def clamp_orientation(raw: object) -> str:
    if isinstance(raw, str) and raw.strip().lower() in ORIENTATION_VALUES:
        return raw.strip().lower()
    return "any"


def summarize_free_image_input(args: Dict[str, Any]) -> Dict[str, Any]:
    """What the activity feed and the run log show for one call.

    A closed allowlist of this tool's own fields, so anything else a model
    hallucinated into the arguments is dropped rather than streamed onward.
    """
    return {
        "query": clamp_query(args.get("query")),
        "count": clamp_count(args.get("count")),
        "orientation": clamp_orientation(args.get("orientation")),
    }


def _failure(message: str, code: str) -> FreeImageToolOutcome:
    return FreeImageToolOutcome(
        ok=False,
        result={"error": message, "error_code": code},
        summary={"error": message, "status": "error"},
    )


@dataclass
class FreeImageSearchRuntime:
    """Runs ``search_free_images`` for one generation.

    Owns the budget, so every variant gets its own allowance and a retry starts
    fresh. It holds no credential, because there is none.
    """

    settings: FreeImageSearchSettings = field(
        default_factory=FreeImageSearchSettings
    )
    budget: FreeImageBudget = field(default_factory=FreeImageBudget)
    client: httpx.AsyncClient | None = None

    @property
    def is_available(self) -> bool:
        return self.settings.is_usable

    def start_turn(self) -> None:
        self.budget.start_turn()

    async def execute(self, args: Dict[str, Any]) -> FreeImageToolOutcome:
        reason = self.settings.unusable_reason
        if reason is not None:
            return _failure(reason, "not_enabled")

        query = clamp_query(args.get("query"))
        if len(query) < MIN_QUERY_CHARS:
            return _failure(
                f"{FREE_IMAGE_SEARCH_TOOL_NAME} needs a subject of at least "
                f"{MIN_QUERY_CHARS} characters.",
                "invalid_request",
            )

        exhausted = self.budget.exhausted_reason()
        if exhausted is not None:
            return _failure(exhausted, "budget_exhausted")

        count = clamp_count(args.get("count"))
        orientation = clamp_orientation(args.get("orientation"))

        self.budget.consume()
        try:
            results = await search_images(
                query, orientation=orientation, client=self.client
            )
        except OpenverseError as error:
            return _failure(error.message, error.code)

        if not results:
            return FreeImageToolOutcome(
                ok=False,
                result={
                    "error": (
                        f"No public-domain images matched '{query}'. Try a "
                        "broader subject, or generate an image instead."
                    ),
                    "error_code": "no_results",
                    "query": query,
                    "found": 0,
                    "requested": count,
                    "licenses": list(ALLOWED_LICENSES),
                },
                summary={
                    "query": query,
                    "found": 0,
                    "requested": count,
                    "status": "error",
                    "message": f"No free images matched '{query}'.",
                },
            )

        return await self._download(query, count, orientation, results)

    async def _download(
        self,
        query: str,
        count: int,
        orientation: str,
        results: List[FreeImageResult],
    ) -> FreeImageToolOutcome:
        """Keep going until ``count`` images are in hand or candidates run out.

        A rejected candidate is recorded with its reason rather than silently
        skipped, so a run that found ten results and could safely download none
        says exactly that.
        """
        items: List[Dict[str, Any]] = []
        images: List[tuple[str, str, bytes]] = []
        rejected: List[Dict[str, Any]] = []

        for result in results:
            if len(images) >= count:
                break
            try:
                downloaded = await download_image(
                    result.image_url,
                    title=result.title,
                    fallback_name=result.id,
                    client=self.client,
                )
            except ImageDownloadRejected as error:
                rejected.append(
                    {
                        "title": result.title,
                        "source_page": result.source_page_url,
                        "status": "error",
                        "error": error.reason,
                        "error_code": error.code,
                    }
                )
                continue

            images.append((downloaded.filename, downloaded.mime_type, downloaded.data))
            item = result.to_metadata()
            item["status"] = "ok"
            item["filename"] = downloaded.filename
            item["bytes"] = len(downloaded.data)
            items.append(item)

        found = len(items)
        message = (
            f"Found {found} free image{'s' if found != 1 else ''} for '{query}'."
            if found == count
            else f"Found {found} of {count} free images for '{query}'."
        )

        payload: Dict[str, Any] = {
            "query": query,
            "orientation": orientation,
            "found": found,
            "requested": count,
            "message": message,
            "images": items,
            "licenses": list(ALLOWED_LICENSES),
            "provider": "openverse",
            "warning": VERIFY_METADATA_WARNING,
            "egress": EGRESS_NOTICE,
        }
        summary: Dict[str, Any] = {
            "query": query,
            "orientation": orientation,
            "found": found,
            "requested": count,
            "message": message,
            "images": items,
            "provider": "openverse",
            "warning": VERIFY_METADATA_WARNING,
        }
        if rejected:
            payload["rejected"] = rejected
            summary["rejected"] = rejected

        if found == 0:
            first = rejected[0]["error"] if rejected else "no image could be used"
            error_message = (
                f"Found {len(results)} candidate image(s) for '{query}' but "
                f"none could be downloaded safely: {first}"
            )
            payload["error"] = error_message
            payload["error_code"] = "download_failed"
            summary["error"] = error_message
            summary["status"] = "error"
            return FreeImageToolOutcome(ok=False, result=payload, summary=summary)

        return FreeImageToolOutcome(
            ok=True, result=payload, summary=summary, images=tuple(images)
        )


__all__ = [
    "FREE_IMAGE_SEARCH_TOOL_NAME",
    "FreeImageBudget",
    "FreeImageSearchRuntime",
    "FreeImageToolDefinition",
    "FreeImageToolOutcome",
    "clamp_count",
    "clamp_orientation",
    "clamp_query",
    "free_image_search_schema",
    "free_image_search_tool_definition",
    "summarize_free_image_input",
]
