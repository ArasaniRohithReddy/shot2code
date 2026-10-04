import base64
from typing import Any, Dict

from preview_screenshot import capture_preview_evidence
from preview_screenshot.diagnostics import sanitize_runtime_message

from agent.state import AgentFileState
from agent.tools.types import ToolExecutionResult, ToolMultimodalPart


PREVIEW_VIEWPORTS = ("desktop", "mobile")


async def run_screenshot_preview(
    _args: Dict[str, Any],
    *,
    file_state: AgentFileState,
) -> ToolExecutionResult:
    """Render the current HTML and return screenshots.

    These previews are for *seeing*, not keeping: the model views them as
    attached image bytes (multimodal parts) to verify its work and never
    embeds them in its output, so they are NOT persisted as assets. A data
    URL is inlined into the summary purely so the UI can show the same preview.
    """
    if not file_state.content:
        return ToolExecutionResult(
            ok=False,
            result={"error": "No file exists yet. Call create_file first."},
            summary={"error": "No file to screenshot"},
        )

    screenshots: list[Dict[str, Any]] = []
    multimodal_parts: list[ToolMultimodalPart] = []
    try:
        for viewport in PREVIEW_VIEWPORTS:
            evidence = await capture_preview_evidence(
                file_state.content,
                device=viewport,
                full_page=True,
            )
            image_bytes = evidence.image
            display_name = f"preview_{viewport}.png"
            image_part_index = len(multimodal_parts)
            encoded_image = base64.b64encode(image_bytes).decode("ascii")
            data_url = f"data:image/png;base64,{encoded_image}"
            screenshots.append(
                {
                    "viewport": viewport,
                    "full_page": True,
                    "image_part_index": image_part_index,
                    "image_display_name": display_name,
                    "image_bytes": len(image_bytes),
                    # Inlined for the UI thumbnail only — never stored as an asset.
                    "image_url": data_url,
                    "nearly_blank": evidence.nearly_blank,
                    "console_error_count": len(evidence.console_errors),
                    "page_error_count": len(evidence.page_errors),
                    "status": "ok",
                }
            )
            screenshots[-1]["diagnostics"] = {
                "body_text_chars": evidence.body_text_chars,
                "rendered_elements": evidence.rendered_elements,
                "console_errors": list(evidence.console_errors),
                "page_errors": list(evidence.page_errors),
            }
            multimodal_parts.append(
                ToolMultimodalPart(
                    display_name=display_name,
                    mime_type="image/png",
                    data=image_bytes,
                )
            )
    except Exception as exc:
        print(f"Preview screenshot failed: {type(exc).__name__}")
        message = sanitize_runtime_message(exc)
        return ToolExecutionResult(
            ok=False,
            result={"error": f"Screenshot failed: {message}"},
            summary={"error": "Screenshot failed"},
        )

    problematic = [
        screenshot
        for screenshot in screenshots
        if screenshot["nearly_blank"]
        or screenshot["console_error_count"]
        or screenshot["page_error_count"]
    ]
    content = (
        "Full-page desktop and mobile screenshots of the current preview are "
        "attached."
    )
    if problematic:
        content += (
            " One or more previews were nearly blank or reported browser "
            "runtime errors. Fix the diagnostics below before treating the "
            "render as complete."
        )

    result: Dict[str, Any] = {
        "content": content,
        "details": {
            "screenshots": [
                {
                    "viewport": screenshot["viewport"],
                    "full_page": screenshot["full_page"],
                    "image_part_index": screenshot["image_part_index"],
                    "image_display_name": screenshot["image_display_name"],
                    "image_bytes": screenshot["image_bytes"],
                    "nearly_blank": screenshot["nearly_blank"],
                    "diagnostics": screenshot["diagnostics"],
                }
                for screenshot in screenshots
            ],
        },
    }
    summary: Dict[str, Any] = {
        "screenshots": screenshots,
        "previewIssues": len(problematic),
        "status": "ok",
    }
    return ToolExecutionResult(
        ok=True,
        result=result,
        summary=summary,
        multimodal_parts=multimodal_parts,
    )
