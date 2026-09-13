import json
import stat
import struct
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import routes.project_context as project_context
from routes.project_context import (
    MAX_FILE_BYTES,
    MAX_FILES,
    MAX_SELECTED_ENTRIES,
    MAX_TOTAL_BYTES,
    ProjectFile,
    ScannableFile,
    collect_files,
    decode_zip_files,
    detect_project_stack,
    discover_dependencies,
    normalize_project_path,
    router,
    scan_project,
)


def make_zip(
    entries: list[tuple[str | ZipInfo, str | bytes]],
    compression: int = ZIP_DEFLATED,
) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression) as archive:
        for path, content in entries:
            archive.writestr(path, content)
    return buffer.getvalue()


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def detected_stack(files: list[ProjectFile]) -> project_context.StackDetection:
    collected = collect_files(files)
    return detect_project_stack(discover_dependencies(collected), collected)


def test_scans_components_dependencies_and_tokens() -> None:
    raw_files = [
        ProjectFile(
            path="sample/package.json",
            content="""
            {
              "dependencies": {
                "react": "^18.0.0",
                "tailwindcss": "^3.4.0",
                "@radix-ui/react-dialog": "^1.0.0"
              }
            }
            """,
        ),
        ProjectFile(
            path="sample/src/components/ui/Button.tsx",
            content="""
            interface ButtonProps {
              variant?: "primary" | "ghost";
              size?: "sm" | "md";
              disabled?: boolean;
            }
            export function Button({ variant, size, disabled }: ButtonProps) {
              return <button disabled={disabled} data-variant={variant} />;
            }
            interface CardProps {
              title: string;
            }
            export const Card = ({ title }: CardProps) => <article>{title}</article>;
            """,
        ),
        ProjectFile(
            path="sample/src/styles/theme.css",
            content="""
            :root {
              --color-primary: #4f46e5;
              --radius-card: 14px;
            }
            .surface-card { border-radius: var(--radius-card); }
            """,
        ),
        ProjectFile(
            path="sample/node_modules/ignored/index.tsx",
            content="export function ShouldNotAppear() { return null; }",
        ),
    ]

    files = collect_files(raw_files)
    result = scan_project("sample", files, len(raw_files))

    assert result.analyzed_file_count == 3
    assert result.component_count == 2
    assert result.components[0].name == "Button"
    assert result.components[0].props == ["variant", "size", "disabled"]
    assert result.components[1].name == "Card"
    assert result.components[1].props == ["title"]
    assert "react" in result.dependencies
    assert "React" in result.framework_hints
    assert "Tailwind CSS" in result.framework_hints
    assert "shadcn/ui" in result.framework_hints
    assert "--color-primary: #4f46e5" in result.tokens
    assert "ShouldNotAppear" not in result.summary


@pytest.mark.parametrize(
    ("files", "expected_stack", "expected_hint"),
    [
        (
            [ProjectFile(path="index.html", content="<main>Hello</main>")],
            "html_css",
            None,
        ),
        (
            [
                ProjectFile(
                    path="index.html",
                    content='<script src="https://cdn.tailwindcss.com"></script>',
                )
            ],
            "html_tailwind",
            "Tailwind CSS",
        ),
        (
            [
                ProjectFile(
                    path="package.json",
                    content=json.dumps(
                        {"dependencies": {"react": "latest", "bootstrap": "latest"}}
                    ),
                ),
                ProjectFile(path="src/App.tsx", content="export const App = () => <main />;"),
            ],
            "react_tailwind",
            "React",
        ),
        (
            [
                ProjectFile(
                    path="index.html",
                    content='<link href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css">',
                )
            ],
            "bootstrap",
            "Bootstrap",
        ),
        (
            [ProjectFile(path="src/App.vue", content="<template><main /></template>")],
            "vue_tailwind",
            "Vue",
        ),
        (
            [
                ProjectFile(
                    path="package.json",
                    content=json.dumps(
                        {"dependencies": {"@ionic/react": "latest", "react": "latest"}}
                    ),
                )
            ],
            "ionic_tailwind",
            "Ionic",
        ),
        (
            [
                ProjectFile(
                    path="index.html",
                    content='<main x-data="{}"></main><script src="https://cdn.tailwindcss.com"></script>',
                )
            ],
            "alpine_tailwind",
            "Alpine.js",
        ),
        (
            [
                ProjectFile(
                    path="package.json",
                    content=json.dumps({"dependencies": {"preact": "latest"}}),
                ),
                ProjectFile(path="src/app.tsx", content="export function App() { return <main />; }"),
            ],
            "preact_tailwind",
            "Preact",
        ),
        (
            [
                ProjectFile(
                    path="package.json",
                    content=json.dumps(
                        {"devDependencies": {"tailwindcss": "latest", "daisyui": "latest"}}
                    ),
                )
            ],
            "tailwind_daisyui",
            "daisyUI",
        ),
        (
            [
                ProjectFile(
                    path="index.html",
                    content='<link href="https://cdn.jsdelivr.net/npm/bulma@1/css/bulma.min.css">',
                )
            ],
            "bulma",
            "Bulma",
        ),
        (
            [
                ProjectFile(
                    path="index.html",
                    content='<script type="module">import "@material/web/all.js";</script><md-filled-button>Save</md-filled-button>',
                )
            ],
            "material_web",
            "Material Web",
        ),
        (
            [
                ProjectFile(
                    path="index.html",
                    content='<button hx-post="/save">Save</button><script src="https://unpkg.com/htmx.org"></script>',
                )
            ],
            "htmx_tailwind",
            "htmx",
        ),
    ],
)
def test_detects_every_supported_stack(
    files: list[ProjectFile],
    expected_stack: str,
    expected_hint: str | None,
) -> None:
    detection = detected_stack(files)

    assert detection.detected_stack == expected_stack
    assert detection.confidence > 0
    assert detection.reasons
    if expected_hint is not None:
        assert expected_hint in detection.framework_hints


@pytest.mark.parametrize(
    ("source", "expected_stack"),
    [
        ('<link href="/assets/bootstrap.css">', "bootstrap"),
        ('<button data-bs-toggle="modal">Open</button>', "bootstrap"),
        ('<link href="https://cdn.example/bulma.css">', "bulma"),
        ('<script src="https://unpkg.com/alpinejs"></script>', "alpine_tailwind"),
        ('<script src="https://unpkg.com/@ionic/core"></script>', "ionic_tailwind"),
    ],
)
def test_detects_supported_stack_signatures_from_common_cdn_markup(
    source: str, expected_stack: str
) -> None:
    detection = detected_stack([ProjectFile(path="index.html", content=source)])

    assert detection.detected_stack == expected_stack


def test_detects_framework_dependencies_beyond_summary_limit() -> None:
    dependencies = {f"a-package-{index:03}": "latest" for index in range(100)}
    dependencies["vue"] = "latest"
    files = [
        ProjectFile(
            path="package.json", content=json.dumps({"dependencies": dependencies})
        )
    ]

    assert discover_dependencies(collect_files(files)) == sorted(dependencies)[:80]
    assert detected_stack(files).detected_stack == "vue_tailwind"


def test_runtime_framework_evidence_beats_styling_library() -> None:
    detection = detected_stack(
        [
            ProjectFile(
                path="package.json",
                content=json.dumps(
                    {"dependencies": {"react": "latest", "bootstrap": "latest"}}
                ),
            )
        ]
    )

    assert detection.detected_stack == "react_tailwind"
    assert "React" in detection.framework_hints
    assert "Bootstrap" in detection.framework_hints
    assert any("takes precedence" in reason for reason in detection.reasons)

@pytest.mark.parametrize(
    ("raw_path", "message"),
    [
        ("/absolute/App.tsx", "absolute"),
        (r"C:\project\App.tsx", "drive-qualified"),
        (r"\\server\share\App.tsx", "absolute and UNC"),
        ("src/../App.tsx", "traversal"),
        ("src/Bad\x00Name.tsx", "NUL"),
    ],
)
def test_rejects_unsafe_direct_paths(raw_path: str, message: str) -> None:
    with pytest.raises(HTTPException, match=message) as error:
        collect_files([ProjectFile(path=raw_path, content="export const App = 1;")])

    assert error.value.status_code == 400


def test_normalizes_safe_paths_and_skips_case_insensitive_ignored_directories() -> None:
    assert normalize_project_path(r"Wrapper\src\.\App.TSX") == "Wrapper/src/App.TSX"
    assert normalize_project_path("Wrapper/NoDe_MoDuLeS/pkg/index.ts") is None
    assert normalize_project_path("Wrapper/public/logo.png") is None


def test_rejects_drive_path_hidden_behind_current_directory_segment() -> None:
    with pytest.raises(HTTPException, match="drive-qualified") as error:
        collect_files(
            [ProjectFile(path="./C:/project/App.tsx", content="export const App = 1;")]
        )

    assert error.value.status_code == 400


def test_rejects_duplicate_normalized_paths() -> None:
    with pytest.raises(HTTPException, match="Duplicate normalized project path"):
        collect_files(
            [
                ProjectFile(path=r"src\App.tsx", content="one"),
                ProjectFile(path="src/./app.tsx", content="two"),
            ]
        )


@pytest.mark.parametrize(
    "unsafe_path",
    ["../escape.tsx", "/absolute/logo.png", r"C:\escape\logo.png"],
)
def test_zip_rejects_unsafe_paths_even_for_unsupported_entries(
    unsafe_path: str,
) -> None:
    payload = make_zip(
        [
            ("project/src/App.tsx", "export const App = () => <main />;"),
            (unsafe_path, b"not relevant"),
        ]
    )

    with pytest.raises(HTTPException, match="Invalid project path") as error:
        decode_zip_files(payload)

    assert error.value.status_code == 400


def test_zip_rejects_duplicate_normalized_paths() -> None:
    payload = make_zip(
        [
            (r"project\src\App.tsx", "one"),
            ("project/src/./app.tsx", "two"),
        ]
    )

    with pytest.raises(HTTPException, match="Duplicate normalized ZIP path"):
        decode_zip_files(payload)


def test_unsupported_and_ignored_direct_entries_do_not_consume_supported_limit() -> None:
    raw_files = [
        ProjectFile(path=f"assets/image-{index}.png", content="binary-placeholder")
        for index in range(MAX_FILES + 1)
    ]
    raw_files.extend(
        ProjectFile(
            path=f"NODE_MODULES/pkg-{index}/index.ts",
            content="export default {};",
        )
        for index in range(MAX_FILES + 1)
    )
    raw_files.append(
        ProjectFile(path="src/App.tsx", content="export function App() { return <main />; }")
    )

    files = collect_files(raw_files)

    assert [file.path for file in files] == ["src/App.tsx"]


def test_unsupported_and_ignored_zip_entries_do_not_consume_supported_limit() -> None:
    entries: list[tuple[str | ZipInfo, str | bytes]] = []
    entries.extend(
        (f"project/node_modules/pkg-{index}/index.js", "module.exports = {};")
        for index in range(MAX_FILES + 1)
    )
    entries.extend(
        (f"project/assets/image-{index}.png", b"\x89PNG\r\n\x1a\n")
        for index in range(MAX_FILES + 1)
    )
    entries.append(("project/src/App.tsx", "export function App() { return <main />; }"))

    name, files = decode_zip_files(make_zip(entries))

    assert name == "project"
    assert [file.path for file in files] == ["project/src/App.tsx"]


@pytest.mark.parametrize("content", ["const value = '\x00';", "\x01" * 100])
def test_direct_supported_binary_source_is_rejected(content: str) -> None:
    with pytest.raises(HTTPException, match="binary data") as error:
        collect_files([ProjectFile(path="src/data.js", content=content)])

    assert error.value.status_code == 400


@pytest.mark.parametrize("content", [b"\xff\xfe", b"\x00" * 20])
def test_zip_supported_binary_or_invalid_utf8_is_rejected(content: bytes) -> None:
    payload = make_zip([("project/src/data.js", content)])

    with pytest.raises(HTTPException) as error:
        decode_zip_files(payload)

    assert error.value.status_code == 400
    assert "UTF-8" in error.value.detail or "binary data" in error.value.detail


def test_binary_unsupported_zip_asset_is_skipped() -> None:
    payload = make_zip(
        [
            ("project/public/logo.png", b"\x00\xff\x00\xff"),
            ("project/index.html", "<main>Hello</main>"),
        ]
    )

    _, files = decode_zip_files(payload)

    assert [file.path for file in files] == ["project/index.html"]


def test_direct_rejects_selected_and_supported_file_count_limits() -> None:
    too_many_selected = [
        ProjectFile(path=f"assets/{index}.png", content="")
        for index in range(MAX_SELECTED_ENTRIES + 1)
    ]
    with pytest.raises(HTTPException, match="selected entries") as selected_error:
        collect_files(too_many_selected)
    assert selected_error.value.status_code == 413

    too_many_supported = [
        ProjectFile(path=f"src/file-{index}.ts", content="")
        for index in range(MAX_FILES + 1)
    ]
    with pytest.raises(HTTPException, match="supported source files") as supported_error:
        collect_files(too_many_supported)
    assert supported_error.value.status_code == 413


def test_direct_rejects_per_file_and_aggregate_byte_limits() -> None:
    with pytest.raises(HTTPException, match="too large") as file_error:
        collect_files(
            [ProjectFile(path="src/large.ts", content="x" * (MAX_FILE_BYTES + 1))]
        )
    assert file_error.value.status_code == 413

    aggregate_files = [
        ProjectFile(path=f"src/part-{index}.ts", content="x" * MAX_FILE_BYTES)
        for index in range((MAX_TOTAL_BYTES // MAX_FILE_BYTES) + 1)
    ]
    with pytest.raises(HTTPException, match="Project source is too large") as total_error:
        collect_files(aggregate_files)
    assert total_error.value.status_code == 413


def test_zip_rejects_entry_count_per_file_and_aggregate_limits() -> None:
    too_many_entries = make_zip(
        [(f"assets/{index}.png", b"") for index in range(MAX_SELECTED_ENTRIES + 1)]
    )
    with pytest.raises(HTTPException, match="too many entries") as entries_error:
        decode_zip_files(too_many_entries)
    assert entries_error.value.status_code == 413

    oversized = make_zip(
        [("project/src/large.ts", "x" * (MAX_FILE_BYTES + 1))]
    )
    with pytest.raises(HTTPException, match="too large") as file_error:
        decode_zip_files(oversized)
    assert file_error.value.status_code == 413

    aggregate_count = (MAX_TOTAL_BYTES // MAX_FILE_BYTES) + 1
    aggregate = make_zip(
        [
            (f"project/src/part-{index}.ts", "x" * MAX_FILE_BYTES)
            for index in range(aggregate_count)
        ]
    )
    with pytest.raises(HTTPException, match="ZIP source is too large") as total_error:
        decode_zip_files(aggregate)
    assert total_error.value.status_code == 413

def test_malformed_zip_is_rejected() -> None:
    with pytest.raises(HTTPException, match="not a valid ZIP archive") as error:
        decode_zip_files(b"not a zip")

    assert error.value.status_code == 400


def test_corrupt_zip_member_is_reported_as_malformed() -> None:
    payload = bytearray(
        make_zip([("project/index.html", b"unique payload")], compression=ZIP_STORED)
    )
    content_offset = payload.find(b"unique payload")
    assert content_offset >= 0
    payload[content_offset] ^= 0xFF

    with pytest.raises(HTTPException, match="not a valid ZIP archive") as error:
        decode_zip_files(bytes(payload))

    assert error.value.status_code == 400


def test_zip_symlink_is_rejected() -> None:
    symlink = ZipInfo("project/src/link.ts")
    symlink.create_system = 3
    symlink.external_attr = (stat.S_IFLNK | 0o777) << 16

    with pytest.raises(HTTPException, match="Symbolic-link") as error:
        decode_zip_files(make_zip([(symlink, "target.ts")]))

    assert error.value.status_code == 400


def test_encrypted_zip_entry_is_rejected() -> None:
    payload = bytearray(make_zip([("project/index.html", "<main />")], ZIP_STORED))
    local_header = payload.find(b"PK\x03\x04")
    central_header = payload.find(b"PK\x01\x02")
    assert local_header >= 0
    assert central_header >= 0
    local_flags = struct.unpack_from("<H", payload, local_header + 6)[0]
    central_flags = struct.unpack_from("<H", payload, central_header + 8)[0]
    struct.pack_into("<H", payload, local_header + 6, local_flags | 0x1)
    struct.pack_into("<H", payload, central_header + 8, central_flags | 0x1)

    with pytest.raises(HTTPException, match="Encrypted ZIP entry") as error:
        decode_zip_files(bytes(payload))

    assert error.value.status_code == 400


def test_zip_request_stream_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(project_context, "MAX_ARCHIVE_BYTES", 8)

    response = make_client().post(
        "/api/project-context/inspect-zip",
        content=b"123456789",
        headers={"Content-Type": "application/zip"},
    )

    assert response.status_code == 413
    assert "ZIP is too large" in response.json()["detail"]


def test_folder_inspection_strips_one_shared_wrapper_and_preserves_relative_paths() -> None:
    client = make_client()
    app_content = "export function App() { return <main>π</main>; }"
    response = client.post(
        "/api/project-context/inspect-files",
        json={
            "source_kind": "folder",
            "files": [
                {"path": r"Demo\src\App.tsx", "content": app_content},
                {
                    "path": "Demo/package.json",
                    "content": json.dumps({"dependencies": {"react": "latest"}}),
                },
                {"path": "Demo/public/logo.png", "content": "ignored"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"context", "project"}
    assert set(body["context"]) == {
        "name",
        "file_count",
        "analyzed_file_count",
        "component_count",
        "components",
        "dependencies",
        "tokens",
        "framework_hints",
        "summary",
    }
    assert set(body["project"]) == {
        "schema_version",
        "name",
        "source_kind",
        "files",
        "entry_path",
        "detected_stack",
        "confidence",
        "reasons",
        "framework_hints",
        "ignored_file_count",
        "warnings",
    }
    assert body["project"]["schema_version"] == 1
    assert body["project"]["name"] == "Demo"
    assert body["project"]["source_kind"] == "folder"
    assert body["project"]["entry_path"] == "src/App.tsx"
    assert body["project"]["detected_stack"] == "react_tailwind"
    assert body["project"]["ignored_file_count"] == 1
    assert [file["path"] for file in body["project"]["files"]] == [
        "src/App.tsx",
        "package.json",
    ]
    assert set(body["project"]["files"][0]) == {
        "path",
        "content",
        "language",
        "size_bytes",
    }
    assert body["project"]["files"][0] == {
        "path": "src/App.tsx",
        "content": app_content,
        "language": "typescript",
        "size_bytes": len(app_content.encode("utf-8")),
    }
    assert "files" not in body["context"]
    assert app_content not in body["context"]["summary"]


def test_files_inspection_does_not_strip_an_implicit_wrapper() -> None:
    response = make_client().post(
        "/api/project-context/inspect-files",
        json={
            "name": "chosen files",
            "source_kind": "files",
            "files": [
                {"path": "src/App.tsx", "content": "export const App = () => <main />;"},
                {"path": "src/theme.css", "content": ":root { --space: 1rem; }"},
            ],
        },
    )

    assert response.status_code == 200
    project = response.json()["project"]
    assert project["name"] == "chosen files"
    assert [file["path"] for file in project["files"]] == [
        "src/App.tsx",
        "src/theme.css",
    ]


def test_zip_inspection_strips_wrapper_and_reports_ignored_files() -> None:
    payload = make_zip(
        [
            ("Wrapped/index.html", "<main>Hello</main>"),
            ("Wrapped/styles/site.css", "main { color: navy; }"),
            ("Wrapped/assets/logo.png", b"\x89PNG\r\n\x1a\n"),
        ]
    )
    response = make_client().post(
        "/api/project-context/inspect-zip",
        content=payload,
        headers={"Content-Type": "application/zip"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["project"]["name"] == "Wrapped"
    assert body["project"]["source_kind"] == "zip"
    assert body["project"]["entry_path"] == "index.html"
    assert body["project"]["detected_stack"] == "html_css"
    assert [file["path"] for file in body["project"]["files"]] == [
        "index.html",
        "styles/site.css",
    ]
    assert body["project"]["ignored_file_count"] == 1
    assert body["context"]["file_count"] == 3
    assert body["context"]["analyzed_file_count"] == 2


def test_zip_without_one_wrapper_preserves_paths() -> None:
    payload = make_zip(
        [
            ("src/App.tsx", "export const App = () => <main />;"),
            ("package.json", json.dumps({"dependencies": {"react": "latest"}})),
        ]
    )
    response = make_client().post(
        "/api/project-context/inspect-zip",
        content=payload,
        headers={"X-Project-Name": "Explicit%20Name"},
    )

    assert response.status_code == 200
    project = response.json()["project"]
    assert project["name"] == "Explicit Name"
    assert [file["path"] for file in project["files"]] == [
        "src/App.tsx",
        "package.json",
    ]


def test_legacy_scan_endpoints_remain_context_only() -> None:
    client = make_client()
    files_response = client.post(
        "/api/project-context/scan-files",
        json={
            "name": "legacy",
            "files": [{"path": "index.html", "content": "<main />"}],
        },
    )
    zip_response = client.post(
        "/api/project-context/scan-zip",
        content=make_zip([("legacy/index.html", "<main />")]),
        headers={"X-Project-Name": "legacy"},
    )

    assert files_response.status_code == 200
    assert zip_response.status_code == 200
    assert "context" not in files_response.json()
    assert "project" not in files_response.json()
    assert "context" not in zip_response.json()
    assert "project" not in zip_response.json()


def test_scan_summary_warns_against_local_imports() -> None:
    files = collect_files(
        [
            ProjectFile(
                path="src/components/Panel.tsx",
                content="export function Panel() { return <section />; }",
            )
        ]
    )

    result = scan_project("demo", files, 1)

    assert "Existing components and public props" in result.summary
    assert "Panel (src/components/Panel.tsx)" in result.summary
    assert "do not import local files" in result.summary
