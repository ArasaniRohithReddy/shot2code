"""Delegated GitHub sign-in: fixed command, bounded, cancellable, silent.

shot2code runs the *official* CLI's own login command. These tests pin the
things that make that safe: the argument vector is a constant, nothing is
spawned through a shell, the process cannot outlive the backend, and no CLI
output ever reaches a response.
"""

import asyncio
import subprocess
import sys
from typing import Any

import pytest

from copilot_login import (
    COPILOT_CLI_INSTALL_URL,
    COPILOT_LOGIN_ARGS,
    GITHUB_CLI_LOGIN_ARGS,
    CopilotLoginManager,
    LoginCommand,
    resolve_login_command,
)

# The login routes only accept a call from this machine's own UI.
LOCAL_ORIGIN = {"Origin": "http://localhost:5173"}


class FakeProcess:
    """An asyncio-subprocess stand-in that never touches the machine."""

    def __init__(self, returncode: int = 0, hang: bool = False) -> None:
        self.returncode: int | None = None if hang else returncode
        self._final_returncode = returncode
        self._hang = hang
        self.terminated = False
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        if self._hang:
            await asyncio.Event().wait()
        self.returncode = self._final_returncode
        return (b"one-time code ABCD-1234", b"token=ghp_supersecretvalue")

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 143

    def kill(self) -> None:
        self.killed = True
        self.returncode = 137

    async def wait(self) -> int:
        return self.returncode or 0


def manager_for(
    process: FakeProcess,
    command: LoginCommand | None = None,
    available: bool = True,
    login: str | None = "octocat",
    timeout_seconds: float = 5.0,
) -> tuple[CopilotLoginManager, dict[str, Any]]:
    """A manager wired to fakes, plus what it actually tried to spawn."""
    spawned: dict[str, Any] = {}
    resolved = command or LoginCommand(
        method="copilot-cli", executable="/usr/bin/copilot", args=COPILOT_LOGIN_ARGS
    )

    async def spawn(cmd: LoginCommand) -> FakeProcess:
        spawned["command"] = cmd
        return process

    async def refresh(force: bool = False) -> bool:
        spawned["refresh_force"] = force
        return available

    instance = CopilotLoginManager(
        timeout_seconds=timeout_seconds,
        resolver=lambda: resolved,
        spawn=spawn,
        refresh=refresh,
    )
    if available:
        import copilot_auth

        copilot_auth._cached_login = login  # pyright: ignore[reportPrivateUsage]
    return instance, spawned


class TestCommandResolution:
    def test_copilot_cli_is_preferred(self) -> None:
        command = resolve_login_command(
            which=lambda name: f"/bin/{name}" if name in ("copilot", "gh") else None
        )

        assert command is not None
        assert command.method == "copilot-cli"
        assert command.executable == "/bin/copilot"
        assert command.args == COPILOT_LOGIN_ARGS

    def test_github_cli_is_the_fallback(self) -> None:
        command = resolve_login_command(
            which=lambda name: "/bin/gh" if name == "gh" else None
        )

        assert command is not None
        assert command.method == "github-cli"
        assert command.args == GITHUB_CLI_LOGIN_ARGS

    def test_no_cli_resolves_to_nothing(self) -> None:
        assert resolve_login_command(which=lambda _name: None) is None

    def test_the_argument_vectors_are_the_documented_ones(self) -> None:
        """Fixed constants: no request can influence what is executed."""
        assert COPILOT_LOGIN_ARGS == ("--no-auto-update", "login", "--web-flow")
        assert GITHUB_CLI_LOGIN_ARGS == (
            "auth",
            "login",
            "--hostname",
            "github.com",
            "--git-protocol",
            "https",
            "--web",
            "--skip-ssh-key",
        )

    def test_the_argv_is_the_executable_plus_fixed_args(self) -> None:
        command = LoginCommand(
            method="copilot-cli", executable="/bin/copilot", args=COPILOT_LOGIN_ARGS
        )

        assert command.argv == ("/bin/copilot", *COPILOT_LOGIN_ARGS)


class TestStartAndStatus:
    @pytest.mark.asyncio
    async def test_a_started_login_reports_waiting(self) -> None:
        manager, spawned = manager_for(FakeProcess(hang=True))

        state = await manager.start()

        assert state.status == "waiting"
        assert state.method == "copilot-cli"
        assert state.can_cancel is True
        assert spawned["command"].args == COPILOT_LOGIN_ARGS
        await manager.close()

    @pytest.mark.asyncio
    async def test_status_is_readable_without_touching_the_process(self) -> None:
        manager, _ = manager_for(FakeProcess(hang=True))
        await manager.start()

        assert manager.status().status == "waiting"
        assert manager.is_running is True
        await manager.close()

    @pytest.mark.asyncio
    async def test_a_second_start_does_not_spawn_again(self) -> None:
        process = FakeProcess(hang=True)
        manager, spawned = manager_for(process)
        await manager.start()
        spawned.pop("command")

        state = await manager.start()

        assert state.status == "waiting"
        assert "command" not in spawned, "a second browser flow must not start"
        await manager.close()

    @pytest.mark.asyncio
    async def test_success_refreshes_the_existing_credential_ladder(self) -> None:
        manager, spawned = manager_for(FakeProcess(returncode=0))

        await manager.start()
        await asyncio.sleep(0.05)

        state = manager.status()
        assert state.status == "succeeded"
        assert state.login == "octocat"
        assert spawned["refresh_force"] is True
        assert state.can_cancel is False

    @pytest.mark.asyncio
    async def test_a_failing_cli_reports_failure_not_output(self) -> None:
        manager, _ = manager_for(FakeProcess(returncode=1))

        await manager.start()
        await asyncio.sleep(0.05)

        state = manager.status()
        assert state.status == "failed"
        assert state.install_url == COPILOT_CLI_INSTALL_URL

    @pytest.mark.asyncio
    async def test_a_finished_cli_without_credentials_is_a_failure(self) -> None:
        manager, _ = manager_for(FakeProcess(returncode=0), available=False)

        await manager.start()
        await asyncio.sleep(0.05)

        assert manager.status().status == "failed"

    @pytest.mark.asyncio
    async def test_no_cli_reports_unavailable_with_the_official_docs(self) -> None:
        manager = CopilotLoginManager(resolver=lambda: None)

        state = await manager.start()

        assert state.status == "unavailable"
        assert state.method is None
        assert state.install_url == COPILOT_CLI_INSTALL_URL
        assert state.can_cancel is False

    @pytest.mark.asyncio
    async def test_a_spawn_failure_is_reported_without_the_cause(self) -> None:
        async def explode(_command: LoginCommand) -> Any:
            raise FileNotFoundError("/secret/path/copilot not found")

        manager = CopilotLoginManager(
            resolver=lambda: LoginCommand(
                method="copilot-cli", executable="copilot", args=COPILOT_LOGIN_ARGS
            ),
            spawn=explode,
        )

        state = await manager.start()

        assert state.status == "failed"
        assert "/secret/path" not in state.message


class TestTimeoutAndCancel:
    @pytest.mark.asyncio
    async def test_a_hanging_login_times_out_and_kills_the_process(self) -> None:
        process = FakeProcess(hang=True)
        manager, _ = manager_for(process, timeout_seconds=0.05)

        await manager.start()
        await asyncio.sleep(0.2)

        state = manager.status()
        assert state.status == "failed"
        assert "timed out" in state.message
        assert process.terminated or process.killed

    @pytest.mark.asyncio
    async def test_cancel_stops_the_flow_and_the_process(self) -> None:
        process = FakeProcess(hang=True)
        manager, _ = manager_for(process)
        await manager.start()

        state = await manager.cancel()

        assert state.status == "cancelled"
        assert state.can_cancel is False
        assert process.terminated or process.killed
        assert manager.is_running is False

    @pytest.mark.asyncio
    async def test_cancelling_an_idle_manager_is_a_no_op(self) -> None:
        manager = CopilotLoginManager(resolver=lambda: None)

        state = await manager.cancel()

        assert state.status == "idle"

    @pytest.mark.asyncio
    async def test_close_kills_a_login_so_it_cannot_outlive_the_backend(self) -> None:
        process = FakeProcess(hang=True)
        manager, _ = manager_for(process)
        await manager.start()

        await manager.close()

        assert process.terminated or process.killed
        assert manager._process is None  # pyright: ignore[reportPrivateUsage]


class TestProcessSafety:
    def test_the_spawn_helper_never_uses_a_shell(self) -> None:
        source = CopilotLoginManager._spawn_process.__code__  # pyright: ignore[reportPrivateUsage]
        names = source.co_names

        assert "create_subprocess_exec" in names
        assert "create_subprocess_shell" not in names

    def test_stdin_is_closed_and_output_is_piped_not_inherited(self) -> None:
        import inspect

        source = inspect.getsource(CopilotLoginManager._spawn_process)  # pyright: ignore[reportPrivateUsage]

        assert "stdin=subprocess.DEVNULL" in source
        assert "stdout=subprocess.PIPE" in source
        assert "stderr=subprocess.PIPE" in source

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-only flag")
    def test_windows_processes_are_hidden(self) -> None:
        from copilot_login import _creation_flags

        assert _creation_flags() == subprocess.CREATE_NO_WINDOW  # pyright: ignore[reportAttributeAccessIssue]

    @pytest.mark.asyncio
    async def test_cli_output_never_reaches_the_state(self) -> None:
        """communicate() drains the pipes; the bytes are discarded."""
        manager, _ = manager_for(FakeProcess(returncode=0))

        await manager.start()
        await asyncio.sleep(0.05)

        rendered = repr(manager.status())
        assert "ghp_supersecretvalue" not in rendered
        assert "ABCD-1234" not in rendered


class TestLoginRoute:
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from routes import capabilities as capabilities_route

        app = FastAPI()
        app.include_router(capabilities_route.router)
        return TestClient(app)
    def test_the_response_shape_is_the_documented_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from routes import capabilities as capabilities_route

        manager = CopilotLoginManager(resolver=lambda: None)
        monkeypatch.setattr(capabilities_route, "login_manager", manager)

        response = self.client().post("/api/copilot/login", headers=LOCAL_ORIGIN)

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {
            "status",
            "method",
            "message",
            "login",
            "canCancel",
            "installUrl",
        }
        assert body["status"] == "unavailable"
        assert body["installUrl"] == COPILOT_CLI_INSTALL_URL

    def test_status_and_cancel_round_trip(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from routes import capabilities as capabilities_route

        process = FakeProcess(hang=True)
        manager, _ = manager_for(process)
        monkeypatch.setattr(capabilities_route, "login_manager", manager)

        # One client context keeps a single event loop alive across the three
        # calls, which is what the running server does.
        with self.client() as client:
            started = client.post("/api/copilot/login", headers=LOCAL_ORIGIN).json()
            assert started["status"] == "waiting"
            assert started["canCancel"] is True

            assert client.get("/api/copilot/login").json()["status"] == "waiting"

            cancelled = client.delete("/api/copilot/login", headers=LOCAL_ORIGIN).json()

        assert cancelled["status"] == "cancelled"
        assert cancelled["canCancel"] is False
        assert process.terminated or process.killed

    def test_a_successful_login_reports_the_account(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from routes import capabilities as capabilities_route

        manager, _ = manager_for(FakeProcess(returncode=0))
        monkeypatch.setattr(capabilities_route, "login_manager", manager)

        with self.client() as client:
            client.post("/api/copilot/login", headers=LOCAL_ORIGIN)
            body: dict[str, Any] = {}
            for _ in range(20):
                body = client.get("/api/copilot/login").json()
                if body["status"] == "succeeded":
                    break

        assert body["status"] == "succeeded"
        assert body["login"] == "octocat"
        assert "ghp_" not in response_text(body)


def response_text(body: dict[str, Any]) -> str:
    return " ".join(str(value) for value in body.values())
