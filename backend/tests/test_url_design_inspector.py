import pytest

from free_images.download import ImageDownloadRejected
from routes.url_design_inspector import validate_public_website_url


def test_public_website_url_defaults_to_https(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "routes.url_design_inspector.resolve_public_addresses",
        lambda _host: ["93.184.216.34"],
    )
    assert validate_public_website_url("example.com") == "https://example.com"


def test_public_website_url_rejects_private_destinations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject(_host: str) -> list[str]:
        raise ImageDownloadRejected("blocked")

    monkeypatch.setattr(
        "routes.url_design_inspector.resolve_public_addresses",
        reject,
    )
    with pytest.raises(ValueError, match="public internet addresses"):
        validate_public_website_url("http://localhost:7001/private")


@pytest.mark.parametrize(
    "url",
    [
        "file:///C:/secret.html",
        "javascript:alert(1)",
        "https://user:password@example.com",
    ],
)
def test_public_website_url_rejects_unsafe_schemes_and_credentials(
    url: str,
) -> None:
    with pytest.raises(ValueError):
        validate_public_website_url(url)
