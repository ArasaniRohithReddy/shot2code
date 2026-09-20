from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from copilot_auth import (
    copilot_login,
    copilot_models,
    get_copilot_snapshot,
    probe_copilot_auth,
)
from copilot_login import LoginState, login_manager
from preview_screenshot import (
    is_screenshot_preview_available,
    probe_screenshot_preview,
)

router = APIRouter()

# Hostnames the shot2code UI can legitimately be served from. The packaged app
# runs over file://, which browsers send as the literal origin "null".
LOCAL_UI_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})
PACKAGED_APP_ORIGIN = "null"


def is_local_ui_origin(origin: str | None) -> bool:
    """Whether a browser Origin belongs to this machine's shot2code UI."""
    if origin is None:
        return False
    candidate = origin.strip()
    if candidate == PACKAGED_APP_ORIGIN:
        return True
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https"):
        return False
    return (parts.hostname or "") in LOCAL_UI_HOSTNAMES


def require_local_ui_origin(request: Request) -> None:
    """Refuse a state-changing login call that did not come from the app.

    Starting a sign-in spawns a process and opens a browser window, so it must
    not be reachable from any page a user happens to have open. CORS does not
    help here: a simple cross-site POST is *sent* regardless of what the
    response allows, so the origin is checked before anything runs. A browser
    always attaches Origin to a POST, so a missing one is refused too.
    """
    if not is_local_ui_origin(request.headers.get("origin")):
        # Deliberately does not echo the origin back.
        raise HTTPException(
            status_code=403,
            detail=(
                "GitHub sign-in can only be started from the shot2code app on "
                "this machine."
            ),
        )


class CopilotModel(BaseModel):
    id: str
    vision: bool


class Capabilities(BaseModel):
    screenshot_preview: bool
    copilot: bool
    copilot_login: str | None = None
    copilot_models: list[CopilotModel] = []


class CopilotCapabilitiesRequest(BaseModel):
    token: str | None = None


@router.get("/api/capabilities", response_model=Capabilities)
async def get_capabilities(refresh: bool = False) -> Capabilities:
    """Backend feature availability for the frontend to reflect in settings."""
    copilot_available = await probe_copilot_auth(force=refresh)
    if refresh:
        await probe_screenshot_preview(force=True)
    return Capabilities(
        screenshot_preview=is_screenshot_preview_available(),
        copilot=copilot_available,
        copilot_login=copilot_login() if copilot_available else None,
        copilot_models=[
            CopilotModel(id=str(m["id"]), vision=bool(m["vision"]))
            for m in copilot_models()
        ]
        if copilot_available
        else [],
    )


@router.post("/api/copilot/capabilities", response_model=Capabilities)
async def get_copilot_capabilities(
    request: CopilotCapabilitiesRequest,
) -> Capabilities:
    snapshot = await get_copilot_snapshot(
        github_token=request.token or None,
        force=True,
    )
    return Capabilities(
        screenshot_preview=is_screenshot_preview_available(),
        copilot=snapshot.available,
        copilot_login=snapshot.login,
        copilot_models=[
            CopilotModel(id=str(model["id"]), vision=bool(model["vision"]))
            for model in snapshot.models
        ],
    )


class CopilotLoginResponse(BaseModel):
    """Progress of a delegated CLI sign-in.

    Deliberately narrow: no command line, no CLI output, no token. Everything
    here is safe to render and safe to log.
    """

    status: str
    method: str | None = None
    message: str = ""
    login: str | None = None
    canCancel: bool = False
    installUrl: str | None = None


def _login_response(state: LoginState) -> CopilotLoginResponse:
    return CopilotLoginResponse(
        status=state.status,
        method=state.method,
        message=state.message,
        login=state.login,
        canCancel=state.can_cancel,
        installUrl=state.install_url,
    )


@router.post("/api/copilot/login", response_model=CopilotLoginResponse)
async def start_copilot_login(request: Request) -> CopilotLoginResponse:
    """Start the official CLI's own login flow.

    shot2code never runs its own OAuth flow: this shells out to `copilot login`
    (or `gh auth login`) with a fixed argument vector and then re-probes the
    existing credential ladder. Guarded by origin because it spawns a process.
    """
    require_local_ui_origin(request)
    return _login_response(await login_manager.start())


@router.get("/api/copilot/login", response_model=CopilotLoginResponse)
async def get_copilot_login_status() -> CopilotLoginResponse:
    """Where the current sign-in has got to, if there is one.

    Read-only and side-effect free, so it needs no origin guard; it reports
    only a status, never a token or a command line.
    """
    return _login_response(login_manager.status())


@router.delete("/api/copilot/login", response_model=CopilotLoginResponse)
async def cancel_copilot_login(request: Request) -> CopilotLoginResponse:
    """Stop an in-flight sign-in and kill the CLI process."""
    require_local_ui_origin(request)
    return _login_response(await login_manager.cancel())
