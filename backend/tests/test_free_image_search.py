"""``search_free_images``: licence policy, gating, and hostile-input handling.

Three promises are under test.

**It costs nothing and needs nothing.** The tool must be usable on a machine
with no Replicate, Cloudflare or OpenAI-compatible credential at all, and
configuring one of those must not switch it off or re-route it.

**What it returns is genuinely free to use.** Only CC0 and the Public Domain
Mark, re-checked here rather than trusted from the server, so an exported
project cannot inherit an attribution, share-alike or non-commercial
obligation. Credit metadata still travels with every image, with the standing
warning that Openverse aggregates other people's metadata.

**Nothing it fetches is trusted.** Every URL came from a third-party index
describing a fourth party's server, so the download path is tested against
SSRF, redirects, content-type lies and size bombs.
"""

import base64
from pathlib import Path
from typing import Any

import httpx
import pytest

from agent.state import AgentFileState
from agent.tools.definitions import canonical_tool_definitions
from agent.tools.runtime import AgentToolRuntime
from agent.tools.summaries import summarize_tool_input
from agent.tools.types import ToolCall
from free_images import download as download_module
from free_images.config import (
    ALLOWED_LICENSES,
    EGRESS_NOTICE,
    MAX_IMAGES,
    OPENVERSE_ACCESS_CHECKED,
    OPENVERSE_ACCESS_NOTE,
    OPENVERSE_IMAGE_SEARCH_URL,
    VERIFY_METADATA_WARNING,
    FreeImageConfigError,
    FreeImageSearchSettings,
    is_allowed_license,
    license_label,
    parse_free_image_settings,
)
from free_images.download import (
    ImageDownloadRejected,
    clean_filename,
    download_image,
    is_blocked_address,
    sniff_image_mime,
    validate_image_url,
)
from free_images.openverse import (
    OpenverseError,
    build_search_params,
    normalize_result,
    normalize_results,
    search_images,
)
from free_images.tool import (
    FREE_IMAGE_SEARCH_TOOL_NAME,
    FreeImageSearchRuntime,
    clamp_count,
    clamp_orientation,
    clamp_query,
    free_image_search_tool_definition,
    summarize_free_image_input,
)
from image_generation.settings import ImageGenerationSettings

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
GIF_BYTES = b"GIF89a" + b"\x00" * 64


def openverse_record(**overrides: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": "abc-123",
        "title": "Mountain at dawn",
        "creator": "Pat Dryburgh",
        "url": "https://live.staticflickr.com/8221/mountain.jpg",
        "foreign_landing_url": "https://www.flickr.com/photos/7544495@N02/8339296677",
        "license": "cc0",
        "license_version": "1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "provider": "flickr",
        "source": "flickr",
        "width": 1024,
        "height": 683,
        "thumbnail": "https://api.openverse.org/v1/images/abc-123/thumb/",
        "attribution": '"Mountain at dawn" by Pat Dryburgh is marked CC0 1.0.',
    }
    record.update(overrides)
    return record


def transport(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# --------------------------------------------------------------------------- #
# Gating: keyless, opt-in, additive
# --------------------------------------------------------------------------- #


def test_it_is_off_until_the_user_asks_for_it() -> None:
    assert FreeImageSearchSettings().enabled is False
    assert FreeImageSearchSettings().is_usable is False
    assert parse_free_image_settings({}).enabled is False
    assert parse_free_image_settings({"freeImageSearch": {}}).enabled is False


def test_enabling_it_needs_no_credential_of_any_kind() -> None:
    settings = parse_free_image_settings({"freeImageSearch": {"enabled": True}})
    assert settings.is_usable is True
    assert settings.unusable_reason is None
    # Nothing secret to describe, so describe() is safe to log verbatim.
    assert settings.describe() == {
        "enabled": True,
        "provider": "openverse",
        "licenses": ["cc0", "pdm"],
    }


def test_openverse_access_is_attributed_scoped_and_changeable() -> None:
    """The same rule every provider's copy follows: no permanent free tier.

    Openverse currently answers anonymous requests, and its own headers
    advertise the limits quoted here - but that is Openverse's allowance on
    Openverse's terms, not something shot2code can promise.
    """
    note = OPENVERSE_ACCESS_NOTE
    lowered = note.lower()
    assert "openverse" in lowered
    assert "currently" in lowered
    assert "20 requests a minute" in lowered
    assert "200 a day" in lowered
    assert "set by openverse" in lowered
    assert "can change" in lowered
    assert OPENVERSE_ACCESS_CHECKED in note
    for phrase in ("free forever", "always free", "unlimited", "permanently free"):
        assert phrase not in lowered


def test_the_egress_notice_claims_nothing_about_permanence() -> None:
    lowered = EGRESS_NOTICE.lower()
    assert "api.openverse.org" in lowered
    # shot2code can honestly promise what *it* does; not what Openverse will.
    assert "no charge of its own" in lowered
    assert "no credential" in lowered
    for phrase in ("free forever", "always free", "unlimited", "no payment is"):
        assert phrase not in lowered


def test_a_malformed_block_is_reported_not_ignored() -> None:
    with pytest.raises(FreeImageConfigError):
        parse_free_image_settings({"freeImageSearch": "yes"})
    with pytest.raises(FreeImageConfigError):
        parse_free_image_settings({"freeImageSearch": {"enabled": "yes"}})


def test_the_tool_is_offered_with_zero_image_provider_credentials() -> None:
    """The whole point: no Replicate, no Cloudflare, no endpoint, still usable."""
    images = ImageGenerationSettings(replicate_api_key=None)
    assert images.has_generation_credential is False

    names = {
        definition.name
        for definition in canonical_tool_definitions(
            image_generation_enabled=False,
            image_editing_enabled=False,
            background_removal_enabled=False,
            asset_extraction_enabled=False,
            screenshot_enabled=False,
            free_image_search_enabled=True,
        )
    }
    assert FREE_IMAGE_SEARCH_TOOL_NAME in names
    # And generate_images is genuinely absent, so nothing was re-routed.
    assert "generate_images" not in names


def test_it_coexists_with_a_paid_provider_rather_than_replacing_it() -> None:
    names = {
        definition.name
        for definition in canonical_tool_definitions(
            image_generation_enabled=True,
            free_image_search_enabled=True,
        )
    }
    assert {"generate_images", FREE_IMAGE_SEARCH_TOOL_NAME} <= names


def test_it_is_not_advertised_when_the_user_left_it_off() -> None:
    names = {
        definition.name
        for definition in canonical_tool_definitions(free_image_search_enabled=False)
    }
    assert FREE_IMAGE_SEARCH_TOOL_NAME not in names


def test_it_is_a_distinct_tool_from_web_search_and_generation() -> None:
    definition = free_image_search_tool_definition()
    assert definition.name == "search_free_images"
    assert definition.name not in {"generate_images", "search_web", "web_search"}


def test_the_schema_is_bounded_and_typed() -> None:
    schema = free_image_search_tool_definition().parameters
    properties = schema["properties"]
    assert schema["required"] == ["query"]
    assert properties["count"]["minimum"] == 1
    assert properties["count"]["maximum"] == MAX_IMAGES
    assert set(properties["orientation"]["enum"]) == {
        "any",
        "landscape",
        "portrait",
        "square",
    }
    assert set(properties) == {"query", "count", "orientation"}


def test_the_description_tells_the_model_when_to_prefer_it() -> None:
    description = free_image_search_tool_definition().description
    assert "generate_images" in description
    assert "public domain" in description.lower()
    # It must tell the model to use the local URL, never the original site.
    assert "never link to the original" in description.lower()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, 2), (0, 1), (99, MAX_IMAGES), (3, 3), (True, 2), ("4", 2)],
)
def test_count_is_clamped(raw: Any, expected: int) -> None:
    assert clamp_count(raw) == expected


def test_query_is_collapsed_and_bounded() -> None:
    assert clamp_query("  a   lake\n\nat dawn ") == "a lake at dawn"
    assert len(clamp_query("x" * 500)) == 200
    assert clamp_query(None) == ""


def test_orientation_falls_back_rather_than_erroring() -> None:
    assert clamp_orientation("LANDSCAPE") == "landscape"
    assert clamp_orientation("diagonal") == "any"
    assert clamp_orientation(None) == "any"


# --------------------------------------------------------------------------- #
# Streamed arguments carry nothing else
# --------------------------------------------------------------------------- #


def test_streamed_arguments_are_query_count_and_orientation_only() -> None:
    summary = summarize_free_image_input(
        {
            "query": "  mountain lake  ",
            "count": 9,
            "orientation": "landscape",
            "api_key": "sk-should-never-be-here",
            "page_content": "<html>...</html>",
        }
    )
    assert summary == {
        "query": "mountain lake",
        "count": MAX_IMAGES,
        "orientation": "landscape",
    }
    assert "sk-should-never-be-here" not in repr(summary)


def test_the_tool_summariser_routes_this_tool_to_the_allowlist() -> None:
    summary = summarize_tool_input(
        ToolCall(
            id="t",
            name=FREE_IMAGE_SEARCH_TOOL_NAME,
            arguments={"query": "lake", "count": 2, "secret": "nope"},
        ),
        AgentFileState(),
    )
    assert summary == {"query": "lake", "count": 2, "orientation": "any"}


# --------------------------------------------------------------------------- #
# The endpoint, and the licence filter
# --------------------------------------------------------------------------- #


def test_the_endpoint_is_fixed_and_keyless() -> None:
    assert OPENVERSE_IMAGE_SEARCH_URL == "https://api.openverse.org/v1/images/"


def test_every_search_asks_only_for_obligation_free_licences() -> None:
    params = build_search_params("lake")
    assert params["license"] == "cc0,pdm"
    assert params["mature"] == "false"
    assert "by" not in params["license"].split(",")


def test_orientation_is_translated_to_openverses_own_vocabulary() -> None:
    # Openverse answers 400 for "landscape"; its words are wide/tall/square.
    assert build_search_params("x", orientation="landscape")["aspect_ratio"] == "wide"
    assert build_search_params("x", orientation="portrait")["aspect_ratio"] == "tall"
    assert build_search_params("x", orientation="square")["aspect_ratio"] == "square"
    assert "aspect_ratio" not in build_search_params("x", orientation="any")


@pytest.mark.parametrize("code", ["cc0", "pdm", "CC0", " pdm "])
def test_obligation_free_licences_are_accepted(code: str) -> None:
    assert is_allowed_license(code) is True


@pytest.mark.parametrize(
    "code", ["by", "by-sa", "by-nc", "by-nd", "by-nc-sa", "", None, 5]
)
def test_every_other_licence_is_refused(code: Any) -> None:
    assert is_allowed_license(code) is False


def test_a_by_sa_result_is_dropped_even_if_the_server_returns_it() -> None:
    """The server's filter is a hint; this is the enforcement."""
    assert normalize_result(openverse_record(license="by-sa")) is None
    assert normalize_result(openverse_record(license="by-nc")) is None


def test_a_normalized_result_carries_everything_needed_to_verify_it() -> None:
    result = normalize_result(openverse_record())
    assert result is not None
    metadata = result.to_metadata()
    assert metadata["title"] == "Mountain at dawn"
    assert metadata["creator"] == "Pat Dryburgh"
    assert metadata["source_page"].startswith("https://www.flickr.com/")
    assert metadata["provider"] == "flickr"
    assert metadata["license"] == "cc0"
    assert metadata["license_name"] == "CC0 1.0 (public domain dedication)"
    assert metadata["license_url"].startswith("https://creativecommons.org/")


def test_license_labels_are_human_readable() -> None:
    assert "public domain" in license_label("cc0").lower()
    assert "Public Domain Mark" in license_label("pdm")


@pytest.mark.parametrize(
    "missing", ["foreign_landing_url", "license_url", "url", "id"]
)
def test_a_result_that_cannot_be_verified_is_dropped(missing: str) -> None:
    record = openverse_record()
    record[missing] = ""
    assert normalize_result(record) is None


@pytest.mark.parametrize(
    "bad_url",
    [
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        "file:///etc/passwd",
        "ftp://example.com/a.jpg",
    ],
)
def test_a_result_with_a_non_http_image_url_is_dropped(bad_url: str) -> None:
    assert normalize_result(openverse_record(url=bad_url)) is None


def test_duplicate_results_are_collapsed() -> None:
    payload = {"results": [openverse_record(), openverse_record()]}
    assert len(normalize_results(payload)) == 1


def test_a_malformed_payload_yields_nothing_rather_than_raising() -> None:
    assert normalize_results(None) == []
    assert normalize_results({"results": "nope"}) == []
    assert normalize_results({}) == []


# --------------------------------------------------------------------------- #
# Provider errors
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_one_search_is_one_request_to_the_fixed_endpoint() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json={"results": [openverse_record()]})

    async with transport(handler) as client:
        results = await search_images("mountain lake", client=client)

    assert len(calls) == 1
    assert calls[0].startswith("https://api.openverse.org/v1/images/")
    assert "license=cc0%2Cpdm" in calls[0] or "license=cc0,pdm" in calls[0]
    assert len(results) == 1


@pytest.mark.asyncio
async def test_a_429_becomes_retry_guidance() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"retry-after": "45"}, json={})

    async with transport(handler) as client:
        with pytest.raises(OpenverseError) as raised:
            await search_images("lake", client=client)
    assert raised.value.code == "rate_limited"
    assert "45 seconds" in raised.value.message


@pytest.mark.asyncio
async def test_an_exhausted_daily_allowance_says_so() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429, headers={"x-ratelimit-available-anon_sustained": "0"}, json={}
        )

    async with transport(handler) as client:
        with pytest.raises(OpenverseError) as raised:
            await search_images("lake", client=client)
    assert "resets tomorrow" in raised.value.message


@pytest.mark.asyncio
async def test_a_timeout_is_reported_as_a_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    async with transport(handler) as client:
        with pytest.raises(OpenverseError) as raised:
            await search_images("lake", client=client)
    assert raised.value.code == "timeout"


@pytest.mark.parametrize(("status", "code"), [(400, "invalid_request"), (503, "provider_error")])
@pytest.mark.asyncio
async def test_other_statuses_are_classified(status: int, code: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={})

    async with transport(handler) as client:
        with pytest.raises(OpenverseError) as raised:
            await search_images("lake", client=client)
    assert raised.value.code == code


# --------------------------------------------------------------------------- #
# Download: the hostile-input boundary
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "192.168.1.1",
        "172.16.0.1",
        "169.254.169.254",  # cloud metadata
        "100.100.100.200",  # Alibaba metadata
        "192.0.0.192",  # Oracle metadata
        "::1",
        "fd00::1",
        "0.0.0.0",
        "224.0.0.1",
        "not-an-ip",
    ],
)
def test_non_public_addresses_are_blocked(address: str) -> None:
    assert is_blocked_address(address) is True


@pytest.mark.parametrize("address", ["93.184.216.34", "8.8.8.8", "2606:2800:220:1::1"])
def test_public_addresses_are_allowed(address: str) -> None:
    assert is_blocked_address(address) is False


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        "https://user:pass@example.com/a.jpg",
        "",
    ],
)
def test_unsafe_urls_are_refused_before_any_connection(url: str) -> None:
    with pytest.raises(ImageDownloadRejected):
        validate_image_url(url)


def test_a_public_name_resolving_to_a_private_address_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Checking the string is not enough; the resolved address decides."""

    def fake_getaddrinfo(host: str, *args: Any, **kwargs: Any) -> list[Any]:
        return [(2, 1, 6, "", ("169.254.169.254", 0))]

    monkeypatch.setattr(download_module.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ImageDownloadRejected) as raised:
        validate_image_url("https://totally-normal.example.com/a.jpg")
    assert raised.value.code == "blocked_address"


def test_a_name_with_one_private_answer_is_refused_entirely(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A mixed answer is a rebinding attempt, not a slightly odd host."""

    def fake_getaddrinfo(host: str, *args: Any, **kwargs: Any) -> list[Any]:
        return [
            (2, 1, 6, "", ("93.184.216.34", 0)),
            (2, 1, 6, "", ("127.0.0.1", 0)),
        ]

    monkeypatch.setattr(download_module.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ImageDownloadRejected):
        validate_image_url("https://mixed.example.com/a.jpg")


@pytest.fixture
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_getaddrinfo(host: str, *args: Any, **kwargs: Any) -> list[Any]:
        return [(2, 1, 6, "", ("93.184.216.34", 0))]

    monkeypatch.setattr(download_module.socket, "getaddrinfo", fake_getaddrinfo)


@pytest.mark.asyncio
async def test_a_good_image_downloads(public_dns: None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=PNG_BYTES, headers={"content-type": "image/png"}
        )

    async with transport(handler) as client:
        image = await download_image(
            "https://cdn.example.com/photo.png", title="Mountain", client=client
        )
    assert image.data == PNG_BYTES
    assert image.mime_type == "image/png"
    assert image.filename == "mountain.png"


@pytest.mark.asyncio
async def test_a_redirect_is_revalidated_not_followed_blindly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[str] = []

    def fake_getaddrinfo(host: str, *args: Any, **kwargs: Any) -> list[Any]:
        if host == "internal.example.com":
            return [(2, 1, 6, "", ("10.0.0.5", 0))]
        return [(2, 1, 6, "", ("93.184.216.34", 0))]

    monkeypatch.setattr(download_module.socket, "getaddrinfo", fake_getaddrinfo)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(
            302, headers={"location": "https://internal.example.com/secret.png"}
        )

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)

    assert raised.value.code == "blocked_address"
    # The redirect target was never requested.
    assert seen == ["https://cdn.example.com/a.png"]


@pytest.mark.asyncio
async def test_a_redirect_loop_is_bounded(public_dns: None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "/next.png"})

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)
    assert raised.value.code == "bad_redirect"


@pytest.mark.asyncio
async def test_a_non_image_content_type_is_refused(public_dns: None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"<html>hi</html>", headers={"content-type": "text/html"}
        )

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)
    assert raised.value.code == "bad_content_type"


@pytest.mark.asyncio
async def test_bytes_that_are_not_an_image_are_refused_despite_the_header(
    public_dns: None,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"#!/bin/sh\nrm -rf /", headers={"content-type": "image/png"}
        )

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)
    assert raised.value.code == "bad_content_type"


@pytest.mark.asyncio
async def test_a_header_that_disagrees_with_the_bytes_is_refused(
    public_dns: None,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=GIF_BYTES, headers={"content-type": "image/png"}
        )

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)
    assert "said" in raised.value.reason


@pytest.mark.asyncio
async def test_an_oversized_image_is_refused(
    public_dns: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(download_module, "MAX_IMAGE_BYTES", 16)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=PNG_BYTES * 10, headers={"content-type": "image/png"}
        )

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)
    assert raised.value.code == "too_large"


@pytest.mark.asyncio
async def test_a_pixel_bomb_is_refused(
    public_dns: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(download_module, "MAX_IMAGE_PIXELS", 0)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=PNG_BYTES, headers={"content-type": "image/png"}
        )

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)
    assert raised.value.code == "too_large"


@pytest.mark.asyncio
async def test_an_http_error_is_reported(public_dns: None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    async with transport(handler) as client:
        with pytest.raises(ImageDownloadRejected) as raised:
            await download_image("https://cdn.example.com/a.png", client=client)
    assert raised.value.code == "http_error"


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Mountain at dawn", "mountain-at-dawn.png"),
        ("../../etc/passwd", "etc-passwd.png"),
        ("  ", "fallback.png"),
        ("a" * 200, "a" * 64 + ".png"),
        ("Ünïcødé ✨", "n-c-d.png"),
    ],
)
def test_filenames_are_cleaned(title: str, expected: str) -> None:
    assert clean_filename(title, "image/png", "fallback") == expected


def test_mime_sniffing_recognises_the_allowlist() -> None:
    assert sniff_image_mime(PNG_BYTES) == "image/png"
    assert sniff_image_mime(GIF_BYTES) == "image/gif"
    assert sniff_image_mime(b"\xff\xd8\xffxxxx") == "image/jpeg"
    assert sniff_image_mime(b"RIFF\x00\x00\x00\x00WEBPxx") == "image/webp"
    assert sniff_image_mime(b"not an image") is None


# --------------------------------------------------------------------------- #
# End to end through the tool runtime
# --------------------------------------------------------------------------- #


def runtime_with(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AgentToolRuntime:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    return AgentToolRuntime(
        file_state=AgentFileState(),
        should_generate_images=False,
        openai_api_key=None,
        openai_base_url=None,
        asset_base_url="http://127.0.0.1:7001",
        free_image_search=FreeImageSearchRuntime(
            settings=FreeImageSearchSettings(enabled=True)
        ),
    )


def search_and_image_handler(
    *, results: int = 2, image_status: int = 200
) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.openverse.org":
            return httpx.Response(
                200,
                json={
                    "results": [
                        openverse_record(
                            id=f"id-{index}",
                            title=f"Photo {index}",
                            url=f"https://cdn.example.com/{index}.png",
                        )
                        for index in range(results)
                    ]
                },
            )
        if image_status != 200:
            return httpx.Response(image_status)
        return httpx.Response(
            200, content=PNG_BYTES, headers={"content-type": "image/png"}
        )

    return handler


@pytest.mark.asyncio
async def test_found_images_become_local_asset_urls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    runtime = runtime_with(tmp_path, monkeypatch)
    async with transport(search_and_image_handler()) as client:
        assert runtime.free_image_search is not None
        runtime.free_image_search.client = client
        result = await runtime.execute(
            ToolCall(
                id="t",
                name=FREE_IMAGE_SEARCH_TOOL_NAME,
                arguments={"query": "mountain lake", "count": 2},
            )
        )

    assert result.ok is True
    assert result.result["found"] == 2
    assert result.result["message"] == "Found 2 free images."
    for item in result.result["images"]:
        # Local and served: never a link to the original site.
        assert item["url"].startswith("http://127.0.0.1:7001/local-assets/")
        assert "cdn.example.com" not in item["url"]
        assert item["license"] in ALLOWED_LICENSES
        assert item["source_page"].startswith("https://")
    # The model sees the bytes, because a local URL is not model-reachable.
    assert result.multimodal_parts is not None
    assert all(part.data is not None for part in result.multimodal_parts)


@pytest.mark.asyncio
async def test_the_response_carries_the_verify_warning_and_the_egress_notice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    runtime = runtime_with(tmp_path, monkeypatch)
    async with transport(search_and_image_handler(results=1)) as client:
        assert runtime.free_image_search is not None
        runtime.free_image_search.client = client
        result = await runtime.execute(
            ToolCall(
                id="t",
                name=FREE_IMAGE_SEARCH_TOOL_NAME,
                arguments={"query": "lake", "count": 1},
            )
        )
    assert result.result["warning"] == VERIFY_METADATA_WARNING
    assert result.result["egress"] == EGRESS_NOTICE
    assert "commercial" in result.result["warning"]


@pytest.mark.asyncio
async def test_a_partial_batch_is_reported_truthfully(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    runtime = runtime_with(tmp_path, monkeypatch)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.openverse.org":
            return httpx.Response(
                200,
                json={
                    "results": [
                        openverse_record(
                            id=f"id-{i}", url=f"https://cdn.example.com/{i}.png"
                        )
                        for i in range(3)
                    ]
                },
            )
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(404)
        return httpx.Response(
            200, content=PNG_BYTES, headers={"content-type": "image/png"}
        )

    async with transport(handler) as client:
        assert runtime.free_image_search is not None
        runtime.free_image_search.client = client
        result = await runtime.execute(
            ToolCall(
                id="t",
                name=FREE_IMAGE_SEARCH_TOOL_NAME,
                arguments={"query": "lake", "count": 2},
            )
        )

    assert result.ok is True
    assert result.result["found"] == 2
    assert result.result["rejected"][0]["error_code"] == "http_error"


@pytest.mark.asyncio
async def test_finding_nothing_is_a_failure_not_an_empty_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = runtime_with(tmp_path, monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    async with transport(handler) as client:
        assert runtime.free_image_search is not None
        runtime.free_image_search.client = client
        result = await runtime.execute(
            ToolCall(
                id="t",
                name=FREE_IMAGE_SEARCH_TOOL_NAME,
                arguments={"query": "zzzz", "count": 2},
            )
        )

    assert result.ok is False
    assert result.result["found"] == 0
    assert result.result["error_code"] == "no_results"


@pytest.mark.asyncio
async def test_all_downloads_failing_is_a_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    runtime = runtime_with(tmp_path, monkeypatch)
    async with transport(search_and_image_handler(image_status=500)) as client:
        assert runtime.free_image_search is not None
        runtime.free_image_search.client = client
        result = await runtime.execute(
            ToolCall(
                id="t",
                name=FREE_IMAGE_SEARCH_TOOL_NAME,
                arguments={"query": "lake", "count": 2},
            )
        )
    assert result.ok is False
    assert result.result["error_code"] == "download_failed"
    assert result.result["found"] == 0
    assert result.multimodal_parts is None


@pytest.mark.asyncio
async def test_calling_it_when_disabled_explains_rather_than_crashing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    runtime = AgentToolRuntime(
        file_state=AgentFileState(),
        should_generate_images=False,
        openai_api_key=None,
        openai_base_url=None,
    )
    result = await runtime.execute(
        ToolCall(
            id="t", name=FREE_IMAGE_SEARCH_TOOL_NAME, arguments={"query": "lake"}
        )
    )
    assert result.ok is False
    assert result.result["error_code"] == "not_enabled"


@pytest.mark.asyncio
async def test_the_budget_stops_a_runaway_model() -> None:
    runtime = FreeImageSearchRuntime(settings=FreeImageSearchSettings(enabled=True))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    async with transport(handler) as client:
        runtime.client = client
        for _ in range(runtime.budget.per_turn):
            await runtime.execute({"query": "lake"})
        outcome = await runtime.execute({"query": "lake"})

    assert outcome.ok is False
    assert outcome.result["error_code"] == "budget_exhausted"


def test_a_new_turn_restores_the_per_turn_allowance() -> None:
    runtime = FreeImageSearchRuntime(settings=FreeImageSearchSettings(enabled=True))
    runtime.budget.used_this_turn = runtime.budget.per_turn
    assert runtime.budget.exhausted_reason() is not None
    runtime.start_turn()
    assert runtime.budget.exhausted_reason() is None


# --------------------------------------------------------------------------- #
# It is not web search
# --------------------------------------------------------------------------- #


def test_the_free_image_package_never_reaches_for_a_web_search_provider() -> None:
    """A web image result grants no reuse right; this path must not exist.

    Checked against imports and calls rather than prose, so a comment that
    *explains* the distinction does not trip the assertion.
    """
    import ast

    import free_images.download as download_source
    import free_images.openverse as openverse_source
    import free_images.tool as tool_source

    forbidden = {"tavily", "exa", "web_search", "run_provider_search"}
    for module in (openverse_source, download_source, tool_source):
        tree = ast.parse(Path(module.__file__ or "").read_text(encoding="utf-8"))
        imported: set[str] = set()
        called: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.add(node.module or "")
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                called.add(node.func.id)
        for name in imported | called:
            lowered = name.lower()
            assert not any(term in lowered for term in forbidden), (
                f"{module.__name__} references {name}"
            )


def test_only_openverse_hosts_are_contacted_for_search() -> None:
    """The endpoint is a constant, never assembled from a request value."""
    import ast

    import free_images.openverse as openverse_source

    tree = ast.parse(Path(openverse_source.__file__ or "").read_text(encoding="utf-8"))
    literals = {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }
    hosts = {value for value in literals if value.startswith("http://") or value.startswith("https://")}
    # No URL literal in the module points anywhere but Openverse.
    assert all("openverse.org" in host for host in hosts), hosts
    # And no function here takes a base URL to call.
    signatures = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    for function in signatures:
        names = {arg.arg for arg in function.args.args + function.args.kwonlyargs}
        assert "base_url" not in names, function.name
        assert "endpoint" not in names, function.name
