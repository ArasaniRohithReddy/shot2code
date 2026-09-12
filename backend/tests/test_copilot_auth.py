import asyncio
from types import SimpleNamespace

import pytest

import copilot_auth


@pytest.mark.asyncio
async def test_probe_does_not_publish_auth_before_models_finish(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    list_started = asyncio.Event()
    release_list = asyncio.Event()

    class FakeClient:
        def __init__(self, **_: object) -> None:
            pass

        async def start(self) -> None:
            pass

        async def stop(self) -> None:
            pass

        async def get_auth_status(self) -> object:
            return SimpleNamespace(isAuthenticated=True, login="octocat")

        async def list_models(self) -> list[object]:
            list_started.set()
            await release_list.wait()
            return [
                SimpleNamespace(
                    id="vision-model",
                    capabilities=SimpleNamespace(
                        supports=SimpleNamespace(vision=True)
                    ),
                )
            ]

    monkeypatch.setattr(copilot_auth.copilot, "CopilotClient", FakeClient)
    monkeypatch.setattr(copilot_auth, "_cached_available", None)
    monkeypatch.setattr(copilot_auth, "_cached_login", None)
    monkeypatch.setattr(copilot_auth, "_cached_models", [])

    first_probe = asyncio.create_task(copilot_auth.probe_copilot_auth(force=True))
    await list_started.wait()

    second_probe = asyncio.create_task(copilot_auth.probe_copilot_auth())
    await asyncio.sleep(0)
    assert second_probe.done() is False

    release_list.set()
    assert await first_probe is True
    assert await second_probe is True
    assert copilot_auth.copilot_login() == "octocat"
    assert copilot_auth.copilot_models() == [
        {"id": "vision-model", "vision": True}
    ]


@pytest.mark.asyncio
async def test_explicit_token_uses_its_own_model_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received_tokens: list[str | None] = []

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            received_tokens.append(
                kwargs.get("github_token")
                if isinstance(kwargs.get("github_token"), str)
                else None
            )

        async def start(self) -> None:
            pass

        async def stop(self) -> None:
            pass

        async def get_auth_status(self) -> object:
            return SimpleNamespace(isAuthenticated=True, login="token-user")

        async def list_models(self) -> list[object]:
            return [
                SimpleNamespace(
                    id="token-only-model",
                    capabilities=SimpleNamespace(
                        supports=SimpleNamespace(vision=True)
                    ),
                )
            ]

    monkeypatch.setattr(copilot_auth.copilot, "CopilotClient", FakeClient)
    monkeypatch.setattr(copilot_auth, "_token_snapshots", {})

    snapshot = await copilot_auth.get_copilot_snapshot("secret-token")

    assert received_tokens == ["secret-token"]
    assert snapshot.login == "token-user"
    assert snapshot.models == [{"id": "token-only-model", "vision": True}]
