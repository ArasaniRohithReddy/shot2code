# PyInstaller spec for the shot2code backend.
#
# Built as a one-folder bundle (not one-file): the app spawns the backend on
# every launch, and one-file would re-extract ~200MB to a temp dir each time.
#
# Run from backend/:  uv run pyinstaller shot2code-backend.spec --noconfirm

from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = []
binaries = []
hiddenimports = []

# These packages load code and data dynamically, so PyInstaller's static
# analysis misses parts of them.
for package in (
    "uvicorn",
    "fastapi",
    "starlette",
    "pydantic",
    "openai",
    "anthropic",
    "google.genai",
    "langfuse",
    "playwright",
    "copilot",
    "moviepy",
    "PIL",
    "pillow_heif",
):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        # An optional dependency that isn't installed shouldn't fail the build.
        pass

# uvicorn resolves its protocol/loop implementations by string at runtime.
hiddenimports += collect_submodules("uvicorn")

# The app's own first-party modules are imported dynamically via the routers.
for package in ("routes", "agent", "prompts", "codegen", "evals", "image_generation"):
    hiddenimports += collect_submodules(package)

# Prompt templates and other non-Python assets live next to the source.
datas += [("prompts", "prompts")]


a = Analysis(
    ["desktop_entry.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "pyright"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="shot2code-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Console mode so the backend's stdout/stderr reach Electron, which spawns
    # it with windowsHide so no console window is visible to the user.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="shot2code-backend",
)
