import asyncio
import threading
import time
from types import SimpleNamespace

import pytest

import copilot_auth


@pytest.mark.asyncio
async def test_probe_does_not_publish_auth_before_models_finish(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    list_started = threading.Event()
    release_list = threading.Event()

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
            release_list.wait(timeout=1)
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
    assert await asyncio.to_thread(list_started.wait, 0.5)

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
            token = kwargs.get("github_token")
            received_tokens.append(token if isinstance(token, str) else None)

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


@pytest.mark.asyncio
async def test_probe_times_out_and_stops_hanging_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stopped = threading.Event()

    class HangingClient:
        def __init__(self, **_: object) -> None:
            pass

        async def start(self) -> None:
            await asyncio.Event().wait()

        async def stop(self) -> None:
            stopped.set()

    monkeypatch.setattr(copilot_auth.copilot, "CopilotClient", HangingClient)
    monkeypatch.setattr(copilot_auth, "COPILOT_PROBE_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(copilot_auth, "_cached_available", None)
    monkeypatch.setattr(copilot_auth, "_cached_login", None)
    monkeypatch.setattr(copilot_auth, "_cached_models", [])

    assert await copilot_auth.probe_copilot_auth(force=True) is False
    assert stopped.is_set()
    assert copilot_auth.copilot_models() == []


@pytest.mark.asyncio
async def test_copilot_probe_cannot_block_the_api_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(copilot_auth, "_cached_available", None)
    monkeypatch.setattr(copilot_auth, "_cached_login", None)
    monkeypatch.setattr(copilot_auth, "_cached_models", [])

    def blocking_probe(
        _github_token: str | None,
        *,
        use_logged_in_user: bool,
    ) -> copilot_auth.CopilotAuthSnapshot:
        assert use_logged_in_user is True
        time.sleep(0.1)
        return copilot_auth.CopilotAuthSnapshot(
            available=False,
            login=None,
            models=[],
        )

    monkeypatch.setattr(
        copilot_auth,
        "_inspect_copilot_sync",
        blocking_probe,
    )

    probe = asyncio.create_task(copilot_auth.probe_copilot_auth(force=True))
    before = time.perf_counter()
    await asyncio.sleep(0.02)
    elapsed = time.perf_counter() - before

    assert elapsed < 0.08
    assert probe.done() is False
    assert await probe is False
