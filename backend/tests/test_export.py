import json
from io import BytesIO
from zipfile import ZipFile

import httpx
import pytest
from fastapi import HTTPException

from routes.export import (
    EXPORT_STRATEGIES,
    ExportProjectPayload,
    ExportRequest,
    export_archive_filename,
    export_code,
    parse_srcset,
)
from tests.export_stack_fixtures import (
    DATA_IMAGE,
    EXPECTED_BEHAVIOR_MARKERS,
    EXPECTED_CODEPEN_RESOURCES,
    EXPECTED_RUNTIME_MARKERS,
    PROJECT_KINDS,
    PROJECT_PAYLOAD_FIXTURES,
    STACK_FIXTURES,
)

SUPPORTED_STACKS = tuple(STACK_FIXTURES)
GENERIC_PROJECT_STACKS = tuple(
    stack for stack, kind in PROJECT_KINDS.items() if kind == "vite_html"
)


def archive_files(
    response_body: bytes | memoryview,
) -> tuple[set[str], dict[str, bytes]]:
    with ZipFile(BytesIO(bytes(response_body))) as archive:
        names = set(archive.namelist())
        return names, {name: archive.read(name) for name in names}


def decoded(files: dict[str, bytes], path: str) -> str:
    return files[path].decode("utf-8")


def test_export_strategy_table_covers_every_supported_stack() -> None:
    assert tuple(EXPORT_STRATEGIES) == SUPPORTED_STACKS
    assert {
        stack: strategy.project_kind
        for stack, strategy in EXPORT_STRATEGIES.items()
    } == PROJECT_KINDS
    assert {
        stack: strategy.codepen_resources
        for stack, strategy in EXPORT_STRATEGIES.items()
    } == EXPECTED_CODEPEN_RESOURCES


@pytest.mark.parametrize("stack", SUPPORTED_STACKS)
@pytest.mark.asyncio
async def test_single_html_export_matrix_is_standalone(stack: str) -> None:
    response = await export_code(ExportRequest(code=STACK_FIXTURES[stack], stack=stack))

    assert response.headers["content-disposition"] == (
        f'attachment; filename="shot2code-{stack.replace("_", "-")}-single-html.zip"'
    )
    names, files = archive_files(response.body)
    assert names == {"index.html", "assets/image-1.png"}

    index_html = decoded(files, "index.html")
    assert EXPECTED_RUNTIME_MARKERS[stack] in index_html
    for runtime_resource in EXPECTED_CODEPEN_RESOURCES[stack]:
        assert runtime_resource in index_html
    for behavior_marker in EXPECTED_BEHAVIOR_MARKERS[stack]:
        assert behavior_marker in index_html
    if stack == "ionic_tailwind":
        assert "nomodule" not in index_html
        assert "ionicons/+esm" not in index_html
    assert DATA_IMAGE not in index_html
    assert 'src="assets/image-1.png"' in index_html
    assert files["assets/image-1.png"] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize("stack", SUPPORTED_STACKS)
@pytest.mark.asyncio
async def test_project_export_matrix_has_working_structure(stack: str) -> None:
    response = await export_code(
        ExportRequest(code=STACK_FIXTURES[stack], stack=stack, splitFiles=True)
    )

    assert response.headers["content-disposition"] == (
        f'attachment; filename="shot2code-{stack.replace("_", "-")}-project.zip"'
    )
    names, files = archive_files(response.body)
    common = {
        "index.html",
        "package.json",
        "vite.config.js",
        "README.md",
        "assets/image-1.png",
    }
    if PROJECT_KINDS[stack] == "vite_react":
        assert names == common | {"src/App.jsx", "src/main.jsx", "src/styles.css"}
    elif PROJECT_KINDS[stack] == "vite_preact":
        assert names == common | {"src/main.js", "src/styles.css"}
    else:
        assert names == common | {"build.mjs", "styles.css", "script.js"}

    package = json.loads(decoded(files, "package.json"))
    expected_build = (
        "node build.mjs"
        if PROJECT_KINDS[stack] == "vite_html"
        else "vite build"
    )
    assert package["scripts"] == {
        "dev": "vite",
        "build": expected_build,
        "preview": "vite preview",
    }
    assert package["devDependencies"]["vite"].startswith("^6.")
    assert "npm run build" in decoded(files, "README.md")
    if PROJECT_KINDS[stack] == "vite_html":
        assert "cpSync" in decoded(files, "build.mjs")
        assert "does not rebundle inline modules" in decoded(files, "README.md")
    else:
        assert "shot2code-copy-static" in decoded(files, "vite.config.js")
    assert files["assets/image-1.png"] == b"\x89PNG\r\n\x1a\n"

    index_html = decoded(files, "index.html")
    if stack == "react_tailwind":
        assert "text/babel" not in index_html
        assert "@babel/standalone" not in index_html
        assert "umd/react" not in index_html
        assert 'src="/src/main.jsx"' in index_html
        assert "https://cdn.tailwindcss.com/3.4.17" in index_html
        assert package["dependencies"] == {
            "react": "^18.3.1",
            "react-dom": "^18.3.1",
        }
        app = decoded(files, "src/App.jsx")
        assert 'from "react"' in app
        assert "ReactDOM.createRoot" in app
    elif stack == "preact_tailwind":
        assert "esm.sh/preact" not in index_html
        assert 'src="/src/main.js"' in index_html
        assert package["dependencies"] == {
            "htm": "^3.1.1",
            "preact": "^10.26.4",
        }
        main = decoded(files, "src/main.js")
        assert 'from "preact"' in main
        assert 'from "preact/hooks"' in main
        assert 'from "htm"' in main
        assert "https://esm.sh" not in main
    else:
        assert EXPECTED_RUNTIME_MARKERS[stack] in index_html
        assert f".fixture-{stack.replace('_', '-')}" in decoded(files, "styles.css")
        assert stack in decoded(files, "script.js")
        assert 'href="styles.css"' in index_html
        assert 'src="script.js"' in index_html


@pytest.mark.parametrize(
    ("stack", "module_marker"),
    [
        (
            "material_web",
            'import { styles as typescaleStyles } from "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js"',
        ),
    ],
)
@pytest.mark.asyncio
async def test_generic_projects_preserve_inline_module_imports_and_order(
    stack: str, module_marker: str
) -> None:
    response = await export_code(
        ExportRequest(code=STACK_FIXTURES[stack], stack=stack, splitFiles=True)
    )
    _names, files = archive_files(response.body)
    index_html = decoded(files, "index.html")

    assert module_marker in index_html
    assert index_html.index(module_marker) < index_html.index('src="script.js"')


@pytest.mark.asyncio
async def test_split_preserves_unsafe_classic_script_order() -> None:
    code = '''<html><head>
<script src="https://example.com/before.js"></script>
<script>window.order = ["first"];</script>
<script type="module">import value from "https://example.com/module.js"; window.value = value;</script>
<script>window.order.push("second");</script>
<script src="https://example.com/after.js"></script>
</head><body></body></html>'''

    response = await export_code(
        ExportRequest(code=code, stack="html_css", splitFiles=True)
    )
    _names, files = archive_files(response.body)
    index_html = decoded(files, "index.html")

    assert 'window.order = ["first"]' in index_html
    assert 'window.order.push("second")' in index_html
    assert 'import value from "https://example.com/module.js"' in index_html
    assert index_html.index("before.js") < index_html.index("first")
    assert index_html.index("first") < index_html.index("module.js")
    assert index_html.index("module.js") < index_html.index("second")
    assert index_html.index("second") < index_html.index("after.js")
    assert decoded(files, "script.js") == "// Add project scripts here.\n"


@pytest.mark.asyncio
async def test_split_preserves_special_style_and_script_types() -> None:
    code = '''<html><head>
<style type="text/tailwindcss">@theme { --color-brand: red; }</style>
<script type="importmap">{"imports":{"pkg":"https://example.com/pkg.js"}}</script>
<script type="application/ld+json">{"name":"fixture"}</script>
</head><body></body></html>'''

    response = await export_code(
        ExportRequest(code=code, stack="html_tailwind", splitFiles=True)
    )
    _names, files = archive_files(response.body)
    index_html = decoded(files, "index.html")

    assert 'type="text/tailwindcss"' in index_html
    assert 'type="importmap"' in index_html
    assert 'type="application/ld+json"' in index_html
    assert decoded(files, "styles.css") == "/* Add project styles here. */\n"
    assert decoded(files, "script.js") == "// Add project scripts here.\n"


@pytest.mark.asyncio
async def test_srcset_parser_and_export_preserve_data_url_commas() -> None:
    assert parse_srcset("first.png,second.png 2x") == ["first.png", "second.png"]
    svg = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"
    png = DATA_IMAGE
    srcset = f"{svg} 1x, {png} 2x"
    assert parse_srcset(srcset) == [svg, png]

    response = await export_code(
        ExportRequest(code=f'<html><body><img srcset="{srcset}"></body></html>')
    )
    names, files = archive_files(response.body)
    assert names == {
        "index.html",
        "assets/image-1.svg",
        "assets/image-2.png",
    }
    index_html = decoded(files, "index.html")
    assert 'srcset="assets/image-1.svg 1x, assets/image-2.png 2x"' in index_html


@pytest.mark.asyncio
async def test_export_downloads_font_assets_referenced_by_css(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    font_url = "https://fonts.example.test/inter.woff2"

    async def mock_fetch_remote_asset(
        _client: httpx.AsyncClient, fetch_url: str, extension_hint: str
    ) -> tuple[bytes, str] | None:
        assert fetch_url == font_url
        assert extension_hint == "woff2"
        return b"font-bytes", "woff2"

    monkeypatch.setattr("routes.export.fetch_remote_asset", mock_fetch_remote_asset)
    response = await export_code(
        ExportRequest(
            code=f'''<html><head><style>@font-face {{ font-family: Inter; src: url("{font_url}") format("woff2"); }}</style></head><body></body></html>'''
        )
    )
    names, files = archive_files(response.body)
    assert names == {"index.html", "assets/image-1.woff2"}
    assert 'url("assets/image-1.woff2")' in decoded(files, "index.html")
    assert files["assets/image-1.woff2"] == b"font-bytes"


@pytest.mark.asyncio
async def test_react_project_falls_back_without_fake_source_extraction() -> None:
    code = '''<html><head>
<script src="https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"></script>
</head><body><div id="root"></div>
<script type="text/babel">function App() { return <div>A</div>; }</script>
<script type="text/babel">ReactDOM.render(<App />, document.getElementById("root"));</script>
</body></html>'''

    response = await export_code(
        ExportRequest(code=code, stack="react_tailwind", splitFiles=True)
    )
    names, files = archive_files(response.body)
    assert "src/App.jsx" not in names
    assert "text/babel" in decoded(files, "index.html")
    assert "## Safe fallback" in decoded(files, "README.md")
    package = json.loads(decoded(files, "package.json"))
    assert "dependencies" not in package


@pytest.mark.asyncio
async def test_export_filename_is_sanitized_for_unknown_stack() -> None:
    assert export_archive_filename("Custom / Stack", False) == (
        "shot2code-custom-stack-single-html.zip"
    )
    response = await export_code(
        ExportRequest(code="<html></html>", stack="Custom / Stack")
    )
    assert response.headers["content-disposition"] == (
        'attachment; filename="shot2code-custom-stack-single-html.zip"'
    )


@pytest.mark.parametrize("stack", tuple(PROJECT_PAYLOAD_FIXTURES))
@pytest.mark.asyncio
async def test_multifile_framework_payloads_are_preserved(
    stack: str,
) -> None:
    project = ExportProjectPayload.model_validate(PROJECT_PAYLOAD_FIXTURES[stack])
    preview_fallback = "<!doctype html><p>preview-only fallback</p>"

    response = await export_code(
        ExportRequest(
            code=preview_fallback,
            stack=stack,
            splitFiles=True,
            project=project,
        )
    )
    names, files = archive_files(response.body)
    expected = {file.path: file.content for file in project.files}

    assert names == set(expected)
    for file_path, content in expected.items():
        assert decoded(files, file_path) == content
    assert all(b"preview-only fallback" not in content for content in files.values())


@pytest.mark.asyncio
async def test_single_index_project_payload_uses_validated_stack_scaffold() -> None:
    project = ExportProjectPayload.model_validate(
        {
            "entryPoint": "index.html",
            "files": [
                {
                    "path": "index.html",
                    "content": STACK_FIXTURES["react_tailwind"],
                    "language": "html",
                    "type": "markup",
                }
            ],
        }
    )

    response = await export_code(
        ExportRequest(
            code="<p>stale preview</p>",
            stack="react_tailwind",
            splitFiles=True,
            project=project,
        )
    )
    names, files = archive_files(response.body)

    assert "src/App.jsx" in names
    assert "package.json" in names
    assert "stale preview" not in decoded(files, "index.html")


@pytest.mark.asyncio
async def test_source_project_without_build_config_uses_documented_fallback() -> None:
    source = "export default function App() { return <main>Source</main>; }\n"
    response = await export_code(
        ExportRequest.model_validate(
            {
                "code": "<!doctype html><p>preview-only fallback</p>",
                "stack": "react_tailwind",
                "splitFiles": True,
                "project": {
                    "entryPoint": "src/App.tsx",
                    "files": [
                        {
                            "path": "src/App.tsx",
                            "content": source,
                            "language": "tsx",
                            "type": "component",
                            "readonly": False,
                            "generated": False,
                            "metadata": {"origin": "import"},
                        },
                        {
                            "path": "README.md",
                            "content": "# Existing documentation\n",
                            "language": "markdown",
                            "type": "documentation",
                        },
                    ],
                },
            }
        )
    )
    names, files = archive_files(response.body)

    assert names == {"src/App.tsx", "README.md", "SHOT2CODE_EXPORT.md"}
    assert decoded(files, "src/App.tsx") == source
    assert decoded(files, "README.md") == "# Existing documentation\n"
    assert "preview-only fallback" not in b"".join(files.values()).decode("utf-8")
    notice = decoded(files, "SHOT2CODE_EXPORT.md")
    assert "## Safe fallback" in notice
    assert "`src/App.tsx`" in notice
    assert "valid root `package.json`" in notice
    assert "non-empty `build` script" in notice


@pytest.mark.asyncio
async def test_source_project_assets_use_file_relative_paths_and_avoid_collisions() -> None:
    svg = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"
    font = "data:font/woff2;base64,Zm9udC1ieXRlcw=="
    module_before = 'import value from "https://example.com/module.js";'
    module_after = 'import other from "https://example.com/other.js";'
    html = f'''<!doctype html><html><body>
<img srcset="{svg} 1x, {DATA_IMAGE} 2x">
<script type="module">{module_before}</script>
<script type="module">{module_after}</script>
</body></html>'''
    css = f'''@font-face {{ font-family: Fixture; src: url("{font}") format("woff2"); }}\n'''
    project = ExportProjectPayload.model_validate(
        {
            "entryPoint": "site/index.html",
            "files": [
                {"path": "site/index.html", "content": html},
                {"path": "src/styles/site.css", "content": css},
                {"path": "assets/image-1.svg", "content": "<svg />\n"},
                {"path": "docs/asset-notes.md", "content": f"Example: {svg}\n"},
            ],
        }
    )

    response = await export_code(
        ExportRequest(
            code="<!doctype html><p>preview fallback</p>",
            stack="html_css",
            splitFiles=True,
            project=project,
        )
    )
    names, files = archive_files(response.body)

    assert "assets/image-1.svg" in names
    assert files["assets/image-1.svg"] == b"<svg />\n"
    assert files["assets/image-1-2.svg"].startswith(b"<svg")
    assert files["assets/image-2.png"] == b"\x89PNG\r\n\x1a\n"
    assert files["assets/image-3.woff2"] == b"font-bytes"
    assert decoded(files, "docs/asset-notes.md") == f"Example: {svg}\n"

    index_html = decoded(files, "site/index.html")
    assert (
        'srcset="../assets/image-1-2.svg 1x, ../assets/image-2.png 2x"'
        in index_html
    )
    assert index_html.index(module_before) < index_html.index(module_after)
    assert (
        'url("../../assets/image-3.woff2")'
        in decoded(files, "src/styles/site.css")
    )


@pytest.mark.parametrize(
    "unsafe_path",
    ["../secret.txt", "C:\\secret.txt", "/root.txt", "src//App.tsx"],
)
@pytest.mark.asyncio
async def test_project_payload_rejects_unsafe_paths(unsafe_path: str) -> None:
    request = ExportRequest(
        code="<html></html>",
        splitFiles=True,
        project=ExportProjectPayload.model_validate(
            {
                "entryPoint": unsafe_path,
                "files": [{"path": unsafe_path, "content": "secret"}],
            }
        ),
    )

    with pytest.raises(HTTPException) as error:
        await export_code(request)

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_project_payload_rejects_case_insensitive_duplicate_paths() -> None:
    request = ExportRequest(
        code="<html></html>",
        splitFiles=True,
        project=ExportProjectPayload.model_validate(
            {
                "entryPoint": "src/App.tsx",
                "files": [
                    {"path": "src/App.tsx", "content": "first"},
                    {"path": "SRC/app.tsx", "content": "second"},
                ],
            }
        ),
    )

    with pytest.raises(HTTPException, match="Duplicate project file path"):
        await export_code(request)
