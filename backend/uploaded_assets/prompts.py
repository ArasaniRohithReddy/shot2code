from copy import deepcopy

from asset_urls import local_asset_url_to_bytes
from prompts.prompt_types import PromptHistoryMessage, UserTurnInput
from uploaded_assets.store import persist_data_url_as_temporary_asset


def _build_asset_id_block(images: list[str], asset_base_url: str) -> str:
    asset_lines: list[str] = []
    for index, image in enumerate(images, start=1):
        asset = persist_data_url_as_temporary_asset(image, asset_base_url)
        if asset:
            asset_lines.append(f"- Image {index}: asset_id `{asset.asset_id}`")

    if not asset_lines:
        return ""

    joined_asset_lines = "\n".join(asset_lines)
    return f"""

## Uploaded image asset IDs

The uploaded images in this turn are available to the save_assets tool by
opaque asset IDs:

{joined_asset_lines}

Some uploaded images may be reference screenshots, while others may be assets
such as logos, product photos, icons, backgrounds, or illustrations. Decide
which uploaded images should be used as assets in the generated code.

If you decide one or more uploaded images should be used as assets, call
save_assets with their asset IDs in the asset_ids list before writing or editing
code, then use the returned permanent public_url values in the code. Do not
embed asset IDs, temporary paths, or temporary URLs in the final code. Do not use
screenshots or reference UI images as page assets unless the user clearly
intends that. If you decide to use some uploaded images as assets, in your final message
make sure to mention that concisely.
"""


def _build_design_source_asset_block(prompt: UserTurnInput) -> str:
    assets = prompt.get("source_assets", [])
    lines: list[str] = []
    for asset in assets:
        # Only backend-owned durable assets are allowed into this instruction.
        # A caller cannot smuggle an arbitrary external URL into generated code.
        if local_asset_url_to_bytes(asset["url"]) is None:
            continue
        lines.append(
            f"- `{asset['name']}` ({asset['mime_type']}, "
            f"{asset['source']} {asset['kind']}): `{asset['url']}`"
        )
    if not lines:
        return ""
    joined = "\n".join(lines)
    return f"""

## Imported design-source assets

These assets came from the user's Figma design, Google Stitch screen, or GitHub
repository and are already persisted by shot2code:

{joined}

Reuse these exact URLs directly in the generated project when they match the
design. Do not invent replacements for an imported logo, illustration or
photograph. Keep the URLs unchanged so Preview, History, chat refinements and
project export can continue to resolve the same local files.
"""


def append_uploaded_asset_ids_to_prompt(
    prompt: UserTurnInput,
    asset_base_url: str,
) -> UserTurnInput:
    prompt_with_assets = deepcopy(prompt)
    block = _build_asset_id_block(prompt_with_assets.get("images", []), asset_base_url)
    if block:
        prompt_with_assets["text"] = f"{prompt_with_assets.get('text', '')}\n\n{block}".strip()
    design_asset_block = _build_design_source_asset_block(prompt_with_assets)
    if design_asset_block:
        prompt_with_assets["text"] = (
            f"{prompt_with_assets.get('text', '')}\n\n{design_asset_block}".strip()
        )
    return prompt_with_assets


def append_uploaded_asset_ids_to_history(
    history: list[PromptHistoryMessage],
    asset_base_url: str,
) -> list[PromptHistoryMessage]:
    history_with_assets = deepcopy(history)
    for item in history_with_assets:
        if item["role"] != "user":
            continue
        block = _build_asset_id_block(item.get("images", []), asset_base_url)
        if block:
            item["text"] = f"{item.get('text', '')}\n\n{block}".strip()
    return history_with_assets
