import pytest

import preview_screenshot
from routes.capabilities import get_capabilities


@pytest.mark.asyncio
async def test_capabilities_reports_screenshot_preview_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_copilot_probe(force: bool = False) -> bool:
        return False

    monkeypatch.setattr(
        "routes.capabilities.probe_copilot_auth",
        fake_copilot_probe,
    )
    monkeypatch.setattr(
        "routes.capabilities.is_screenshot_preview_available",
        lambda: True,
    )

    result = await get_capabilities()
    assert result.screenshot_preview is True


@pytest.mark.asyncio
async def test_capabilities_reports_screenshot_preview_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_copilot_probe(force: bool = False) -> bool:
        return False

    monkeypatch.setattr(
        "routes.capabilities.probe_copilot_auth",
        fake_copilot_probe,
    )
    monkeypatch.setattr(
        "routes.capabilities.is_screenshot_preview_available",
        lambda: False,
    )

    result = await get_capabilities()
    assert result.screenshot_preview is False


@pytest.mark.asyncio
async def test_capabilities_refreshes_optional_screenshot_probe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refreshed: list[bool] = []

    async def fake_copilot_probe(force: bool = False) -> bool:
        return False

    async def fake_screenshot_probe(force: bool = False) -> bool:
        refreshed.append(force)
        return True

    monkeypatch.setattr(
        "routes.capabilities.probe_copilot_auth",
        fake_copilot_probe,
    )
    monkeypatch.setattr(
        "routes.capabilities.probe_screenshot_preview",
        fake_screenshot_probe,
    )
    monkeypatch.setattr(
        "routes.capabilities.is_screenshot_preview_available",
        lambda: True,
    )

    result = await get_capabilities(refresh=True)

    assert result.screenshot_preview is True
    assert refreshed == [True]
