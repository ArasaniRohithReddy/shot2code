from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

router = APIRouter()


@router.get("/")
async def get_status():
    return HTMLResponse(
        content="<h3>Your backend is running correctly. Please open the front-end URL (default is http://localhost:5173) to use shot2code.</h3>"
    )


@router.get("/api/health")
async def get_health(request: Request) -> dict[str, bool | str]:
    """Cheap liveness probe.

    Core routes are ready before expensive feature routers or optional provider
    discovery. A feature import failure is still fatal and reported explicitly
    after it has been observed.
    """
    loaders = getattr(request.app.state, "deferred_route_loaders", None)
    if loaders is None:
        loader = getattr(request.app.state, "deferred_route_loader", None)
        loaders = (loader,) if loader is not None else ()

    if any(loader.error is not None for loader in loaders):
        raise HTTPException(
            status_code=500,
            detail="Backend feature routes failed to load",
        )
    statuses = {loader.status for loader in loaders}
    if not statuses or statuses == {"ready"}:
        feature_routes = "ready"
    elif "loading" in statuses:
        feature_routes = "loading"
    elif "ready" in statuses:
        feature_routes = "partial"
    else:
        feature_routes = "not_loaded"

    return {
        "ok": True,
        "feature_routes": feature_routes,
    }
