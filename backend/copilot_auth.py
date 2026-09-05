"""Copilot credential discovery.

The Copilot SDK finds credentials on its own - an explicit token, then a stored
``copilot`` CLI login, then a ``gh auth login``. That means shot2code can often
generate with no configuration at all, but only if we can tell up front whether
those credentials exist. Probing spawns the bundled CLI, so the answer is cached
and refreshed only on request.
"""

import asyncio
from typing import Optional

import copilot

from config import COPILOT_GITHUB_TOKEN


_cached_available: Optional[bool] = None
_cached_login: Optional[str] = None
_probe_lock = asyncio.Lock()


async def probe_copilot_auth(force: bool = False) -> bool:
    """Return whether usable Copilot credentials exist, caching the result."""
    global _cached_available, _cached_login

    if _cached_available is not None and not force:
        return _cached_available

    async with _probe_lock:
        if _cached_available is not None and not force:
            return _cached_available

        client = copilot.CopilotClient(
            github_token=COPILOT_GITHUB_TOKEN,
            use_logged_in_user=not COPILOT_GITHUB_TOKEN,
            log_level="error",
        )
        try:
            await client.start()
            status = await client.get_auth_status()
            _cached_available = bool(getattr(status, "isAuthenticated", False))
            _cached_login = getattr(status, "login", None)
        except Exception as exc:
            print(f"[copilot] auth probe failed: {exc}")
            _cached_available = False
            _cached_login = None
        finally:
            try:
                await client.stop()
            except Exception:
                pass

    return _cached_available


def is_copilot_available() -> bool:
    """Last probed result. False until :func:`probe_copilot_auth` has run."""
    return bool(_cached_available)


def copilot_login() -> Optional[str]:
    """GitHub login the last probe authenticated as, if any."""
    return _cached_login
