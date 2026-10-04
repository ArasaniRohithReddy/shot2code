from typing import Any, Dict, List

from agent.tools.types import CanonicalToolDefinition
from free_images.tool import free_image_search_tool_definition
from icon_search.tool import icon_search_tool_definition
from image_generation.replicate import P_IMAGE_EDIT_ASPECT_RATIOS
from uploaded_assets.tools import SAVE_ASSETS_TOOL_DEFINITION
from web_search.tool import page_fetch_tool_definition, web_search_tool_definition


def _create_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path for the main HTML file. Use index.html if unsure.",
            },
            "content": {
                "type": "string",
                "description": "Full HTML for the single-file app.",
            },
        },
        "required": ["content"],
    }


def _edit_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path for the main HTML file.",
            },
            "old_text": {
                "type": "string",
                "description": "Exact text to replace. Must match the file contents.",
            },
            "new_text": {
                "type": "string",
                "description": "Replacement text.",
            },
            "count": {
                "type": "integer",
                "description": "How many occurrences to replace. Use -1 for all.",
            },
            "edits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "old_text": {"type": "string"},
                        "new_text": {"type": "string"},
                        "count": {"type": "integer"},
                    },
                    "required": ["old_text", "new_text"],
                },
            },
        },
    }


def _image_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "prompts": {
                "type": "array",
                "items": {
                    "type": "string",
                    "description": "Prompt describing a single image to generate.",
                },
            }
        },
        "required": ["prompts"],
    }


def _remove_backgrounds_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "image_urls": {
                "type": "array",
                "items": {
                    "type": "string",
                    "description": "URL of an image to remove the background from.",
                },
            },
        },
        "required": ["image_urls"],
    }


def _edit_images_schema() -> Dict[str, Any]:
    edit_properties: Dict[str, Any] = {
        "prompt": {
            "type": "string",
            "description": (
                "Clear instruction for this independent edit. Refer to inputs as "
                "image 1, image 2, and so on when multiple images are provided."
            ),
        },
        "image_urls": {
            "type": "array",
            "items": {
                "type": "string",
                "description": "URL of a source or reference image.",
            },
            "description": (
                "Ordered image URLs for this edit: put the main image first, "
                "followed by any reference images."
            ),
        },
        "aspect_ratio": {
            "type": "string",
            "enum": list(P_IMAGE_EDIT_ASPECT_RATIOS),
            "default": "match_input_image",
            "description": (
                "Optional aspect ratio for this edited image. Use match_input_image "
                "to match its main image."
            ),
        },
    }
    return {
        "type": "object",
        "properties": {
            "edits": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": edit_properties,
                    "required": ["prompt", "image_urls"],
                },
                "description": (
                    "Independent image edits to run in parallel. Results are returned "
                    "in this same order."
                ),
            },
        },
        "required": ["edits"],
    }


def _extract_assets_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "asset_descriptions": {
                "type": "array",
                "items": {
                    "type": "string",
                    "description": (
                        "Identify exactly one visual-asset occurrence. Include its "
                        "distinctive appearance (colors, shape, content, or visible "
                        "wordmark), precise location, nearby UI/context, and the "
                        "1-based screenshot number when multiple screenshots are "
                        "available. For repeated lookalikes, use a separate item for "
                        "each wanted instance and distinguish it (for example, "
                        "leftmost vs. rightmost); do not give only a generic category."
                    ),
                },
            },
        },
        "required": ["asset_descriptions"],
    }


def _screenshot_preview_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {},
    }


def _retrieve_option_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "option_number": {
                "type": "integer",
                "description": "1-based option number to retrieve (Option 1, Option 2, etc.).",
            }
        },
        "required": ["option_number"],
    }


def canonical_tool_definitions(
    image_generation_enabled: bool = True,
    image_editing_enabled: bool = True,
    asset_extraction_enabled: bool = True,
    screenshot_enabled: bool = True,
    background_removal_enabled: bool = True,
    web_search_enabled: bool = False,
    page_fetch_enabled: bool = False,
    free_image_search_enabled: bool = False,
    icon_search_enabled: bool = False,
) -> List[CanonicalToolDefinition]:
    tools: List[CanonicalToolDefinition] = [
        CanonicalToolDefinition(
            name="create_file",
            description=(
                "Create the main HTML file for the app. Use exactly once to write the "
                "full HTML. Returns a success message and file metadata."
            ),
            parameters=_create_schema(),
        ),
        CanonicalToolDefinition(
            name="edit_file",
            description=(
                "Edit the main HTML file using exact string replacements. Do not "
                "regenerate the entire file. Returns a success message plus edit "
                "details, including a unified diff and first changed line."
            ),
            parameters=_edit_schema(),
        ),
    ]
    if image_generation_enabled:
        tools.append(
            CanonicalToolDefinition(
                name="generate_images",
                description=(
                    "Generate image URLs from prompts using an image generation "
                    "model. Prompt in detail, and when prompting for people, "
                    "include details about their appearance such as their "
                    "ethnicity, hair color, features, etc. You can pass multiple "
                    "prompts at once. Each prompt reports its own outcome: check "
                    "every item's status, because some prompts can fail while "
                    "others succeed."
                ),
                parameters=_image_schema(),
            )
        )
    if background_removal_enabled:
        tools.append(
            CanonicalToolDefinition(
                name="remove_backgrounds",
                description=(
                    "Remove the backgrounds from one or more images in one batch. "
                    "Returns URLs to the processed images with transparent "
                    "backgrounds in input order, with a per-image status."
                ),
                parameters=_remove_backgrounds_schema(),
            )
        )
    if image_editing_enabled:
        tools.append(
            CanonicalToolDefinition(
                name="edit_images",
                description=(
                    "Edit or upscale one or more images by running independent edits in "
                    "one batch. Each edit has its own prompt, ordered main/reference "
                    "image URLs, and optional aspect ratio. Results are returned in edit "
                    "order."
                ),
                parameters=_edit_images_schema(),
            )
        )
    if asset_extraction_enabled:
        tools.append(
            CanonicalToolDefinition(
                name="extract_assets",
                description=(
                    "Extract one or more tightly cropped visual assets from the input "
                    "screenshots or reference images using Gemini. Describe exactly "
                    "one occurrence per list item with distinctive appearance, precise "
                    "location, nearby context, and the 1-based screenshot number; "
                    "distinguish repeated lookalikes instead of naming a generic asset. "
                    "Returns each asset in request order with a permanent, embeddable "
                    "public_url and an attached crop preview; genuinely absent or "
                    "unisolatable items are unresolved. These assets are already saved "
                    "— do NOT call save_assets on them (save_assets is only for "
                    "user-uploaded images)."
                ),
                parameters=_extract_assets_schema(),
            )
        )
    if screenshot_enabled:
        tools.append(
            CanonicalToolDefinition(
                name="screenshot_preview",
                description=(
                    "Render the current HTML file in a headless browser and return "
                    "full-page desktop and mobile screenshots so you can visually "
                    "verify your work. Use after creating or substantially editing "
                    "the file to check layout, spacing, and fidelity to the "
                    "requested design. Screenshots are returned as attached images."
                ),
                parameters=_screenshot_preview_schema(),
            )
        )
    if web_search_enabled:
        # Described by web_search.tool so one definition serves every runtime,
        # and wrapped here so that package never has to import agent types.
        search_tool = web_search_tool_definition()
        tools.append(
            CanonicalToolDefinition(
                name=search_tool.name,
                description=search_tool.description,
                parameters=search_tool.parameters,
            )
        )
    if page_fetch_enabled:
        page_tool = page_fetch_tool_definition()
        tools.append(
            CanonicalToolDefinition(
                name=page_tool.name,
                description=page_tool.description,
                parameters=page_tool.parameters,
            )
        )
    if free_image_search_enabled:
        # A separate tool from generate_images on purpose: one invents a
        # picture, this one finds a real public-domain photograph. Described by
        # free_images.tool so one definition serves every runtime.
        free_image_tool = free_image_search_tool_definition()
        tools.append(
            CanonicalToolDefinition(
                name=free_image_tool.name,
                description=free_image_tool.description,
                parameters=free_image_tool.parameters,
            )
        )
    if icon_search_enabled:
        icon_tool = icon_search_tool_definition()
        tools.append(
            CanonicalToolDefinition(
                name=icon_tool.name,
                description=icon_tool.description,
                parameters=icon_tool.parameters,
            )
        )
    tools.extend(
        [
            SAVE_ASSETS_TOOL_DEFINITION,
            CanonicalToolDefinition(
                name="retrieve_option",
                description=(
                    "Retrieve the full HTML for a specific option (variant) so you can "
                    "reference it."
                ),
                parameters=_retrieve_option_schema(),
            ),
        ]
    )
    return tools
