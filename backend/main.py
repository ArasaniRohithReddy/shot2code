# Load environment variables first
from dotenv import load_dotenv

load_dotenv()


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import IS_DEBUG_ENABLED
from deferred_routes import (
    DeferredRouteLoader,
    DeferredRoutesMiddleware,
)
from optional_startup import OptionalStartupTasks
from preview_screenshot import close_screenshot_preview, probe_screenshot_preview
from routes import capabilities, design_systems, history, home, models
from uploaded_assets import configure_uploaded_asset_routes

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
configure_uploaded_asset_routes(app)

DEFERRED_ROUTE_GROUPS = (
    (
        "generation",
        ("routes.generate_code",),
        ("/generate-code",),
    ),
    (
        "project tools",
        (
            "routes.screenshot",
            "routes.export",
            "routes.project_context",
        ),
        (
            "/api/screenshot",
            "/api/export",
            "/api/project-context",
        ),
    ),
    (
        "evaluation",
        (
            "routes.evals",
            "routes.prompt_reports",
            "routes.agent_runs",
            "routes.eval_sets",
        ),
        (
            "/eval_input_files",
            "/evals",
            "/openai-input-compare",
            "/run_evals",
            "/run_evals_stream",
            "/models",
            "/best-of-n-evals",
            "/output_folders",
            "/prompt-reports",
            "/agent-runs",
            "/eval-sets",
            "/eval-sessions",
        ),
    ),
)

optional_startup_tasks = OptionalStartupTasks()
deferred_route_loaders: list[DeferredRouteLoader] = []
for group_name, module_names, path_prefixes in DEFERRED_ROUTE_GROUPS:
    loader = DeferredRouteLoader(module_names, name=group_name)
    deferred_route_loaders.append(loader)
    app.add_middleware(
        DeferredRoutesMiddleware,
        router_app=app,
        loader=loader,
        path_prefixes=path_prefixes,
    )
app.state.deferred_route_loaders = tuple(deferred_route_loaders)


@app.on_event("startup")
async def log_debug_mode() -> None:
    debug_status = "ENABLED" if IS_DEBUG_ENABLED else "DISABLED"
    print(f"Backend startup complete. Debug mode is {debug_status}.")


@app.on_event("startup")
async def start_optional_discovery() -> None:
    from copilot_auth import probe_copilot_auth

    optional_startup_tasks.start(
        "screenshot preview probe",
        probe_screenshot_preview,
        timeout_seconds=60,
    )
    optional_startup_tasks.start(
        "Copilot authentication probe",
        probe_copilot_auth,
        timeout_seconds=35,
    )


@app.on_event("shutdown")
async def stop_optional_discovery() -> None:
    await optional_startup_tasks.close()
    await close_screenshot_preview()

# Configure CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add routes
app.include_router(home.router)
app.include_router(capabilities.router)
app.include_router(models.router)
app.include_router(design_systems.router)
app.include_router(history.router)
