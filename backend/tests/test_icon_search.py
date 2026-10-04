"""Release-quality coverage for the opt-in Iconify design add-on."""

from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

import httpx
import pytest

import icon_search.iconify as iconify_module
import icon_search.sanitize as sanitize_module

from agent.providers.anthropic import AnthropicProviderSession, serialize_anthropic_tools
from agent.providers.factory import create_provider_session
from agent.providers.gemini import GeminiProviderSession, serialize_gemini_tools
from agent.providers.github_copilot import CopilotProviderSession, serialize_copilot_tools
from agent.providers.openai import OpenAIProviderSession, serialize_openai_tools
from agent.state import AgentFileState
from agent.tools.definitions import canonical_tool_definitions
from agent.tools.runtime import AgentToolRuntime
from agent.tools.summaries import summarize_tool_input
from agent.tools.types import ToolCall
from icon_search.config import (
    ACCESS_CHECKED,
    ACCESS_NOTE,
    ICONIFY_API_ORIGIN,
    MAX_ICONS,
    MAX_REDIRECTS,
    PERMISSIVE_LICENSES,
    THIRD_PARTY_METADATA_WARNING,
    TRADEMARK_WARNING,
    IconSearchConfigError,
    IconSearchSettings,
    is_permissive_license,
    parse_icon_search_settings,
)
from icon_search.iconify import (
    IconifyError,
    create_iconify_client,
    fetch_icon_svg,
    normalize_search_payload,
    search_icon_candidates,
)
from icon_search.sanitize import SvgRejected, sanitize_svg
from icon_search.tool import (
    ICON_SEARCH_TOOL_NAME,
    IconSearchRuntime,
    clamp_count,
    clamp_query,
    icon_search_tool_definition,
    summarize_icon_search_input,
)
from integrations.config import parse_integration_settings
from llm import Llm

SAFE_SVG = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<path fill="currentColor" d="M3 3h18v18H3z"/></svg>'''
HOSTILE_SVG = b'''<svg xmlns="http://www.w3.org/2000/svg"
 xmlns:xlink="http://www.w3.org/1999/xlink" onload="steal()" viewBox="0 0 24 24">
 <style>@import url(https://evil.test/x.css); path{fill:url(https://evil.test/a)}</style>
 <script>alert(1)</script><foreignObject><div>bad</div></foreignObject>
 <animate attributeName="x"/><image href="https://evil.test/a.png"/>
 <use xlink:href="https://evil.test/a.svg#x"/>
 <path onclick="steal()" filter="url(https://evil.test/f)" fill="currentColor" d="M1 1h10v10H1z"/>
 <path fill="u\\72l(https://evil.test/escaped)" d="M2 2h2v2H2z"/>
</svg>'''


def collection(
    *,
    name: str = "Lucide",
    author: str = "Lucide Contributors",
    spdx: str = "ISC",
    license_title: str = "ISC",
    category: str = "UI 24px",
) -> dict[str, Any]:
    return {
        "name": name,
        "author": {"name": author, "url": "https://github.com/lucide-icons/lucide"},
        "license": {
            "title": license_title,
            "spdx": spdx,
            "url": "https://github.com/lucide-icons/lucide/blob/main/LICENSE",
        },
        "category": category,
        "tags": ["Uses Stroke"],
    }


def search_payload() -> dict[str, Any]:
    return {
        "icons": [
            "lucide:home",
            "solar:home-linear",
            "simple-icons:github",
            "lucide:house",
        ],
        "collections": {
            "lucide": collection(),
            "solar": collection(
                name="Solar", spdx="CC-BY-4.0", license_title="CC BY 4.0"
            ),
            "simple-icons": collection(
                name="Simple Icons",
                author="Simple Icons Collaborators",
                spdx="CC0-1.0",
                license_title="CC0 1.0",
                category="Logos",
            ),
        },
    }


def handler(requests: list[httpx.Request], svg: bytes = HOSTILE_SVG):
    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/search":
            return httpx.Response(200, json=search_payload())
        return httpx.Response(
            200, content=svg, headers={"content-type": "image/svg+xml; charset=utf-8"}
        )

    return respond


def tool_names(session: object) -> list[str]:
    raw = getattr(session, "_tools", None)
    if raw is None:
        raw = getattr(session, "_tool_definitions", [])
    names: list[str] = []
    for entry in cast(list[Any], raw):
        declarations = getattr(entry, "function_declarations", None)
        if declarations:
            names.extend(str(item.name) for item in cast(Any, declarations))
        elif isinstance(entry, dict):
            names.append(str(entry.get("name")))
        else:
            names.append(str(getattr(entry, "name", "")))
    return names


def session_for(model: Llm, **overrides: object):
    kwargs: dict[str, object] = {
        "model": model,
        "prompt_messages": [{"role": "user", "content": "Build a page."}],
        "should_generate_images": False,
        "openai_api_key": "sk-openai",
        "openai_base_url": None,
        "anthropic_api_key": "sk-anthropic",
        "gemini_api_key": "gemini-key",
        "replicate_api_key": None,
    }
    kwargs.update(overrides)
    return create_provider_session(**kwargs)  # pyright: ignore[reportArgumentType]


# Consent, wording and schema

def test_icon_search_is_off_by_default_and_request_parsing_is_strict() -> None:
    assert parse_icon_search_settings({}).enabled is False
    assert parse_icon_search_settings({"iconSearch": {"enabled": True}}).is_usable
    with pytest.raises(IconSearchConfigError):
        parse_icon_search_settings({"iconSearch": "yes"})
    with pytest.raises(IconSearchConfigError):
        parse_icon_search_settings({"iconSearch": {"enabled": "yes"}})


def test_keyless_wording_is_scoped_and_changeable() -> None:
    lowered = ACCESS_NOTE.lower()
    assert "currently" in lowered
    assert "without an account or api key" in lowered
    assert "can change" in lowered
    assert ACCESS_CHECKED in ACCESS_NOTE
    for phrase in ("permanently free", "always free", "free forever", "unlimited"):
        assert phrase not in lowered


def test_tool_schema_and_summary_are_bounded_and_secret_safe() -> None:
    definition = icon_search_tool_definition()
    assert definition.name == ICON_SEARCH_TOOL_NAME
    assert definition.parameters["required"] == ["query"]
    assert definition.parameters["properties"]["count"]["maximum"] == MAX_ICONS
    assert "@iconify/react" in definition.description
    assert "never hotlink" in definition.description
    summary = summarize_icon_search_input(
        {"query": "  rounded   home ", "count": 99, "authorization": "secret"}
    )
    assert summary == {"query": "rounded home", "count": MAX_ICONS}
    assert "secret" not in repr(summary)
    assert summarize_tool_input(
        ToolCall(
            id="t",
            name=ICON_SEARCH_TOOL_NAME,
            arguments={"query": "home", "count": 2, "token": "secret"},
        ),
        AgentFileState(),
    ) == {"query": "home", "count": 2}


def test_query_and_count_are_clamped() -> None:
    assert clamp_query("  upload\n cloud ") == "upload cloud"
    assert len(clamp_query("x" * 500)) == 100
    assert clamp_count(999) == MAX_ICONS
    assert clamp_count(True) == 4


# Licence filtering and provenance

def test_only_documented_permissive_spdx_licenses_are_allowed() -> None:
    for license_id in PERMISSIVE_LICENSES:
        assert is_permissive_license(license_id)
    for license_id in ("GPL-3.0", "MPL-2.0", "OFL-1.1", "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", ""):
        assert not is_permissive_license(license_id)


def test_search_metadata_filters_non_permissive_sets_and_marks_brands() -> None:
    candidates, excluded = normalize_search_payload(search_payload())
    assert [item.icon_id for item in candidates] == [
        "lucide:home",
        "simple-icons:github",
        "lucide:house",
    ]
    assert candidates[0].collection.license.spdx == "ISC"
    assert candidates[1].collection.is_brand is True
    assert excluded == [
        {"collection": "Solar", "prefix": "solar", "license": "CC-BY-4.0"}
    ]
    assert candidates[0].source_url == "https://api.iconify.design/lucide/home.svg"


# Fixed origin and bounded network behavior

@pytest.mark.asyncio
async def test_client_uses_only_fixed_origin_and_sends_no_auth_or_cookie() -> None:
    requests: list[httpx.Request] = []
    client = create_iconify_client(httpx.MockTransport(handler(requests, SAFE_SVG)))
    try:
        candidates, _ = await search_icon_candidates("home", client=client)
    finally:
        await client.aclose()
    assert candidates
    assert len(requests) == 1
    request = requests[0]
    assert f"{request.url.scheme}://{request.url.host}" == ICONIFY_API_ORIGIN
    assert request.url.path == "/search"
    assert request.url.params["limit"] == "32"
    assert "authorization" not in request.headers
    assert "cookie" not in request.headers
    assert MAX_REDIRECTS == 0


@pytest.mark.asyncio
async def test_response_cookies_are_cleared_before_svg_downloads() -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/search":
            return httpx.Response(
                200,
                json=search_payload(),
                headers={"set-cookie": "tracking=not-forwarded; Path=/"},
            )
        return httpx.Response(
            200, content=SAFE_SVG, headers={"content-type": "image/svg+xml"}
        )

    client = create_iconify_client(httpx.MockTransport(respond))
    try:
        candidates, _ = await search_icon_candidates("home", client=client)
        await fetch_icon_svg(candidates[0], client=client)
    finally:
        await client.aclose()

    assert len(requests) == 2
    assert all("cookie" not in request.headers for request in requests)
    assert all("authorization" not in request.headers for request in requests)


@pytest.mark.asyncio
async def test_redirects_are_refused_instead_of_followed() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(302, headers={"location": "https://evil.test/x"})
    )
    client = create_iconify_client(transport)
    try:
        with pytest.raises(IconifyError) as raised:
            await search_icon_candidates("home", client=client)
    finally:
        await client.aclose()
    assert raised.value.code == "redirect_refused"


# SVG hostile-input boundary

def provenance() -> dict[str, object]:
    return {
        "icon": "home",
        "collection": "Lucide",
        "collection_prefix": "lucide",
        "author": "Lucide Contributors",
        "author_url": "https://github.com/lucide-icons/lucide",
        "source_url": "https://api.iconify.design/lucide/home.svg",
        "license_spdx": "ISC",
        "license_name": "ISC",
        "license_url": "https://github.com/lucide-icons/lucide/blob/main/LICENSE",
        "license_notice": (
            "Lucide by Lucide Contributors; ISC; source and licence retained."
        ),
        "retrieved_at": "2026-10-04",
    }


def test_hostile_svg_is_inert_and_keeps_provenance() -> None:
    sanitized = sanitize_svg(HOSTILE_SVG, provenance())
    root = ET.fromstring(sanitized)
    names = {element.tag.rsplit("}", 1)[-1].lower() for element in root.iter()}
    assert not ({"script", "foreignobject", "animate", "image", "style", "use"} & names)
    for element in root.iter():
        for raw_name, value in element.attrib.items():
            name = raw_name.rsplit("}", 1)[-1].lower()
            assert not name.startswith("on")
            assert "evil.test" not in value
            assert "javascript:" not in value.lower()
    metadata = next(
        element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "metadata"
    )
    assert metadata.attrib["id"] == "shot2code-iconify-provenance"
    assert '"license_spdx":"ISC"' in (metadata.text or "")
    assert '"retrieved_at":"2026-10-04"' in (metadata.text or "")
    description = next(
        element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "desc"
    )
    assert description.attrib["id"] == "shot2code-iconify-license-notice"
    assert "Lucide Contributors" in (description.text or "")


def test_entities_and_non_svg_documents_are_rejected() -> None:
    with pytest.raises(SvgRejected) as entity:
        sanitize_svg(b'<!DOCTYPE svg [<!ENTITY x "boom">]><svg>&x;</svg>', provenance())
    assert entity.value.code == "xml_entity"
    with pytest.raises(SvgRejected):
        sanitize_svg(b"<html><p>no</p></html>", provenance())
    with pytest.raises(SvgRejected) as instruction:
        sanitize_svg(b"<?unsafe run?><svg><path d='M0 0'/></svg>", provenance())
    assert instruction.value.code == "active_content"


def test_svg_byte_and_decoded_character_limits_are_enforced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sanitize_module, "MAX_SVG_BYTES", 8)
    with pytest.raises(SvgRejected) as raw_limit:
        sanitize_svg(SAFE_SVG, provenance())
    assert raw_limit.value.code == "too_large"

    monkeypatch.setattr(sanitize_module, "MAX_SVG_BYTES", 1_000_000)
    monkeypatch.setattr(sanitize_module, "MAX_SVG_CHARS", 10)
    with pytest.raises(SvgRejected) as decoded_limit:
        sanitize_svg(SAFE_SVG, provenance())
    assert decoded_limit.value.code == "too_large"


@pytest.mark.asyncio
async def test_search_response_byte_limit_is_enforced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(iconify_module, "MAX_SEARCH_RESPONSE_BYTES", 8)
    client = create_iconify_client(
        httpx.MockTransport(lambda request: httpx.Response(200, json=search_payload()))
    )
    try:
        with pytest.raises(IconifyError) as raised:
            await search_icon_candidates("home", client=client)
    finally:
        await client.aclose()
    assert raised.value.code == "too_large"


# Every runtime and local persistence

@pytest.mark.parametrize(
    ("model", "session_type"),
    [
        (Llm.GPT_5_6_SOL_HIGH, OpenAIProviderSession),
        (Llm.CLAUDE_OPUS_5_MAX, AnthropicProviderSession),
        (Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL, GeminiProviderSession),
        (Llm.COPILOT_GPT_5_6_SOL, CopilotProviderSession),
    ],
)
def test_every_native_runtime_receives_search_icons(model: Llm, session_type: type) -> None:
    session = session_for(
        model,
        icon_search=IconSearchSettings(enabled=True),
        copilot_github_token="github_pat_test",
    )
    assert isinstance(session, session_type)
    assert ICON_SEARCH_TOOL_NAME in tool_names(session)


def test_disabled_icon_search_is_not_advertised() -> None:
    session = session_for(Llm.GPT_5_6_SOL_HIGH)
    assert ICON_SEARCH_TOOL_NAME not in tool_names(session)
    assert ICON_SEARCH_TOOL_NAME not in {
        item.name for item in canonical_tool_definitions()
    }


def test_copilot_byok_receives_search_icons() -> None:
    settings = parse_integration_settings(
        {
            "copilotSdkByok": {
                "enabled": True,
                "provider": "openai",
                "baseUrl": "https://api.openai.com/v1",
                "apiKey": "sk-byok",
            }
        }
    )
    session = session_for(
        Llm.GPT_5_6_SOL_HIGH,
        integrations=settings,
        byok_connection=settings.usable_byok,
        icon_search=IconSearchSettings(enabled=True),
    )
    assert isinstance(session, CopilotProviderSession)
    assert ICON_SEARCH_TOOL_NAME in tool_names(session)


def test_all_provider_serializers_keep_the_canonical_tool() -> None:
    tool = next(
        item
        for item in canonical_tool_definitions(icon_search_enabled=True)
        if item.name == ICON_SEARCH_TOOL_NAME
    )
    assert serialize_openai_tools([tool])[0]["name"] == ICON_SEARCH_TOOL_NAME
    assert serialize_anthropic_tools([tool])[0]["name"] == ICON_SEARCH_TOOL_NAME
    declarations = serialize_gemini_tools([tool])[0].function_declarations
    assert declarations and declarations[0].name == ICON_SEARCH_TOOL_NAME
    assert serialize_copilot_tools([tool])[0].name == ICON_SEARCH_TOOL_NAME


@pytest.mark.asyncio
async def test_icons_are_sanitized_and_persisted_with_deterministic_safe_names(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    requests: list[httpx.Request] = []
    icon_runtime = IconSearchRuntime(
        settings=IconSearchSettings(enabled=True),
        transport=httpx.MockTransport(handler(requests)),
    )
    runtime = AgentToolRuntime(
        file_state=AgentFileState(),
        should_generate_images=False,
        openai_api_key=None,
        openai_base_url=None,
        asset_base_url="http://127.0.0.1:7001",
        icon_search=icon_runtime,
    )
    result = await runtime.execute(
        ToolCall(
            id="icon-call",
            name=ICON_SEARCH_TOOL_NAME,
            arguments={"query": "home", "count": 2},
        )
    )
    assert result.ok is True
    assert result.multimodal_parts is None
    assert result.result["found"] == 2
    assert result.result["metadata_warning"] == THIRD_PARTY_METADATA_WARNING
    assert result.result["trademark_warning"] == TRADEMARK_WARNING
    icons = result.result["icons"]
    assert [item["id"] for item in icons] == ["lucide:home", "simple-icons:github"]
    assert icons[1]["brand_or_trademark"] is True
    for item in icons:
        assert item["url"].startswith("http://127.0.0.1:7001/local-assets/")
        filename = Path(urlsplit(item["url"]).path).name
        assert filename.startswith("iconify-")
        assert filename.endswith(".svg")
        assert ".." not in filename and "/" not in filename and "\\" not in filename
        saved = (tmp_path / filename).read_bytes()
        assert b"shot2code-iconify-provenance" in saved
        assert b"shot2code-iconify-license-notice" in saved
        assert b"evil.test" not in saved
        assert b"<script" not in saved.lower()
        assert item["source_url"].startswith(ICONIFY_API_ORIGIN)
        assert item["license_spdx"] in PERMISSIVE_LICENSES
        assert item["retrieved_at"]
    assert all(request.url.host == "api.iconify.design" for request in requests)

    repeat = await runtime.execute(
        ToolCall(
            id="icon-call-repeat",
            name=ICON_SEARCH_TOOL_NAME,
            arguments={"query": "home", "count": 1},
        )
    )
    assert repeat.result["icons"][0]["url"] == icons[0]["url"]


@pytest.mark.asyncio
async def test_budget_and_disabled_runtime_fail_explicitly() -> None:
    runtime = IconSearchRuntime(settings=IconSearchSettings(enabled=True))
    runtime.budget.used_this_turn = runtime.budget.per_turn
    outcome = await runtime.execute({"query": "home"})
    assert outcome.result["error_code"] == "budget_exhausted"
    runtime.start_turn()
    assert runtime.budget.exhausted_reason() is None

    bridge = AgentToolRuntime(
        file_state=AgentFileState(),
        should_generate_images=False,
        openai_api_key=None,
        openai_base_url=None,
    )
    result = await bridge.execute(
        ToolCall(id="t", name=ICON_SEARCH_TOOL_NAME, arguments={"query": "home"})
    )
    assert result.ok is False
    assert result.result["error_code"] == "not_enabled"