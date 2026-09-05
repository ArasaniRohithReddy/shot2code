"""PyInstaller entry point for the packaged backend.

The desktop app ships the backend as a standalone executable so end users never
install Python. This wrapper parses the port the Electron shell assigns and
starts uvicorn in-process.
"""

import argparse
import multiprocessing
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(prog="shot2code-backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7001)
    args = parser.parse_args()

    # Electron captures stdout/stderr through a pipe, so Python picks the
    # locale encoding (cp1252 on Windows) instead of UTF-8. Several log lines
    # contain non-ASCII (em dashes, and Playwright's box-drawing banner when a
    # browser is missing), which would raise UnicodeEncodeError mid-log --
    # including inside an except block, taking the whole process down.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass

    # When frozen, Playwright needs to find the browsers that were bundled
    # alongside the executable.
    if getattr(sys, "frozen", False):
        bundled_browsers = os.path.join(os.path.dirname(sys.executable), "ms-playwright")
        if os.path.isdir(bundled_browsers):
            os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", bundled_browsers)

    import uvicorn

    from main import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    # Required so PyInstaller one-folder builds don't re-launch the app when
    # any dependency spawns a process.
    multiprocessing.freeze_support()
    main()
