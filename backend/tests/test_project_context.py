from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from routes.project_context import (
    ProjectFile,
    collect_files,
    decode_zip_files,
    scan_project,
)


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
    assert result.component_count == 1
    assert result.components[0].name == "Button"
    assert result.components[0].props == ["variant", "size", "disabled"]
    assert "react" in result.dependencies
    assert "React" in result.framework_hints
    assert "Tailwind CSS" in result.framework_hints
    assert "--color-primary: #4f46e5" in result.tokens
    assert "ShouldNotAppear" not in result.summary


def test_zip_scan_ignores_traversal_and_binary_files() -> None:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "project/src/Card.tsx",
            "export const Card = ({ title }: { title: string }) => <div>{title}</div>;",
        )
        archive.writestr("../escape.tsx", "export function Escape() {}")
        archive.writestr("project/public/logo.png", b"\x89PNG\r\n\x1a\n")

    name, files = decode_zip_files(buffer.getvalue())
    result = scan_project(name, files, len(files))

    assert name == "Imported project"
    assert [file.path for file in files] == ["project/src/Card.tsx"]
    assert result.components[0].name == "Card"


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
