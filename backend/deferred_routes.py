"""Load expensive feature routers only when one of their paths is requested."""

from __future__ import annotations

import asyncio
import importlib
import json
import time
from collections.abc import Callable, Iterable, Sequence
from types import ModuleType
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRouter
from starlette.types import ASGIApp, Receive, Scope, Send

ImportModule = Callable[[str], ModuleType]


class DeferredRouteLoadError(RuntimeError):
    """The feature route graph could not be imported."""


class DeferredRouteLoader:
    """Import and install a route group once, outside the event-loop thread."""

    def __init__(
        self,
        module_names: Sequence[str],
        *,
        name: str = "feature",
        import_module: ImportModule = importlib.import_module,
        log: Callable[[str], None] = print,
    ) -> None:
        self._name = name
        self._module_names = tuple(module_names)
        self._import_module = import_module
        self._log = log
        self._task: asyncio.Task[None] | None = None
        self._loaded = False
        self._error: Exception | None = None
        self._duration_ms: int | None = None

    @property
    def error(self) -> Exception | None:
        return self._error

    @property
    def status(self) -> str:
        if self._error is not None:
            return "error"
        if self._loaded:
            return "ready"
        if self._task is not None:
            return "loading"
        return "not_loaded"

    @property
    def duration_ms(self) -> int | None:
        return self._duration_ms

    def _import_routers(self) -> list[APIRouter]:
        routers: list[APIRouter] = []
        for module_name in self._module_names:
            module = self._import_module(module_name)
            router = getattr(module, "router", None)
            if not isinstance(router, APIRouter):
                raise TypeError(f"{module_name} does not expose an APIRouter")
            routers.append(router)
        return routers

    async def _load(self, app: FastAPI) -> None:
        started = time.perf_counter()
        try:
            routers = await asyncio.to_thread(self._import_routers)
            for router in routers:
                app.include_router(router)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._error = exc
            self._log(
                f"[startup] deferred {self._name} routes failed to load: "
                f"{type(exc).__name__}"
            )
            raise DeferredRouteLoadError(
                "Backend feature routes failed to load"
            ) from exc
        else:
            self._loaded = True
            self._duration_ms = round((time.perf_counter() - started) * 1000)
            self._log(
                f"[startup] deferred {self._name} routes loaded in "
                f"{self._duration_ms}ms"
            )

    def start(self, app: FastAPI) -> asyncio.Task[None]:
        if self._task is None:
            self._task = asyncio.create_task(
                self._load(app),
                name=f"deferred-routes:{self._name}",
            )
        return self._task

    async def ensure_loaded(self, app: FastAPI) -> None:
        if self._loaded:
            return
        if self._error is not None:
            raise DeferredRouteLoadError(
                "Backend feature routes failed to load"
            ) from self._error
        await asyncio.shield(self.start(app))


def _path_matches(path: str, prefixes: Iterable[str]) -> bool:
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in prefixes)


class DeferredRoutesMiddleware:
    """Wait for feature routers before dispatching one of their requests."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        router_app: FastAPI,
        loader: DeferredRouteLoader,
        path_prefixes: Sequence[str],
    ) -> None:
        self._app = app
        self._router_app = router_app
        self._loader = loader
        self._path_prefixes = tuple(path_prefixes)

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if (
            scope["type"] in {"http", "websocket"}
            and _path_matches(str(scope.get("path", "")), self._path_prefixes)
        ):
            try:
                await self._loader.ensure_loaded(self._router_app)
            except DeferredRouteLoadError:
                if scope["type"] == "websocket":
                    await send(
                        {
                            "type": "websocket.close",
                            "code": 1011,
                            "reason": "Backend feature routes failed to load",
                        }
                    )
                    return

                body = json.dumps(
                    {"detail": "Backend feature routes failed to load"}
                ).encode("utf-8")
                await send(
                    {
                        "type": "http.response.start",
                        "status": 500,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode("ascii")),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return

        await self._app(scope, receive, send)
