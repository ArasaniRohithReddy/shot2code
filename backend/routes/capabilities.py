from fastapi import APIRouter
from pydantic import BaseModel

from copilot_auth import (
    copilot_login,
    copilot_models,
    get_copilot_snapshot,
    probe_copilot_auth,
)
from preview_screenshot import probe_screenshot_preview

router = APIRouter()


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
    return Capabilities(
        screenshot_preview=await probe_screenshot_preview(),
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
        screenshot_preview=await probe_screenshot_preview(),
        copilot=snapshot.available,
        copilot_login=snapshot.login,
        copilot_models=[
            CopilotModel(id=str(model["id"]), vision=bool(model["vision"]))
            for model in snapshot.models
        ],
    )
