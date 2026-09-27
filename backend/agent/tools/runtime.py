# pyright: reportUnknownVariableType=false
import asyncio
import difflib
from typing import Any, Dict, List, Optional, Tuple, Union, cast

from codegen.utils import extract_html_content
from config import REPLICATE_API_KEY
from agent.tools.extract_assets import run_extract_assets
from asset_urls import guess_image_mime, local_asset_url_to_data_url
from agent.tools.screenshot_preview import run_screenshot_preview
from free_images.tool import FREE_IMAGE_SEARCH_TOOL_NAME, FreeImageSearchRuntime
from image_generation.assets import (
    NormalizedImage,
    normalize_image_result,
    persist_image_bytes,
    resolve_image_bytes,
)
from image_generation.errors import failure_from_exception
from image_generation.generation import generate_images
from image_generation.openai_compatible import edit_image as openai_compatible_edit
from image_generation.replicate import (
    P_IMAGE_EDIT_ASPECT_RATIOS,
    PImageEditAspectRatio,
    edit_image as edit_image_once,
    remove_background as remove_background_once,
)
from image_generation.settings import ImageGenerationSettings
from uploaded_assets.tools import run_save_assets

from agent.state import AgentFileState, ensure_str
from agent.tools.types import ToolCall, ToolExecutionResult, ToolMultimodalPart
from agent.tools.summaries import summarize_text
from web_search.tool import WEB_SEARCH_TOOL_NAME, WebSearchRuntime


IMAGE_TOOL_BATCH_SIZE = 20


def missing_credential_message(provider: str) -> str:
    """Why image generation cannot run, naming the credential that is missing."""
    if provider == "cloudflare":
        return (
            "Cloudflare Workers AI needs an account ID and an API token. Add "
            "both in Settings under Image generation."
        )
    if provider == "openai-compatible":
        return (
            "The OpenAI-compatible image endpoint needs a base URL, and an API "
            "key unless it runs on localhost. Add them in Settings under Image "
            "generation."
        )
    return (
        "Image generation needs a Replicate API key. Add one in Settings or in "
        "backend/.env, or pick another image provider."
    )


def _batch_message(verb: str, succeeded: int, requested: int) -> str:
    """``Edited 2 of 5 images`` - never more than actually happened."""
    if requested == 0:
        return f"{verb} 0 images."
    plural = "s" if requested != 1 else ""
    if succeeded == requested:
        return f"{verb} {requested} image{plural}."
    return f"{verb} {succeeded} of {requested} images."


def _image_part(
    display_name: str, image: NormalizedImage | None
) -> ToolMultimodalPart | None:
    """Build the model-facing part for a normalized image.

    A locally served asset URL is not fetchable by Anthropic/OpenAI/Gemini, so
    those images are handed over as bytes; a public provider URL is passed as a
    URL so nothing is downloaded twice.
    """
    if image is None:
        return None
    if image.data is not None:
        return ToolMultimodalPart(
            display_name=display_name, mime_type=image.mime_type, data=image.data
        )
    return ToolMultimodalPart(
        display_name=display_name,
        mime_type=image.mime_type or guess_image_mime(image.url),
        image_url=image.url,
    )


class AgentToolRuntime:
    def __init__(
        self,
        file_state: AgentFileState,
        should_generate_images: bool,
        openai_api_key: Optional[str],
        openai_base_url: Optional[str],
        gemini_api_key: Optional[str] = None,
        replicate_api_key: Optional[str] = None,
        input_images: Optional[List[str]] = None,
        asset_base_url: str = "",
        user_id: Optional[str] = None,
        option_codes: Optional[List[str]] = None,
        web_search: Optional[WebSearchRuntime] = None,
        image_settings: Optional[ImageGenerationSettings] = None,
        free_image_search: Optional[FreeImageSearchRuntime] = None,
    ):
        self.file_state = file_state
        self.should_generate_images = should_generate_images
        self.openai_api_key = openai_api_key
        self.openai_base_url = openai_base_url
        self.gemini_api_key = gemini_api_key
        self.replicate_api_key = replicate_api_key
        self.input_images = input_images or []
        self.asset_base_url = asset_base_url
        self.user_id = user_id
        self.option_codes = option_codes or []
        # Which image backend the tools use. ``None`` means "behave exactly as
        # before": Replicate, the default model, the key from Settings or env.
        self.image_settings = image_settings
        # None when web search is switched off or unusable; the tool is then
        # never advertised, so a call can only arrive from a confused model.
        self.web_search = web_search
        # Same contract for the keyless Openverse search. It is independent of
        # every image *generation* credential: a run with none of them can
        # still find real public-domain photographs.
        self.free_image_search = free_image_search

    def _effective_replicate_api_key(self) -> str | None:
        return self.replicate_api_key or REPLICATE_API_KEY

    def _image_settings(self) -> ImageGenerationSettings:
        """The configured image provider, defaulting to Replicate as before.

        A caller that passes no image settings gets exactly the historical
        behaviour: Replicate, the default model, the key from Settings or the
        environment.
        """
        if self.image_settings is not None:
            return self.image_settings
        return ImageGenerationSettings(
            enabled=self.should_generate_images,
            replicate_api_key=self._effective_replicate_api_key(),
        )

    def _edit_provider(self, settings: ImageGenerationSettings) -> str | None:
        """Which backend runs ``edit_images``, or ``None`` when none can.

        An explicitly chosen OpenAI-compatible endpoint wins, because that is
        what the user asked for; otherwise Replicate, which is the default and
        the only backend here that takes reference images and an aspect ratio.
        """
        if (
            settings.provider == "openai-compatible"
            and settings.has_generation_credential
        ):
            return "openai-compatible"
        if settings.replicate_api_key:
            return "replicate"
        return None

    async def execute(self, tool_call: ToolCall) -> ToolExecutionResult:
        if "INVALID_JSON" in tool_call.arguments:
            invalid_json = ensure_str(tool_call.arguments.get("INVALID_JSON"))
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": "Tool arguments were invalid JSON.",
                    "INVALID_JSON": invalid_json,
                },
                summary={"error": "Invalid JSON tool arguments"},
            )

        if tool_call.name == "create_file":
            return self._create_file(tool_call.arguments)
        if tool_call.name == "edit_file":
            return self._edit_file(tool_call.arguments)
        if tool_call.name == "generate_images":
            return await self._generate_images(tool_call.arguments)
        if tool_call.name == "remove_backgrounds":
            return await self._remove_backgrounds(tool_call.arguments)
        if tool_call.name == "edit_images":
            return await self._edit_images(tool_call.arguments)
        if tool_call.name == "extract_assets":
            return await run_extract_assets(
                tool_call.arguments,
                gemini_api_key=self.gemini_api_key,
                input_images=self.input_images,
                asset_base_url=self.asset_base_url,
                user_id=self.user_id,
            )
        if tool_call.name == "screenshot_preview":
            return await run_screenshot_preview(
                tool_call.arguments,
                file_state=self.file_state,
            )
        if tool_call.name == "save_assets":
            return await run_save_assets(tool_call.arguments, user_id=self.user_id)
        if tool_call.name == WEB_SEARCH_TOOL_NAME:
            return await self._search_web(tool_call.arguments)
        if tool_call.name == FREE_IMAGE_SEARCH_TOOL_NAME:
            return await self._search_free_images(tool_call.arguments)
        if tool_call.name == "retrieve_option":
            return self._retrieve_option(tool_call.arguments)
        return ToolExecutionResult(
            ok=False,
            result={"error": f"Unknown tool: {tool_call.name}"},
            summary={"error": f"Unknown tool: {tool_call.name}"},
        )

    def _create_file(self, args: Dict[str, Any]) -> ToolExecutionResult:
        path = ensure_str(args.get("path") or self.file_state.path or "index.html")
        content = ensure_str(args.get("content"))
        if not content:
            return ToolExecutionResult(
                ok=False,
                result={"error": "create_file requires non-empty content"},
                summary={"error": "Missing content"},
            )

        extracted = extract_html_content(content)
        self.file_state.path = path
        self.file_state.content = extracted or content

        summary = {
            "path": self.file_state.path,
            "contentLength": len(self.file_state.content),
            "preview": summarize_text(self.file_state.content, 320),
        }
        result = {
            "content": f"Successfully created file at {self.file_state.path}.",
            "details": {
                "path": self.file_state.path,
                "contentLength": len(self.file_state.content),
            },
        }
        return ToolExecutionResult(
            ok=True,
            result=result,
            summary=summary,
            updated_content=self.file_state.content,
        )

    @staticmethod
    def _generate_diff(old_content: str, new_content: str, path: str) -> Dict[str, Any]:
        """Generate a unified diff between old and new content."""
        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff_lines = list(
            difflib.unified_diff(old_lines, new_lines, fromfile=path, tofile=path)
        )
        diff_str = "".join(diff_lines)

        first_changed_line: Optional[int] = None
        for line in diff_lines:
            if not line.startswith("@@"):
                continue
            try:
                plus_part = line.split("+")[1].split("@@")[0].strip()
                first_changed_line = int(plus_part.split(",")[0])
            except (IndexError, ValueError):
                pass
            break

        return {
            "diff": diff_str,
            "firstChangedLine": first_changed_line,
        }

    def _apply_single_edit(
        self,
        content: str,
        old_text: str,
        new_text: str,
        count: Optional[int],
    ) -> Tuple[str, int]:
        if old_text not in content:
            return content, 0

        if count is None:
            replace_count = 1
        elif count < 0:
            replace_count = content.count(old_text)
        else:
            replace_count = count

        updated = content.replace(old_text, new_text, replace_count)
        return updated, min(replace_count, content.count(old_text))

    def _edit_file(self, args: Dict[str, Any]) -> ToolExecutionResult:
        if not self.file_state.content:
            return ToolExecutionResult(
                ok=False,
                result={"error": "No file exists yet. Call create_file first."},
                summary={"error": "No file to edit"},
            )

        edits = args.get("edits")
        if not edits:
            old_text = ensure_str(args.get("old_text"))
            new_text = ensure_str(args.get("new_text"))
            count = args.get("count")
            edits = [{"old_text": old_text, "new_text": new_text, "count": count}]

        if not isinstance(edits, list):
            return ToolExecutionResult(
                ok=False,
                result={"error": "edits must be a list"},
                summary={"error": "Invalid edits payload"},
            )

        content = self.file_state.content
        original_content = content
        summary_edits: List[Dict[str, Any]] = []
        for edit in edits:
            old_text = ensure_str(edit.get("old_text"))
            new_text = ensure_str(edit.get("new_text"))
            count = edit.get("count")
            if not old_text:
                return ToolExecutionResult(
                    ok=False,
                    result={"error": "edit_file requires old_text"},
                    summary={"error": "Missing old_text"},
                )

            content, replaced = self._apply_single_edit(content, old_text, new_text, count)
            if replaced == 0:
                return ToolExecutionResult(
                    ok=False,
                    result={"error": "old_text not found", "old_text": old_text},
                    summary={
                        "error": "old_text not found",
                        "old_text": summarize_text(old_text, 160),
                    },
                )

            summary_edits.append(
                {
                    "old_text": summarize_text(old_text, 140),
                    "new_text": summarize_text(new_text, 140),
                    "replaced": replaced,
                }
            )

        self.file_state.content = content
        path = self.file_state.path or "index.html"
        diff_info = self._generate_diff(original_content, content, path)
        summary = {
            "path": path,
            "edits": summary_edits,
            "contentLength": len(self.file_state.content),
            "diff": diff_info["diff"],
            "firstChangedLine": diff_info["firstChangedLine"],
        }
        result = {
            "content": f"Successfully edited file at {path}.",
            "details": {
                "diff": diff_info["diff"],
                "firstChangedLine": diff_info["firstChangedLine"],
            },
        }
        return ToolExecutionResult(
            ok=True,
            result=result,
            summary=summary,
            updated_content=self.file_state.content,
        )

    async def _generate_images(self, args: Dict[str, Any]) -> ToolExecutionResult:
        settings = self._image_settings()
        if not self.should_generate_images:
            return ToolExecutionResult(
                ok=False,
                result={"error": "Image generation is disabled."},
                summary={"error": "Image generation disabled"},
            )

        prompts = args.get("prompts") or []
        if not isinstance(prompts, list) or not prompts:
            return ToolExecutionResult(
                ok=False,
                result={"error": "generate_images requires a non-empty prompts list"},
                summary={"error": "Missing prompts"},
            )

        cleaned = [
            prompt.strip() for prompt in cast(List[Any], prompts) if isinstance(prompt, str)
        ]
        unique_prompts = list(dict.fromkeys([p for p in cleaned if p]))
        if not unique_prompts:
            return ToolExecutionResult(
                ok=False,
                result={"error": "No valid prompts provided"},
                summary={"error": "No valid prompts"},
            )
        if not settings.has_generation_credential:
            message = missing_credential_message(settings.provider)
            return ToolExecutionResult(
                ok=False,
                result={"error": message, "errorCategory": "credentials"},
                summary={"error": "Missing image generation credentials"},
            )

        batch = await generate_images(
            unique_prompts, settings, asset_base_url=self.asset_base_url
        )
        items = [result.to_dict() for result in batch.results]
        summary: Dict[str, Any] = {
            "images": items,
            "generated": batch.success_count,
            "requested": batch.requested_count,
            "message": batch.summary_message(),
            "provider": settings.provider,
            "model": settings.model_id,
        }
        result: Dict[str, Any] = {
            "images": items,
            "generated": batch.success_count,
            "requested": batch.requested_count,
            "message": batch.summary_message(),
        }

        # Every prompt failed: this is not a success with blank tiles. Report a
        # failure carrying the reason so the model can stop asking for images
        # it cannot get, and the UI can show what to do about it.
        if batch.all_failed:
            failure = batch.dominant_failure()
            error_message = failure.message if failure else batch.summary_message()
            result["error"] = error_message
            summary["error"] = error_message
            if failure is not None:
                result["errorCategory"] = failure.category
                result["action"] = failure.action
                summary["errorCategory"] = failure.category
            return ToolExecutionResult(ok=False, result=result, summary=summary)

        return ToolExecutionResult(
            ok=True,
            result=result,
            summary=summary,
            multimodal_parts=[
                part
                for index, image_result in enumerate(batch.succeeded)
                for part in [
                    _image_part(f"generated_{index}.png", image_result.image)
                ]
                if part is not None
            ],
        )

    async def _remove_backgrounds(self, args: Dict[str, Any]) -> ToolExecutionResult:
        # Background removal is Replicate-only and stays that way: no other
        # configured provider has an equivalent endpoint, and substituting one
        # would return an image that still has its background.
        settings = self._image_settings()
        replicate_api_key = settings.replicate_api_key
        if not replicate_api_key:
            message = (
                "Background removal runs on Replicate only, and no Replicate "
                "API key is configured. Add one in Settings or backend/.env; "
                f"the {settings.provider} image provider cannot remove "
                "backgrounds."
            )
            return ToolExecutionResult(
                ok=False,
                result={"error": message, "errorCategory": "credentials"},
                summary={"error": "Missing Replicate API key"},
            )

        image_urls = args.get("image_urls") or []
        if not isinstance(image_urls, list) or not image_urls:
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": "remove_backgrounds requires a non-empty image_urls list"
                },
                summary={"error": "Missing image_urls"},
            )

        cleaned = [
            url.strip() for url in cast(List[Any], image_urls) if isinstance(url, str)
        ]
        unique_urls = list(dict.fromkeys([u for u in cleaned if u]))
        if not unique_urls:
            return ToolExecutionResult(
                ok=False,
                result={"error": "No valid image URLs provided"},
                summary={"error": "No valid image_urls"},
            )

        raw_results: list[Any] = []
        for i in range(0, len(unique_urls), IMAGE_TOOL_BATCH_SIZE):
            batch_urls = unique_urls[i : i + IMAGE_TOOL_BATCH_SIZE]
            # Replicate can't fetch localhost; inline local assets as data URLs.
            tasks = [
                remove_background_once(
                    local_asset_url_to_data_url(url), replicate_api_key
                )
                for url in batch_urls
            ]
            raw_results.extend(await asyncio.gather(*tasks, return_exceptions=True))

        results: List[Dict[str, Any]] = []
        normalized: List[Any] = []
        succeeded = 0
        first_failure: Any = None
        for url, raw in zip(unique_urls, raw_results):
            if isinstance(raw, BaseException):
                failure = failure_from_exception(
                    raw, "replicate", secrets=(replicate_api_key,)
                )
                first_failure = first_failure or failure
                print(f"Background removal failed for {url}: {failure.category}")
                results.append(
                    {
                        "image_url": url,
                        "result_url": None,
                        "status": "error",
                        "error": failure.message,
                        "errorCategory": failure.category,
                        "action": failure.action,
                    }
                )
                continue
            try:
                image = await normalize_image_result(
                    raw, asset_base_url=self.asset_base_url, provider="replicate"
                )
            except Exception as error:  # noqa: BLE001 - normalized below
                failure = failure_from_exception(error, "replicate")
                first_failure = first_failure or failure
                results.append(
                    {
                        "image_url": url,
                        "result_url": None,
                        "status": "error",
                        "error": failure.message,
                        "errorCategory": failure.category,
                        "action": failure.action,
                    }
                )
                continue
            succeeded += 1
            normalized.append(image)
            results.append(
                {"image_url": url, "result_url": image.url, "status": "ok"}
            )

        summary_items = [
            {
                "image_url": summarize_text(ensure_str(r["image_url"]), 100),
                "result_url": r["result_url"],
                "status": r["status"],
                **({"error": r["error"]} if r.get("error") else {}),
                **(
                    {"errorCategory": r["errorCategory"]}
                    if r.get("errorCategory")
                    else {}
                ),
                **({"action": r["action"]} if r.get("action") else {}),
            }
            for r in results
        ]
        message = _batch_message("Removed background from", succeeded, len(results))
        result_payload: Dict[str, Any] = {
            "images": results,
            "processed": succeeded,
            "requested": len(results),
            "message": message,
        }
        summary_payload: Dict[str, Any] = {
            "images": summary_items,
            "processed": succeeded,
            "requested": len(results),
            "message": message,
        }
        if succeeded == 0:
            error_message = (
                first_failure.message if first_failure is not None else message
            )
            result_payload["error"] = error_message
            summary_payload["error"] = error_message
            if first_failure is not None:
                result_payload["errorCategory"] = first_failure.category
                summary_payload["errorCategory"] = first_failure.category
            return ToolExecutionResult(
                ok=False, result=result_payload, summary=summary_payload
            )

        return ToolExecutionResult(
            ok=True,
            result=result_payload,
            summary=summary_payload,
            multimodal_parts=[
                part
                for index, image in enumerate(normalized)
                for part in [_image_part(f"no_bg_{index}.png", image)]
                if part is not None
            ],
        )

    async def _edit_images(self, args: Dict[str, Any]) -> ToolExecutionResult:
        settings = self._image_settings()
        edit_provider = self._edit_provider(settings)
        if edit_provider is None:
            message = (
                "Image editing needs either a Replicate API key or an "
                "OpenAI-compatible image endpoint that implements "
                "/images/edits. Configure one in Settings."
            )
            return ToolExecutionResult(
                ok=False,
                result={"error": message, "errorCategory": "credentials"},
                summary={"error": "Missing image editing credentials"},
            )

        raw_edits = args.get("edits") or []
        if not isinstance(raw_edits, list) or not raw_edits:
            return ToolExecutionResult(
                ok=False,
                result={"error": "edit_images requires a non-empty edits list"},
                summary={"error": "Missing edits"},
            )

        results: List[Dict[str, Any]] = []
        valid_indexes: List[int] = []
        for index, raw_edit in enumerate(cast(List[object], raw_edits)):
            if not isinstance(raw_edit, dict):
                results.append(
                    {
                        "prompt": "",
                        "image_urls": [],
                        "result_url": None,
                        "status": "error",
                        "aspect_ratio": "match_input_image",
                        "error": f"Edit {index + 1} must be an object.",
                        "errorCategory": "configuration",
                    }
                )
                continue

            edit = cast(Dict[str, Any], raw_edit)
            prompt = ensure_str(edit.get("prompt")).strip()
            raw_image_urls = edit.get("image_urls") or []
            image_urls = (
                [
                    url.strip()
                    for url in cast(List[object], raw_image_urls)
                    if isinstance(url, str) and url.strip()
                ]
                if isinstance(raw_image_urls, list)
                else []
            )
            aspect_ratio_value = ensure_str(
                edit.get("aspect_ratio") or "match_input_image"
            )
            if aspect_ratio_value not in P_IMAGE_EDIT_ASPECT_RATIOS:
                aspect_ratio_value = "match_input_image"

            item: Dict[str, Any] = {
                "prompt": prompt,
                "image_urls": image_urls,
                "result_url": None,
                "status": "pending",
                "aspect_ratio": aspect_ratio_value,
            }
            errors: List[str] = []
            if not prompt:
                errors.append("prompt must be non-empty")
            if not image_urls:
                errors.append("image_urls must contain at least one valid URL")
            if errors:
                item["status"] = "error"
                item["error"] = "; ".join(errors)
                item["errorCategory"] = "configuration"
            else:
                valid_indexes.append(index)
            results.append(item)

        async def execute_single_edit(item: Dict[str, Any]) -> Any:
            image_urls = cast(List[str], item["image_urls"])
            if edit_provider == "openai-compatible":
                image_bytes, mime_type = await resolve_image_bytes(
                    image_urls[0], provider="openai-compatible"
                )
                return await openai_compatible_edit(
                    ensure_str(item["prompt"]),
                    image=(image_bytes, mime_type),
                    base_url=settings.openai_image_base_url or "",
                    api_key=settings.openai_image_api_key,
                    model=settings.openai_image_model or settings.model_id,
                    asset_base_url=self.asset_base_url,
                )
            url = await edit_image_once(
                prompt=ensure_str(item["prompt"]),
                image_urls=[local_asset_url_to_data_url(url) for url in image_urls],
                api_token=settings.replicate_api_key or "",
                aspect_ratio=cast(PImageEditAspectRatio, item["aspect_ratio"]),
            )
            return await normalize_image_result(
                url, asset_base_url=self.asset_base_url, provider="replicate"
            )

        normalized: List[Tuple[int, Any]] = []
        for i in range(0, len(valid_indexes), IMAGE_TOOL_BATCH_SIZE):
            batch_indexes = valid_indexes[i : i + IMAGE_TOOL_BATCH_SIZE]
            raw_results = await asyncio.gather(
                *(execute_single_edit(results[index]) for index in batch_indexes),
                return_exceptions=True,
            )
            for index, raw in zip(batch_indexes, raw_results):
                item = results[index]
                if isinstance(raw, BaseException):
                    failure = failure_from_exception(
                        raw, edit_provider, secrets=settings.secrets()
                    )
                    print(f"Image edit failed for {item['image_urls']}: {failure.category}")
                    item["status"] = "error"
                    item["error"] = failure.message
                    item["errorCategory"] = failure.category
                    item["action"] = failure.action
                else:
                    item["result_url"] = raw.url
                    item["status"] = "ok"
                    normalized.append((index, raw))

        summary_items = [
            {
                "prompt": item["prompt"],
                "image_urls": cast(List[str], item["image_urls"]),
                "result_url": item["result_url"],
                "status": item["status"],
                "aspect_ratio": item["aspect_ratio"],
                **({"error": item["error"]} if item.get("error") else {}),
                **(
                    {"errorCategory": item["errorCategory"]}
                    if item.get("errorCategory")
                    else {}
                ),
                **({"action": item["action"]} if item.get("action") else {}),
            }
            for item in results
        ]
        succeeded = len(normalized)
        message = _batch_message("Edited", succeeded, len(results))
        result_payload: Dict[str, Any] = {
            "images": results,
            "edited": succeeded,
            "requested": len(results),
            "message": message,
        }
        summary_payload: Dict[str, Any] = {
            "images": summary_items,
            "edited": succeeded,
            "requested": len(results),
            "message": message,
            "provider": edit_provider,
        }
        if succeeded == 0:
            first_error = next(
                (
                    ensure_str(item["error"])
                    for item in results
                    if item.get("error")
                ),
                message,
            )
            result_payload["error"] = first_error
            summary_payload["error"] = first_error
            return ToolExecutionResult(
                ok=False, result=result_payload, summary=summary_payload
            )

        return ToolExecutionResult(
            ok=True,
            result=result_payload,
            summary=summary_payload,
            multimodal_parts=[
                part
                for position, (_, image) in enumerate(normalized)
                for part in [_image_part(f"edited_{position}.png", image)]
                if part is not None
            ],
        )

    async def _search_web(self, args: Dict[str, Any]) -> ToolExecutionResult:
        """Run one canonical web search, or explain why it cannot.

        The tool is only advertised when a usable provider is configured, so
        reaching this without a runtime means a model invented the call. That
        is answered with the same actionable sentence the user would see
        rather than an opaque "unknown tool".
        """
        if self.web_search is None:
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": (
                        "Web search is not configured for this run. Continue "
                        "without it."
                    ),
                    "error_code": "not_configured",
                },
                summary={"error": "Web search is not configured", "status": "error"},
            )
        outcome = await self.web_search.execute(args)
        return ToolExecutionResult(
            ok=outcome.ok, result=outcome.result, summary=outcome.summary
        )

    async def _search_free_images(self, args: Dict[str, Any]) -> ToolExecutionResult:
        """Find public-domain images and persist them as local assets.

        The search and the licence policy live in ``free_images``; this method
        is only the bridge that turns downloaded bytes into served
        ``/local-assets/`` URLs through the same adapter a generated image
        uses. Nothing external is ever linked into the page.
        """
        if self.free_image_search is None:
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": (
                        "Free image search is not enabled for this run. "
                        "Continue without it, or generate an image instead."
                    ),
                    "error_code": "not_enabled",
                },
                summary={
                    "error": "Free image search is not enabled",
                    "status": "error",
                },
            )

        outcome = await self.free_image_search.execute(args)
        result = dict(outcome.result)
        summary = dict(outcome.summary)
        multimodal_parts: List[ToolMultimodalPart] = []

        # Persist first, then rewrite each item's url: an item only gets a URL
        # once its bytes are actually on disk and servable.
        persisted: List[Dict[str, Any]] = []
        items = result.get("images")
        if isinstance(items, list) and outcome.images:
            for item, (filename, mime_type, data) in zip(
                cast(List[Dict[str, Any]], items), outcome.images
            ):
                try:
                    image = await persist_image_bytes(
                        data,
                        asset_base_url=self.asset_base_url,
                        provider="openverse",
                        mime_hint=mime_type,
                    )
                except Exception as error:  # noqa: BLE001 - recorded per item
                    failure = failure_from_exception(error, "openverse")
                    entry = dict(item)
                    entry["status"] = "error"
                    entry["error"] = failure.message
                    entry["url"] = None
                    persisted.append(entry)
                    continue
                entry = dict(item)
                entry["url"] = image.url
                entry["mime_type"] = image.mime_type
                persisted.append(entry)
                multimodal_parts.append(
                    ToolMultimodalPart(
                        display_name=filename,
                        mime_type=image.mime_type,
                        data=data,
                    )
                )

            saved = sum(1 for entry in persisted if entry.get("url"))
            requested = int(result.get("requested") or len(persisted))
            message = (
                f"Found {saved} free image{'s' if saved != 1 else ''}."
                if saved == requested
                else f"Found {saved} of {requested} free images."
            )
            result["images"] = persisted
            summary["images"] = persisted
            result["found"] = saved
            summary["found"] = saved
            result["message"] = message
            summary["message"] = message
            if saved == 0:
                failed = (
                    "None of the images found could be saved locally."
                )
                result["error"] = failed
                result["error_code"] = "save_failed"
                summary["error"] = failed
                summary["status"] = "error"
                return ToolExecutionResult(ok=False, result=result, summary=summary)

        return ToolExecutionResult(
            ok=outcome.ok,
            result=result,
            summary=summary,
            multimodal_parts=multimodal_parts or None,
        )

    def _retrieve_option(self, args: Dict[str, Any]) -> ToolExecutionResult:
        raw_option_number = args.get("option_number")
        raw_index = args.get("index")

        def coerce_int(value: Any) -> Optional[int]:
            if value is None:
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        option_number = coerce_int(raw_option_number)
        index = coerce_int(raw_index)

        if option_number is None and index is None:
            return ToolExecutionResult(
                ok=False,
                result={"error": "retrieve_option requires option_number"},
                summary={"error": "Missing option_number"},
            )

        resolved_index = index if option_number is None else option_number - 1
        if resolved_index is None:
            return ToolExecutionResult(
                ok=False,
                result={"error": "Invalid option_number"},
                summary={"error": "Invalid option_number"},
            )

        if resolved_index < 0 or resolved_index >= len(self.option_codes):
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": "Option index out of range",
                    "option_number": resolved_index + 1,
                    "available": len(self.option_codes),
                },
                summary={
                    "error": "Option index out of range",
                    "available": len(self.option_codes),
                },
            )

        code = ensure_str(self.option_codes[resolved_index])
        if not code.strip():
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": "Option code is empty or unavailable",
                    "option_number": resolved_index + 1,
                },
                summary={"error": "Option code unavailable"},
            )

        summary = {
            "option_number": resolved_index + 1,
            "contentLength": len(code),
            "preview": summarize_text(code, 200),
        }
        result = {"option_number": resolved_index + 1, "code": code}
        return ToolExecutionResult(ok=True, result=result, summary=summary)


# Backwards-compatible alias for older imports.
AgentToolbox = AgentToolRuntime
