from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get("/")
async def get_status():
    return HTMLResponse(
        content="<h3>Your backend is running correctly. Please open the front-end URL (default is http://localhost:5173) to use shot2code.</h3>"
    )


@router.get("/api/health")
async def get_health() -> dict[str, bool]:
    """Cheap liveness probe.

    Deliberately does no work: the desktop shell polls this on startup, and
    /api/capabilities can block for many seconds the first time while it spawns
    the Copilot CLI to check credentials.
    """
    return {"ok": True}
