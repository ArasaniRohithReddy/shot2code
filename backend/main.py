# Load environment variables first
from dotenv import load_dotenv

load_dotenv()


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import IS_DEBUG_ENABLED
from routes import (
    capabilities,
    screenshot,
    generate_code,
    home,
    evals,
    export,
    design_systems,
    prompt_reports,
    agent_runs,
    eval_sets,
    project_context,
)
from uploaded_assets import configure_uploaded_asset_routes

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
configure_uploaded_asset_routes(app)


@app.on_event("startup")
async def log_debug_mode() -> None:
    debug_status = "ENABLED" if IS_DEBUG_ENABLED else "DISABLED"
    print(f"Backend startup complete. Debug mode is {debug_status}.")


@app.on_event("startup")
async def probe_screenshot_preview_on_startup() -> None:
    # Detect (and warm up) headless Chromium so the screenshot_preview tool is
    # only offered when it can actually run. Logs the outcome.
    # Screenshot preview is optional, so no failure here may take the backend
    # down with it - including an encoding error raised while logging.
    try:
        from preview_screenshot import probe_screenshot_preview

        await probe_screenshot_preview()
    except Exception as exc:
        print(f"[startup] screenshot preview probe failed, tool disabled: {exc!r}")


@app.on_event("startup")
async def probe_copilot_on_startup() -> None:
    # Warm the Copilot credential cache in the background. The first probe
    # spawns the bundled Copilot CLI and can take ~15s, which would otherwise
    # stall the first /api/capabilities call the Settings dialog makes.
    # Deliberately not awaited so it never delays startup.
    import asyncio

    from copilot_auth import probe_copilot_auth

    asyncio.create_task(probe_copilot_auth())

# Configure CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add routes
app.include_router(generate_code.router)
app.include_router(screenshot.router)
app.include_router(home.router)
app.include_router(capabilities.router)
app.include_router(evals.router)
app.include_router(export.router)
app.include_router(design_systems.router)
app.include_router(prompt_reports.router)
app.include_router(agent_runs.router)
app.include_router(eval_sets.router)
app.include_router(project_context.router)
