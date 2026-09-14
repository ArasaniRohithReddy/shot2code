import asyncio
import time

import pytest

import main
from optional_startup import OptionalStartupTasks


@pytest.mark.asyncio
async def test_hanging_optional_work_does_not_block_scheduling() -> None:
    started = asyncio.Event()
    logs: list[str] = []
    manager = OptionalStartupTasks(
        log=logs.append,
        start_delay_seconds=0,
    )

    async def hang() -> None:
        started.set()
        await asyncio.Event().wait()

    before = time.perf_counter()
    task = manager.start("test probe", hang, timeout_seconds=0.01)
    scheduling_seconds = time.perf_counter() - before

    assert scheduling_seconds < 0.05
    await started.wait()
    await asyncio.wait_for(task, timeout=0.5)
    assert any("timed out" in message for message in logs)


@pytest.mark.asyncio
async def test_shutdown_cancels_unfinished_optional_work() -> None:
    cancelled = asyncio.Event()
    manager = OptionalStartupTasks(start_delay_seconds=0)

    async def hang() -> None:
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    manager.start("test probe", hang, timeout_seconds=60)
    await asyncio.sleep(0)
    await manager.close()

    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_main_startup_schedules_optional_probes_without_awaiting_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = OptionalStartupTasks(start_delay_seconds=0)

    async def hang() -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(main, "optional_startup_tasks", manager)
    monkeypatch.setattr(main, "probe_screenshot_preview", hang)
    monkeypatch.setattr("copilot_auth.probe_copilot_auth", hang)

    await asyncio.wait_for(main.start_optional_discovery(), timeout=0.1)
    await manager.close()
