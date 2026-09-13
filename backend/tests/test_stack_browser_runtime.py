import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Iterator

import pytest
from playwright.sync_api import Browser, Page, expect, sync_playwright

from tests.export_stack_fixtures import STACK_FIXTURES
from tests.stack_acceptance_fixtures import (
    STACK_ACCEPTANCE_CASES,
    RuntimeBehavior,
    StackAcceptanceCase,
)


RUN_STACK_E2E = os.environ.get("RUN_STACK_E2E") == "true"
pytestmark = pytest.mark.skipif(
    not RUN_STACK_E2E,
    reason="Set RUN_STACK_E2E=true to execute the external browser acceptance matrix.",
)

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = ROOT / "frontend"


@pytest.fixture(scope="module")
def browser() -> Iterator[Browser]:
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox"],
            )
            yield browser
            browser.close()
    except Exception as exc:
        pytest.skip(f"Playwright Chromium is unavailable: {type(exc).__name__}: {exc}")


def _style(page: Page, selector: str) -> dict[str, str]:
    return page.locator(selector).evaluate(
        """element => {
          const style = getComputedStyle(element);
          return {
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            color: style.color,
            display: style.display,
            fontFamily: style.fontFamily,
            padding: style.padding,
          };
        }"""
    )


def _assert_counter(page: Page) -> None:
    counter = page.get_by_role("button", name="Count 0", exact=True)
    expect(counter).to_be_visible(timeout=45_000)
    counter.click()
    expect(page.get_by_role("button", name="Count 1", exact=True)).to_be_visible()


def _assert_runtime_behavior(page: Page, behavior: RuntimeBehavior) -> None:
    if behavior == "plain-css":
        page.wait_for_function(
            "getComputedStyle(document.body).color === 'rgb(12, 34, 56)'"
        )
        return
    if behavior == "tailwind-style":
        page.wait_for_function(
            """() => {
              const style = getComputedStyle(document.querySelector("main"));
              return style.backgroundColor === "rgb(37, 99, 235)" &&
                style.color === "rgb(255, 255, 255)" &&
                style.padding === "16px";
            }"""
        )
        return
    if behavior in {"react-counter", "vue-counter", "preact-counter"}:
        _assert_counter(page)
        return
    if behavior == "bootstrap-collapse":
        page.get_by_role("button", name="Toggle", exact=True).click()
        expect(page.locator("#fixture-collapse")).to_have_class(
            re.compile(r"(?:^|\s)show(?:\s|$)")
        )
        return
    if behavior == "ionic-hydration":
        page.wait_for_function(
            """() => {
              const button = document.querySelector("ion-button");
              const icon = document.querySelector("ion-icon");
              return customElements.get("ion-button") &&
                customElements.get("ion-icon") &&
                button?.classList.contains("hydrated") &&
                icon?.classList.contains("hydrated") &&
                button.shadowRoot && icon.shadowRoot;
            }"""
        )
        assert page.locator("ion-icon").get_attribute("name") == "add"
        return
    if behavior == "alpine-counter":
        page.wait_for_function(
            "document.querySelector('button span')?.textContent === '0'"
        )
        page.get_by_role("button").click()
        page.wait_for_function(
            "document.querySelector('button span')?.textContent === '1'"
        )
        return
    if behavior == "daisyui-style":
        page.wait_for_function(
            "getComputedStyle(document.querySelector('button')).display === 'inline-flex'"
        )
        style = _style(page, "button")
        assert style["backgroundColor"] not in {"rgba(0, 0, 0, 0)", "transparent"}
        assert style["borderRadius"] != "0px"
        return
    if behavior == "bulma-style":
        page.wait_for_function(
            "getComputedStyle(document.querySelector('button')).display === 'inline-flex'"
        )
        style = _style(page, "button")
        assert style["backgroundColor"] not in {"rgba(0, 0, 0, 0)", "transparent"}
        assert style["padding"] == "8px 16px"
        assert style["borderRadius"] != "0px"
        return
    if behavior == "material-component":
        page.wait_for_function(
            """() => {
              const button = document.querySelector("md-filled-button");
              return customElements.get("md-filled-button") && button?.shadowRoot;
            }"""
        )
        loaded_fonts = page.evaluate(
            """async () => (
              await document.fonts.load('24px "Material Symbols Outlined"', "add")
            ).length"""
        )
        assert loaded_fonts > 0
        assert "Material Symbols Outlined" in _style(page, "md-icon")["fontFamily"]
        assert page.evaluate("document.adoptedStyleSheets.length") > 0
        return
    if behavior == "htmx-action":
        button = page.get_by_role("button", name="htmx", exact=True)
        expect(button).to_be_visible(timeout=45_000)
        button.click()
        expect(page.get_by_role("button", name="Done", exact=True)).to_be_visible()
        return

    raise AssertionError(f"Unhandled browser behavior: {behavior}")


@pytest.mark.parametrize("acceptance", STACK_ACCEPTANCE_CASES, ids=lambda case: case.stack)
def test_stack_runtime_executes_from_file_url(
    acceptance: StackAcceptanceCase,
    browser: Browser,
    tmp_path: Path,
) -> None:
    fixture_path = tmp_path / f"{acceptance.stack}.html"
    fixture_path.write_text(STACK_FIXTURES[acceptance.stack], encoding="utf-8")
    page = browser.new_page()
    page.set_default_timeout(45_000)
    failed_requests: list[str] = []
    page.on(
        "requestfailed",
        lambda request: failed_requests.append(
            f"{request.url}: {request.failure or 'request failed'}"
        ),
    )

    try:
        page.goto(fixture_path.as_uri(), wait_until="domcontentloaded", timeout=45_000)
        _assert_runtime_behavior(page, acceptance.browser_behavior)
        assert page.evaluate("location.protocol") == "file:"
    except Exception as exc:
        details = "; ".join(failed_requests) or "no failed request was reported"
        pytest.fail(f"{acceptance.stack} browser acceptance failed ({details}): {exc}")
    finally:
        page.close()


def _bundle_preview_bridge() -> str:
    node = shutil.which("node")
    vite = FRONTEND_ROOT / "node_modules" / "vite" / "bin" / "vite.js"
    if node is None or not vite.is_file():
        pytest.skip("Node and the installed Vite package are required for preview bridge E2E.")

    script = r'''
import path from "node:path";
import { build } from "vite";

const result = await build({
  configFile: false,
  logLevel: "silent",
  build: {
    write: false,
    minify: false,
    lib: {
      entry: path.resolve("src/lib/preview-bridge.ts"),
      formats: ["iife"],
      name: "Shot2CodePreviewBridge",
    },
  },
});
const outputs = Array.isArray(result) ? result : [result];
const chunk = outputs.flatMap((output) => output.output).find(
  (output) => output.type === "chunk"
);
if (!chunk) throw new Error("Vite emitted no preview bridge chunk");
process.stdout.write(chunk.code);
'''
    completed = subprocess.run(
        [node, "--input-type=module", "-e", script],
        cwd=FRONTEND_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return completed.stdout


def test_sandboxed_preview_bridge_executes_with_opaque_file_origin(
    browser: Browser,
    tmp_path: Path,
) -> None:
    bundle = _bundle_preview_bridge().replace("</script", "<\\/script")
    source = """<!doctype html><html><body>
<button id="target" data-clicked="0" onclick="this.dataset.clicked = String(Number(this.dataset.clicked) + 1)">Select me</button>
</body></html>"""
    nonce = "preview_nonce_1234567890"
    wrapper = f"""<!doctype html><html><body>
<script>{bundle}</script>
<script>
window.__previewMessages = [];
window.addEventListener("message", (event) => window.__previewMessages.push(event.data));
const generated = Shot2CodePreviewBridge.createSandboxedPreviewDocument(
  {json.dumps(source)},
  {json.dumps(nonce)}
);
const frame = document.createElement("iframe");
frame.id = "preview-frame";
frame.setAttribute("sandbox", Shot2CodePreviewBridge.PREVIEW_SANDBOX);
frame.srcdoc = generated.html;
document.body.appendChild(frame);
</script>
</body></html>"""
    wrapper_path = tmp_path / "preview-wrapper.html"
    wrapper_path.write_text(wrapper, encoding="utf-8")

    page = browser.new_page()
    try:
        page.goto(wrapper_path.as_uri(), wait_until="domcontentloaded")
        page.wait_for_function(
            "window.__previewMessages.some((message) => message.type === 'ready')"
        )
        frame = page.frame_locator("#preview-frame")
        button = frame.get_by_role("button", name="Select me", exact=True)
        expect(button).to_be_visible()

        assert frame.locator("html").evaluate("() => location.origin") == "null"
        assert page.locator("#preview-frame").get_attribute("sandbox") == (
            "allow-scripts allow-forms allow-modals allow-downloads"
        )

        page.evaluate(
            """() => document.querySelector("#preview-frame").contentWindow.postMessage({
              channel: "shot2code-preview-v1",
              nonce: "wrong_nonce_1234567890",
              type: "set-select-mode",
              payload: { enabled: true },
            }, "*")"""
        )
        button.click()
        expect(button).to_have_attribute("data-clicked", "1")
        assert not page.evaluate(
            "window.__previewMessages.some((message) => message.type === 'selection')"
        )

        page.evaluate(
            """nonce => document.querySelector("#preview-frame").contentWindow.postMessage({
              channel: "shot2code-preview-v1",
              nonce,
              type: "set-select-mode",
              payload: { enabled: true },
            }, "*")""",
            nonce,
        )
        button.click()
        page.wait_for_function(
            "window.__previewMessages.some((message) => message.type === 'selection')"
        )
        selection = page.evaluate(
            "window.__previewMessages.find((message) => message.type === 'selection')"
        )
        assert selection["nonce"] == nonce
        assert selection["payload"]["tagName"] == "BUTTON"
        assert "Select me" in selection["payload"]["outerHTML"]
        expect(button).to_have_attribute("data-clicked", "1")
    finally:
        page.close()
