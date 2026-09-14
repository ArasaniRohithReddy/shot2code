import asyncio
from pathlib import Path
from types import ModuleType

import pytest
from fastapi import APIRouter, FastAPI, WebSocket
from fastapi.testclient import TestClient

from deferred_routes import DeferredRouteLoader, DeferredRoutesMiddleware
from main import DEFERRED_ROUTE_GROUPS
from routes.home import router as home_router


def test_core_health_does_not_import_slow_feature_routes() -> None:
    imports: list[str] = []
    feature_router = APIRouter()

    @feature_router.get("/feature")
    async def feature() -> dict[str, bool]:
        return {"loaded": True}

    def import_module(name: str) -> ModuleType:
        imports.append(name)
        module = ModuleType(name)
        setattr(module, "router", feature_router)
        return module

    app = FastAPI()
    loader = DeferredRouteLoader(
        ("fake_feature",),
        import_module=import_module,
    )
    app.state.deferred_route_loader = loader
    app.add_middleware(
        DeferredRoutesMiddleware,
        router_app=app,
        loader=loader,
        path_prefixes=("/feature",),
    )
    app.include_router(home_router)

    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json() == {
            "ok": True,
            "feature_routes": "not_loaded",
        }
        assert imports == []

        response = client.get("/feature")
        assert response.status_code == 200
        assert response.json() == {"loaded": True}
        assert imports == ["fake_feature"]


def test_deferred_websocket_route_loads_before_dispatch() -> None:
    imports: list[str] = []
    feature_router = APIRouter()

    @feature_router.websocket("/feature-ws")
    async def feature_websocket(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_text("loaded")
        await websocket.close()

    def import_module(name: str) -> ModuleType:
        imports.append(name)
        module = ModuleType(name)
        setattr(module, "router", feature_router)
        return module

    app = FastAPI()
    loader = DeferredRouteLoader(
        ("fake_feature",),
        import_module=import_module,
    )
    app.add_middleware(
        DeferredRoutesMiddleware,
        router_app=app,
        loader=loader,
        path_prefixes=("/feature-ws",),
    )

    with TestClient(app) as client:
        with client.websocket_connect("/feature-ws") as websocket:
            assert websocket.receive_text() == "loaded"

    assert imports == ["fake_feature"]


def test_deferred_import_failure_is_explicit_and_marks_health_failed() -> None:
    def import_module(_name: str) -> ModuleType:
        raise ImportError("missing feature dependency")

    app = FastAPI()
    loader = DeferredRouteLoader(
        ("broken_feature",),
        import_module=import_module,
    )
    app.state.deferred_route_loader = loader
    app.add_middleware(
        DeferredRoutesMiddleware,
        router_app=app,
        loader=loader,
        path_prefixes=("/feature",),
    )
    app.include_router(home_router)

    with TestClient(app) as client:
        response = client.get("/feature")
        assert response.status_code == 500
        assert response.json() == {
            "detail": "Backend feature routes failed to load"
        }

        health = client.get("/api/health")
        assert health.status_code == 500
        assert health.json()["detail"] == "Backend feature routes failed to load"


@pytest.mark.asyncio
async def test_concurrent_feature_requests_share_one_import() -> None:
    import_count = 0
    feature_router = APIRouter()

    def import_module(name: str) -> ModuleType:
        nonlocal import_count
        import_count += 1
        module = ModuleType(name)
        setattr(module, "router", feature_router)
        return module

    app = FastAPI()
    loader = DeferredRouteLoader(
        ("shared_feature",),
        import_module=import_module,
    )

    await asyncio.gather(
        loader.ensure_loaded(app),
        loader.ensure_loaded(app),
    )

    assert import_count == 1
    assert loader.status == "ready"


def test_pyinstaller_includes_every_deferred_route_module() -> None:
    spec = (
        Path(__file__).resolve().parents[1] / "shot2code-backend.spec"
    ).read_text(encoding="utf-8")

    module_names = {
        module_name
        for _group_name, group_modules, _path_prefixes in DEFERRED_ROUTE_GROUPS
        for module_name in group_modules
    }
    for module_name in module_names:
        assert f'"{module_name}"' in spec
