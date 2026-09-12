from openai.types.chat import ChatCompletionContentPartParam, ChatCompletionMessageParam

from prompts.prompt_types import MultiImageMode, Stack
from prompts import system_prompt
from prompts.design_system import build_design_system_prompt_block
from prompts.policies import build_selected_stack_policy, build_user_image_policy

def build_image_prompt_messages(
    image_data_urls: list[str],
    stack: Stack,
    text_prompt: str,
    image_generation_enabled: bool,
    design_system: str | None = None,
    multi_image_mode: MultiImageMode | None = None,
) -> list[ChatCompletionMessageParam]:
    image_policy = build_user_image_policy(image_generation_enabled)
    selected_stack = build_selected_stack_policy(stack)
    design_system_block = build_design_system_prompt_block(design_system)
    screenshot_count = len(image_data_urls)
    effective_mode: MultiImageMode | None = (
        multi_image_mode or "pages" if screenshot_count > 1 else None
    )
    multi_screenshot_instruction = ""
    if effective_mode == "pages":
        multi_screenshot_instruction = f"""
The {screenshot_count} screenshots are distinct pages or views.

- Build one navigable route/view for every screenshot, in the same order.
- Screenshot 1, Screenshot 2, etc. must each have a clearly identifiable implementation.
- Include navigation that lets the user reach every view.
- Do not merge the screenshots into one composite page and do not omit any screenshot.
- Before finishing, verify that the output contains exactly {screenshot_count} distinct views.
"""
    elif effective_mode == "responsive":
        multi_screenshot_instruction = f"""
The {screenshot_count} screenshots show the same page at different viewport sizes.

- Build one responsive page, not duplicate pages.
- Infer the breakpoints, wrapping, stacking and visibility changes between screenshots.
- Preserve content and hierarchy consistently across all viewport sizes.
"""
    elif effective_mode == "states":
        multi_screenshot_instruction = f"""
The {screenshot_count} screenshots are sequential states of one interface.

- Build one interface and implement the controls/state needed to move between the states.
- Preserve elements that stay constant and model what appears, disappears or changes.
- The initial state should match Screenshot 1.
"""
    elif effective_mode == "references":
        multi_screenshot_instruction = f"""
Screenshot 1 is the primary target. The other {screenshot_count - 1} screenshot(s)
are supporting references for styling, components and details.

- Build only the primary page.
- Do not create extra pages for the reference screenshots.
- Use references to resolve details that are unclear in Screenshot 1.
"""
    user_prompt = f"""
Generate code for a web page that looks exactly like the provided screenshot(s).

{selected_stack}
{design_system_block}

## Replication instructions

- Make sure the web page looks exactly like the screenshot.
- Use the exact text from the screenshot.
- Since our goal is to make the web page look as close to the screenshot as possible, we need to extract the exact image assets where possible and generate images for the assets that are not extractable.
- Extracting assets can be done with the extract_assets tool. After extracting assets, make sure to inspect the extracted image closely to ensure that it is what we want.
- When available, use edit_images for asset edits such as removing unwanted elements, batching independent edits into one call.
- If an extracted or supplied asset is visibly low-resolution or pixelated and must render larger, upscale it with edit_images—not CSS stretching or generate_images.
- If an asset in the original screenshot is not extractable (for example, occluded by other objects or is the background), when available, use generate_images to create image URLs from prompts (you may pass multiple prompts).

- {image_policy}

## Multiple screenshots

{multi_screenshot_instruction}

- For mobile screenshots, do not include the device frame or browser chrome; focus only on the actual UI mockups.
"""

    # Add additional instructions provided by the user
    if text_prompt.strip():
        user_prompt = f"{user_prompt}\n\nAdditional instructions: {text_prompt}"

    user_content: list[ChatCompletionContentPartParam] = []
    for image_data_url in image_data_urls:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": image_data_url, "detail": "high"},
            }
        )
    user_content.append(
        {
            "type": "text",
            "text": user_prompt,
        }
    )
    return [
        {
            "role": "system",
            "content": system_prompt.SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": user_content,
        },
    ]
