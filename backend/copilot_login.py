"""In-app GitHub Copilot sign-in, delegated to the official CLI.

shot2code never implements the OAuth device flow itself and never impersonates
a client id. It runs the *official* CLI's own login command - `copilot login`
first, `gh auth login` as a fallback - and then re-probes the existing
credential ladder. Everything the CLI writes stays with the CLI: this module
reports a status, never its output.

The rules that keep this safe are deliberately narrow:

* the executable is resolved from ``PATH`` and the arguments are constants, so
  nothing a request sends can influence the command line;
* the process is spawned directly (never through a shell) and, on Windows,
  without a console window;
* stdout and stderr are drained but never returned, logged or stored, because
  a login flow prints one-time codes and can echo tokens;
* the run is bounded by a timeout, can be cancelled, and is killed on backend
  shutdown so a browser flow can never outlive the server.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Optional, Protocol

from copilot_auth import probe_copilot_auth

LoginStatus = Literal[
    "idle",
    "starting",
    "waiting",
    "succeeded",
    "failed",
    "cancelled",
    "unavailable",
]
LoginMethod = Literal["copilot-cli", "github-cli"]

# Fixed argument vectors. These are the only command lines this module can run.
COPILOT_LOGIN_ARGS: tuple[str, ...] = ("--no-auto-update", "login", "--web-flow")
GITHUB_CLI_LOGIN_ARGS: tuple[str, ...] = (
    "auth",
    "login",
    "--hostname",
    "github.com",
    "--git-protocol",
    "https",
    "--web",
    "--skip-ssh-key",
)

# Where to send someone who has neither CLI installed.
COPILOT_CLI_INSTALL_URL = (
    "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/"
    "install-copilot-cli"
)

# A browser sign-in is a human-paced flow, but it must not hang forever.
LOGIN_TIMEOUT_SECONDS = 300.0
# How long a terminated CLI gets to exit before it is killed outright.
TERMINATE_GRACE_SECONDS = 5.0

# Hide the console window the CLI would otherwise flash on Windows.
_CREATE_NO_WINDOW = 0x08000000


@dataclass(frozen=True)
class LoginCommand:
    """A resolved, fixed command line for one of the official CLIs."""

    method: LoginMethod
    executable: str
    args: tuple[str, ...]

    @property
    def argv(self) -> tuple[str, ...]:
        return (self.executable, *self.args)


@dataclass(frozen=True)
class LoginState:
    """What the UI is allowed to know about a sign-in attempt."""

    status: LoginStatus
    method: LoginMethod | None = None
    message: str = ""
    login: str | None = None
    can_cancel: bool = False
    install_url: str | None = None


def resolve_login_command(
    which: Callable[[str], str | None] | None = None,
) -> LoginCommand | None:
    """The official CLI to delegate to, preferring Copilot's own.

    ``which`` exists so tests can resolve without touching the machine's PATH.
    """
    lookup = which or shutil.which

    copilot_path = lookup("copilot")
    if isinstance(copilot_path, str) and copilot_path:
        return LoginCommand(
            method="copilot-cli",
            executable=copilot_path,
            args=COPILOT_LOGIN_ARGS,
        )

    gh_path = lookup("gh")
    if isinstance(gh_path, str) and gh_path:
        return LoginCommand(
            method="github-cli",
            executable=gh_path,
            args=GITHUB_CLI_LOGIN_ARGS,
        )

    return None


def _creation_flags() -> int:
    return _CREATE_NO_WINDOW if sys.platform == "win32" else 0


# Injection points, so the manager can be exercised without spawning anything.
class LoginProcess(Protocol):
    """The only part of a child process this manager touches."""

    @property
    def returncode(self) -> int | None: ...

    async def communicate(self) -> tuple[bytes, bytes]: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...

    async def wait(self) -> int: ...


LoginResolver = Callable[[], Optional[LoginCommand]]
LoginSpawner = Callable[[LoginCommand], Awaitable[LoginProcess]]
CredentialRefresher = Callable[..., Awaitable[bool]]


class CopilotLoginManager:
    """Owns at most one CLI sign-in at a time."""

    def __init__(
        self,
        *,
        timeout_seconds: float = LOGIN_TIMEOUT_SECONDS,
        resolver: LoginResolver | None = None,
        spawn: LoginSpawner | None = None,
        refresh: CredentialRefresher | None = None,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._resolver: LoginResolver = resolver or resolve_login_command
        self._spawn: LoginSpawner = spawn or self._spawn_process
        self._refresh: CredentialRefresher = refresh or probe_copilot_auth
        self._lock = asyncio.Lock()
        self._state = LoginState(status="idle")
        self._process: Optional[LoginProcess] = None
        self._task: Optional["asyncio.Task[None]"] = None

    # ------------------------------------------------------------------ state

    def status(self) -> LoginState:
        """The current state. Never blocks and never touches the process."""
        return self._state

    @property
    def is_running(self) -> bool:
        return self._state.status in ("starting", "waiting")

    # ---------------------------------------------------------------- process

    async def _spawn_process(self, command: LoginCommand) -> LoginProcess:
        # exec, never shell: the argv is fixed and nothing is interpolated.
        return await asyncio.create_subprocess_exec(
            command.executable,
            *command.args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=_creation_flags(),
        )

    async def start(self) -> LoginState:
        """Begin a sign-in, or report the one already in flight."""
        async with self._lock:
            if self.is_running:
                return self._state

            command = self._resolver()
            if command is None:
                self._state = LoginState(
                    status="unavailable",
                    method=None,
                    message=(
                        "No GitHub CLI found. Install GitHub Copilot CLI (or the "
                        "GitHub CLI) and try again, or paste a token in Settings."
                    ),
                    install_url=COPILOT_CLI_INSTALL_URL,
                )
                return self._state

            self._state = LoginState(
                status="starting",
                method=command.method,
                message="Starting the sign-in command…",
                can_cancel=True,
            )
            try:
                self._process = await self._spawn(command)
            except Exception as exc:
                # The class name is safe; the message could echo a path or an
                # environment value, so it is not reported.
                print(f"[copilot-login] could not start CLI: {type(exc).__name__}")
                self._process = None
                self._state = LoginState(
                    status="failed",
                    method=command.method,
                    message=(
                        "Could not start the sign-in command. Check that the "
                        "CLI is installed and on PATH."
                    ),
                    install_url=COPILOT_CLI_INSTALL_URL,
                )
                return self._state

            self._state = LoginState(
                status="waiting",
                method=command.method,
                message=(
                    "Finish signing in with GitHub in the browser window the CLI "
                    "opened, then return here."
                ),
                can_cancel=True,
            )
            self._task = asyncio.create_task(
                self._await_completion(command), name="copilot-login"
            )
            return self._state

    async def _await_completion(self, command: LoginCommand) -> None:
        process = self._process
        if process is None:
            return
        try:
            # communicate() drains the pipes so the CLI cannot block on a full
            # buffer. The captured bytes are deliberately discarded.
            await asyncio.wait_for(
                process.communicate(), timeout=self._timeout_seconds
            )
        except asyncio.TimeoutError:
            await self._kill_process()
            self._state = LoginState(
                status="failed",
                method=command.method,
                message=(
                    "Sign-in timed out before it completed. Start it again when "
                    "you are ready to finish in the browser."
                ),
            )
            return
        except asyncio.CancelledError:
            await self._kill_process()
            self._state = LoginState(
                status="cancelled",
                method=command.method,
                message="Sign-in was cancelled.",
            )
            raise
        finally:
            self._process = None

        if process.returncode == 0:
            await self._finish_success(command)
            return

        self._state = LoginState(
            status="failed",
            method=command.method,
            message=(
                "The sign-in command did not complete. Try again, or run it "
                "yourself in a terminal."
            ),
            install_url=COPILOT_CLI_INSTALL_URL,
        )

    async def _finish_success(self, command: LoginCommand) -> None:
        """Re-probe the existing credential ladder and publish the result."""
        login: str | None = None
        available = False
        try:
            available = bool(await self._refresh(force=True))
            if available:
                from copilot_auth import copilot_login

                login = copilot_login()
        except Exception as exc:
            print(f"[copilot-login] post-login probe failed: {type(exc).__name__}")

        if available:
            self._state = LoginState(
                status="succeeded",
                method=command.method,
                message=(
                    f"Signed in as {login}." if login else "Signed in with GitHub."
                ),
                login=login,
            )
            return

        self._state = LoginState(
            status="failed",
            method=command.method,
            message=(
                "The CLI finished but no Copilot credentials were detected. "
                "Check that the account has Copilot access."
            ),
        )

    async def _kill_process(self) -> None:
        process = self._process
        if process is None or process.returncode is not None:
            return
        try:
            process.terminate()
        except ProcessLookupError:
            return
        except Exception:
            pass
        try:
            await asyncio.wait_for(process.wait(), timeout=TERMINATE_GRACE_SECONDS)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            try:
                process.kill()
            except Exception:
                pass
        except Exception:
            pass

    async def cancel(self) -> LoginState:
        """Stop an in-flight sign-in and kill the CLI."""
        async with self._lock:
            if not self.is_running:
                return self._state

            method = self._state.method
            task = self._task
            self._task = None
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            await self._kill_process()
            self._process = None
            self._state = LoginState(
                status="cancelled",
                method=method,
                message="Sign-in was cancelled.",
            )
            return self._state

    async def close(self) -> None:
        """Shutdown hook: a login must never outlive the backend."""
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        await self._kill_process()
        self._process = None


# One manager per process: a second concurrent browser flow would only race the
# first one's credential file.
login_manager = CopilotLoginManager()
