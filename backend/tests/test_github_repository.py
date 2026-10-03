from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from starlette.requests import Request

from routes.github_repository import (
    GitHubRepositoryInspectRequest,
    inspect_github_repository,
    parse_github_repository_url,
)


def repository_zip() -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "example-main/index.html",
            "<main><h1>Imported</h1></main>",
        )
        archive.writestr(
            "example-main/styles.css",
            "main { color: rebeccapurple; }",
        )
        archive.writestr(
            "example-main/assets/logo.png",
            b"\x89PNG\r\n\x1a\nlogo",
        )
        archive.writestr(
            "example-main/node_modules/ignored.js",
            "throw new Error('never read')",
        )
    return output.getvalue()


def local_request() -> Request:
    return Request(
        {
            "type": "http",
            "scheme": "http",
            "server": ("127.0.0.1", 7001),
            "path": "/api/github-repository/inspect",
            "root_path": "",
            "headers": [],
        }
    )


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://github.com/owner/repository",
            ("owner", "repository", None),
        ),
        (
            "https://github.com/owner/repository.git",
            ("owner", "repository", None),
        ),
        (
            "https://github.com/owner/repository/tree/main",
            ("owner", "repository", "main"),
        ),
    ],
)
def test_parse_github_repository_url(
    url: str,
    expected: tuple[str, str, str | None],
) -> None:
    assert parse_github_repository_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/owner/repository",
        "https://example.com/owner/repository",
        "https://github.com/owner",
    ],
)
def test_parse_github_repository_url_rejects_other_locations(url: str) -> None:
    with pytest.raises(ValueError):
        parse_github_repository_url(url)


@pytest.mark.asyncio
async def test_repository_archive_uses_existing_safe_project_scanner(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    async def fake_download(
        _owner: str,
        _repository: str,
        _ref: str | None,
        _token: str | None,
    ) -> bytes:
        return repository_zip()

    monkeypatch.setattr(
        "routes.github_repository._download_repository_zip",
        fake_download,
    )
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    result = await inspect_github_repository(
        GitHubRepositoryInspectRequest(
            url="https://github.com/owner/example",
            token=None,
        ),
        local_request(),
    )

    assert result.project.name == "example"
    assert result.project.entry_path == "index.html"
    assert [file.path for file in result.project.files] == [
        "index.html",
        "styles.css",
    ]
    assert result.project.ignored_file_count == 1
    assert [asset.path for asset in result.assets] == ["assets/logo.png"]
    assert result.sourceAssets[0]["source"] == "github"
    assert result.sourceAssets[0]["url"].startswith(
        "http://127.0.0.1:7001/local-assets/"
    )
