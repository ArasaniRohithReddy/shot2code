from fastapi import APIRouter
from pydantic import BaseModel

from copilot_auth import copilot_login, copilot_models, probe_copilot_auth
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


@router.get("/api/capabilities", response_model=Capabilities)
async def get_capabilities() -> Capabilities:
    """Backend feature availability for the frontend to reflect in settings."""
    copilot_available = await probe_copilot_auth()
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
