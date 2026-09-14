"""Run optional backend discovery without delaying core API readiness."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

OptionalOperation = Callable[[], Awaitable[Any]]
LogFunction = Callable[[str], None]


class OptionalStartupTasks:
    """Own bounded background tasks started with the FastAPI application."""

    def __init__(
        self,
        *,
        log: LogFunction = print,
        start_delay_seconds: float = 0.25,
    ) -> None:
        self._log = log
        self._start_delay_seconds = start_delay_seconds
        self._tasks: set[asyncio.Task[None]] = set()

    def start(
        self,
        name: str,
        operation: OptionalOperation,
        *,
        timeout_seconds: float,
    ) -> asyncio.Task[None]:
        """Schedule one optional operation and return immediately."""

        async def run() -> None:
            if self._start_delay_seconds > 0:
                await asyncio.sleep(self._start_delay_seconds)

            started = time.perf_counter()
            try:
                await asyncio.wait_for(operation(), timeout=timeout_seconds)
            except TimeoutError:
                elapsed = time.perf_counter() - started
                self._log(
                    f"[startup] optional {name} timed out after {elapsed:.1f}s"
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._log(
                    f"[startup] optional {name} failed: {type(exc).__name__}"
                )
            else:
                elapsed = time.perf_counter() - started
                self._log(
                    f"[startup] optional {name} completed in {elapsed:.1f}s"
                )

        task = asyncio.create_task(run(), name=f"optional-startup:{name}")
        self._tasks.add(task)

        def discard(completed: asyncio.Task[None]) -> None:
            self._tasks.discard(completed)
            if completed.cancelled():
                return
            completed.exception()

        task.add_done_callback(discard)
        return task

    async def close(self) -> None:
        """Cancel unfinished discovery so shutdown never waits for it."""

        tasks = tuple(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
