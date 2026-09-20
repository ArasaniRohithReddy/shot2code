"""Two release blockers, pinned so they cannot come back.

1. The key this backend was configured with belongs to the endpoint this
   backend was configured with. A validation request that names its own base
   URL must carry its own credential, or the server would post its key to a
   host the caller chose. The listener test below proves the environment key
   never leaves the machine towards a caller-supplied URL.

2. Starting a GitHub sign-in spawns a process and opens a browser window, so
   it must not be reachable from any page the user happens to have open. CORS
   does not prevent a cross-site POST from being *sent*, so the origin is
   checked before anything runs.
"""

import asyncio
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copilot_login import COPILOT_LOGIN_ARGS, CopilotLoginManager, LoginCommand
from provider_validation import ProviderValidationRequest, validate_provider
from routes import capabilities as capabilities_route
from routes import providers as providers_route

ENV_SENTINEL = "sk-env-sentinel-must-never-leave-this-machine"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch):
    for name in ("OPENAI_API_KEY", "OPENAI_BASE_URL"):
        monkeypatch.delenv(name, raising=False)


class CapturingEndpoint:
    """A loopback listener that records exactly what was sent to it."""

    def __init__(self) -> None:
        self.requests: list[bytes] = []
        self._server: asyncio.AbstractServer | None = None
        self.port = 0

    async def __aenter__(self) -> "CapturingEndpoint":
        async def handle(
            reader: asyncio.StreamReader, writer: asyncio.StreamWriter
        ) -> None:
            try:
                data = await asyncio.wait_for(reader.read(65536), timeout=2)
            except asyncio.TimeoutError:
                data = b""
            self.requests.append(data)
            writer.write(
                b"HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n"
                b"Content-Length: 41\r\n\r\n"
                b'{"error": {"message": "Invalid token"}}\r\n'
            )
            await writer.drain()
            writer.close()

        self._server = await asyncio.start_server(handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_args: object) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    @property
    def transcript(self) -> str:
        return b"".join(self.requests).decode("utf-8", errors="replace")


class TestCallerUrlNeverGetsTheServerKey:
    @pytest.mark.asyncio
    async def test_a_caller_url_without_a_key_is_refused_before_any_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", ENV_SENTINEL)

        async with CapturingEndpoint() as endpoint:
            result = await validate_provider(
                ProviderValidationRequest(
                    provider="openai", base_url=endpoint.base_url
                )
            )

            assert result.ok is False
            assert result.category == "configuration"
            assert "own API key" in result.message
            assert endpoint.requests == [], "nothing may be sent at all"
            assert ENV_SENTINEL not in result.message

    @pytest.mark.asyncio
    async def test_the_environment_key_never_reaches_a_caller_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The listener regression: the sentinel must never appear on the wire."""
        monkeypatch.setenv("OPENAI_API_KEY", ENV_SENTINEL)

        async with CapturingEndpoint() as endpoint:
            await validate_provider(
                ProviderValidationRequest(
                    provider="openai",
                    base_url=endpoint.base_url,
                    api_key="sk-caller-supplied-key",
                )
            )

            assert endpoint.requests, "the caller's own key is allowed through"
            transcript = endpoint.transcript
            assert ENV_SENTINEL not in transcript
            assert "sk-caller-supplied-key" in transcript

    @pytest.mark.asyncio
    async def test_the_environment_key_is_still_used_for_the_servers_own_endpoint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Env-key validation keeps working - with the backend's own base URL."""
        monkeypatch.setenv("OPENAI_API_KEY", ENV_SENTINEL)

        async with CapturingEndpoint() as endpoint:
            monkeypatch.setenv("OPENAI_BASE_URL", endpoint.base_url)

            result = await validate_provider(
                ProviderValidationRequest(provider="openai")
            )

            assert result.category != "configuration", "the key was used"
            assert endpoint.requests
            assert ENV_SENTINEL in endpoint.transcript

    @pytest.mark.asyncio
    async def test_a_caller_url_cannot_override_the_servers_own_endpoint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Even with a configured base URL, a named URL still needs its own key."""
        monkeypatch.setenv("OPENAI_API_KEY", ENV_SENTINEL)
        monkeypatch.setenv("OPENAI_BASE_URL", "https://api.example.com/v1")

        async with CapturingEndpoint() as endpoint:
            result = await validate_provider(
                ProviderValidationRequest(
                    provider="openai", base_url=endpoint.base_url
                )
            )

            assert result.ok is False
            assert result.category == "configuration"
            assert endpoint.requests == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "base_url",
        [
            "http://models.example.org/v1",
            "ftp://models.example.org/v1",
            "https://user:pass@models.example.org/v1",
            "https:///v1",
        ],
    )
    async def test_caller_urls_face_the_same_endpoint_rules_as_byok(
        self, monkeypatch: pytest.MonkeyPatch, base_url: str
    ) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", ENV_SENTINEL)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="openai", base_url=base_url, api_key="sk-caller"
            )
        )

        assert result.ok is False
        assert result.category == "configuration"
        assert ENV_SENTINEL not in result.message

    @pytest.mark.asyncio
    async def test_a_loopback_caller_url_is_allowed_with_its_own_key(
        self,
    ) -> None:
        async with CapturingEndpoint() as endpoint:
            result = await validate_provider(
                ProviderValidationRequest(
                    provider="openai",
                    base_url=endpoint.base_url,
                    api_key="sk-caller",
                )
            )

            assert result.category == "credentials", "it reached the endpoint"
            assert endpoint.requests

    def test_the_route_refuses_a_caller_url_without_a_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", ENV_SENTINEL)
        app = FastAPI()
        app.include_router(providers_route.router)

        response = TestClient(app).post(
            "/api/providers/validate",
            json={"provider": "openai", "baseUrl": "https://models.example.org/v1"},
        )

        body = response.json()
        assert body["ok"] is False
        assert body["category"] == "configuration"
        assert ENV_SENTINEL not in response.text


class FakeProcess:
    def __init__(self) -> None:
        self.returncode: int | None = None
        self.terminated = False
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        await asyncio.Event().wait()
        return (b"", b"")

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 143

    def kill(self) -> None:
        self.killed = True
        self.returncode = 137

    async def wait(self) -> int:
        return self.returncode or 0


def guarded_client(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, dict[str, Any]]:
    """A login route wired to a fake process, so a spawn is observable."""
    spawned: dict[str, Any] = {"count": 0}

    async def spawn(_command: LoginCommand) -> FakeProcess:
        spawned["count"] += 1
        return FakeProcess()

    async def refresh(force: bool = False) -> bool:
        return True

    manager = CopilotLoginManager(
        resolver=lambda: LoginCommand(
            method="copilot-cli", executable="/bin/copilot", args=COPILOT_LOGIN_ARGS
        ),
        spawn=spawn,
        refresh=refresh,
    )
    monkeypatch.setattr(capabilities_route, "login_manager", manager)

    app = FastAPI()
    app.include_router(capabilities_route.router)
    return TestClient(app), spawned


class TestLoginOriginGuard:
    @pytest.mark.parametrize(
        "origin",
        [
            "https://evil.example.com",
            "http://evil.example.com",
            "http://localhost.evil.com",
            "https://127.0.0.1.evil.com",
            "file://",
            "",
        ],
    )
    def test_a_foreign_origin_is_refused_and_spawns_nothing(
        self, monkeypatch: pytest.MonkeyPatch, origin: str
    ) -> None:
        client, spawned = guarded_client(monkeypatch)

        response = client.post("/api/copilot/login", headers={"Origin": origin})

        assert response.status_code == 403
        assert spawned["count"] == 0, "a cross-site POST must not start a login"
        assert origin not in response.text or not origin

    def test_a_missing_origin_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A browser always attaches Origin to a POST."""
        client, spawned = guarded_client(monkeypatch)

        response = client.post("/api/copilot/login")

        assert response.status_code == 403
        assert spawned["count"] == 0

    @pytest.mark.parametrize(
        "origin",
        [
            "null",
            "http://localhost:5173",
            "http://127.0.0.1:7001",
            "http://[::1]:5173",
            "https://localhost:3000",
        ],
    )
    def test_the_local_ui_and_the_packaged_app_are_allowed(
        self, monkeypatch: pytest.MonkeyPatch, origin: str
    ) -> None:
        client, spawned = guarded_client(monkeypatch)

        response = client.post("/api/copilot/login", headers={"Origin": origin})

        assert response.status_code == 200
        assert response.json()["status"] == "waiting"
        assert spawned["count"] == 1

    def test_cancel_is_guarded_too(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client, _ = guarded_client(monkeypatch)

        with client:
            client.post("/api/copilot/login", headers={"Origin": "null"})

            refused = client.delete(
                "/api/copilot/login", headers={"Origin": "https://evil.example.com"}
            )
            assert refused.status_code == 403

            allowed = client.delete("/api/copilot/login", headers={"Origin": "null"})
            assert allowed.status_code == 200
            assert allowed.json()["status"] == "cancelled"

    def test_status_stays_readable_without_an_origin(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """GET is read-only, so it is not guarded and cannot start anything."""
        client, spawned = guarded_client(monkeypatch)

        response = client.get("/api/copilot/login")

        assert response.status_code == 200
        assert response.json()["status"] == "idle"
        assert spawned["count"] == 0

    def test_the_refusal_says_what_to_do_without_echoing_the_origin(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _ = guarded_client(monkeypatch)

        response = client.post(
            "/api/copilot/login",
            headers={"Origin": "https://evil.example.com/<script>"},
        )

        assert response.status_code == 403
        detail = response.json()["detail"]
        assert "shot2code app" in detail
        assert "evil.example.com" not in detail
        assert "<script>" not in detail

    def test_the_guard_is_applied_to_both_state_changing_routes(self) -> None:
        import inspect

        for handler in (
            capabilities_route.start_copilot_login,
            capabilities_route.cancel_copilot_login,
        ):
            assert "require_local_ui_origin" in inspect.getsource(handler)

    def test_the_fixed_argv_rule_is_untouched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The guard must not have loosened how the CLI is spawned."""
        import inspect

        source = inspect.getsource(CopilotLoginManager._spawn_process)  # pyright: ignore[reportPrivateUsage]

        assert "create_subprocess_exec" in source
        assert "create_subprocess_shell" not in source
        assert "shell=True" not in source
