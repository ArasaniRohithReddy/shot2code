"""Validated image-generation configuration, built from the request payload.

Additive by construction. The default is exactly what shot2code has always
done - Replicate, ``prunaai/z-image-turbo``, the key from Settings or
``backend/.env`` - so a client that sends nothing about images keeps working
unchanged. Picking Cloudflare or an OpenAI-compatible endpoint is opt-in and
carries its own credentials; it never reads or re-routes ``REPLICATE_API_KEY``,
and choosing another provider does not disable Replicate.

Everything a user can type is validated here rather than at the call site:
endpoint URLs go through the same :func:`validate_endpoint_url` that the BYOK
connection uses (http/https only, no embedded credentials, plaintext only for
loopback), model ids are bounded and character-checked, and a non-local
endpoint must bring a credential. Localhost may omit one, because a local
inference server usually has no auth to give.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Any, Mapping, cast
from urllib.parse import urlsplit

from config import CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, REPLICATE_API_KEY
from image_generation.catalog import (
    DEFAULT_IMAGE_PROVIDER,
    IMAGE_PROVIDERS,
    ImageProvider,
    default_model_for,
    find_model,
    supports_background_removal,
    supports_editing,
)
from integrations.config import IntegrationConfigError, validate_endpoint_url

MAX_MODEL_ID_LENGTH = 160
MAX_ACCOUNT_ID_LENGTH = 64
MAX_ENDPOINT_LENGTH = 2048

# Replicate ids are ``owner/name`` with an optional ``:version``; Cloudflare's
# are ``@cf/vendor/model``; an OpenAI-compatible server uses a plain name.
_MODEL_ID = re.compile(r"^[A-Za-z0-9@][A-Za-z0-9._:/@+\-]*$")
_CLOUDFLARE_ACCOUNT_ID = re.compile(r"^[a-fA-F0-9]{8,64}$")
_REPLICATE_MODEL_PATH = re.compile(r"^[A-Za-z0-9][\w.\-]*/[A-Za-z0-9][\w.\-]*$")

CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4"


class ImageConfigError(ValueError):
    """A user-supplied image setting that cannot be used as given."""


def _fail(message: str) -> ImageConfigError:
    return ImageConfigError(message)


def _text(value: object, label: str, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise _fail(f"{label} must be a string.")
    cleaned = value.strip()
    if len(cleaned) > limit:
        raise _fail(f"{label} must be {limit} characters or fewer.")
    return cleaned


def _is_loopback_endpoint(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}:
        return True
    return host.endswith(".localhost")


@dataclass(frozen=True)
class ImageGenerationSettings:
    """Everything the image tools need, already validated.

    ``enabled`` folds together the user's toggle and whether the chosen
    provider actually has a usable credential, so the prompt and the tool list
    never advertise a tool the runtime would refuse.
    """

    enabled: bool = True
    provider: ImageProvider = DEFAULT_IMAGE_PROVIDER
    model_id: str = ""
    # Replicate is kept available regardless of the chosen provider, because it
    # is the only background-removal backend and the editing default.
    replicate_api_key: str | None = None
    cloudflare_account_id: str | None = None
    cloudflare_api_token: str | None = None
    openai_image_base_url: str | None = None
    openai_image_api_key: str | None = None
    openai_image_model: str = ""
    # A custom Replicate model the user accepted after schema validation.
    custom_replicate_model: str | None = None

    def __post_init__(self) -> None:
        if not self.model_id:
            object.__setattr__(self, "model_id", default_model_for(self.provider))

    @property
    def has_generation_credential(self) -> bool:
        if self.provider == "replicate":
            return bool(self.replicate_api_key)
        if self.provider == "cloudflare":
            return bool(self.cloudflare_account_id and self.cloudflare_api_token)
        if not self.openai_image_base_url:
            return False
        return bool(self.openai_image_api_key) or _is_loopback_endpoint(
            self.openai_image_base_url
        )

    @property
    def generation_enabled(self) -> bool:
        return self.enabled and self.has_generation_credential

    @property
    def background_removal_enabled(self) -> bool:
        """Background removal is Replicate-only, and stays that way.

        It runs whenever a Replicate credential exists, even if generation is
        pointed at another provider - but no substitute is invented when there
        is no Replicate key.
        """
        return bool(self.replicate_api_key) and supports_background_removal("replicate")

    @property
    def editing_enabled(self) -> bool:
        if self.provider == "openai-compatible" and self.has_generation_credential:
            return supports_editing("openai-compatible")
        return bool(self.replicate_api_key)

    @property
    def cloudflare_endpoint(self) -> str:
        return (
            f"{CLOUDFLARE_API_BASE_URL}/accounts/{self.cloudflare_account_id}"
            f"/ai/run/{self.model_id}"
        )

    def secrets(self) -> tuple[str | None, ...]:
        """Every credential this config holds, for redacting error text."""
        return (
            self.replicate_api_key,
            self.cloudflare_api_token,
            self.openai_image_api_key,
        )

    def describe(self) -> dict[str, Any]:
        """A credential-free description, safe to log or stream to a client."""
        return {
            "enabled": self.generation_enabled,
            "provider": self.provider,
            "model": self.model_id,
            "backgroundRemoval": self.background_removal_enabled,
            "editing": self.editing_enabled,
        }


def _parse_provider(raw: object) -> ImageProvider:
    if raw is None or raw == "":
        return DEFAULT_IMAGE_PROVIDER
    value = _text(raw, "Image provider", 32)
    if value not in IMAGE_PROVIDERS:
        raise _fail(
            f"Unknown image provider {value!r}. Pick one of: "
            + ", ".join(IMAGE_PROVIDERS)
            + "."
        )
    return cast(ImageProvider, value)


def _parse_model_id(raw: object, provider: ImageProvider) -> str:
    value = _text(raw, "Image model", MAX_MODEL_ID_LENGTH)
    if not value:
        return default_model_for(provider)
    if not _MODEL_ID.match(value):
        raise _fail("Image model contains characters that are not allowed.")
    if provider == "cloudflare" and not value.startswith("@cf/"):
        raise _fail("A Workers AI model id looks like @cf/vendor/model.")
    if provider == "replicate" and not _REPLICATE_MODEL_PATH.match(
        value.split(":", 1)[0]
    ):
        raise _fail("A Replicate model id looks like owner/name.")
    return value


def is_built_in_model(provider: ImageProvider, model_id: str) -> bool:
    return find_model(provider, model_id) is not None


def parse_image_settings(
    params: Mapping[str, Any],
    *,
    environment_replicate_key: str | None = None,
) -> ImageGenerationSettings:
    """Read the image block out of a generation request.

    Raises :class:`ImageConfigError` for anything malformed, so a typo in an
    endpoint is reported as a configuration problem before a run starts rather
    than as a mystery failure per prompt.
    """
    raw_block = params.get("imageGeneration")
    block: Mapping[str, Any]
    if raw_block is None:
        block = {}
    elif isinstance(raw_block, Mapping):
        block = cast(Mapping[str, Any], raw_block)
    else:
        raise _fail("imageGeneration must be an object.")

    enabled = bool(params.get("isImageGenerationEnabled", True))
    provider = _parse_provider(block.get("provider"))
    model_id = _parse_model_id(block.get("model"), provider)

    replicate_key = (
        _text(params.get("replicateApiKey"), "Replicate API key", 512)
        or (environment_replicate_key or "").strip()
        or (REPLICATE_API_KEY or "").strip()
    ) or None

    cloudflare_account = _text(
        block.get("cloudflareAccountId"), "Cloudflare account ID", MAX_ACCOUNT_ID_LENGTH
    ) or (CLOUDFLARE_ACCOUNT_ID or "").strip()
    if cloudflare_account and not _CLOUDFLARE_ACCOUNT_ID.match(cloudflare_account):
        raise _fail(
            "A Cloudflare account ID is a 32-character hexadecimal string from "
            "the Workers & Pages overview page."
        )
    cloudflare_token = _text(
        block.get("cloudflareApiToken"), "Cloudflare API token", 512
    ) or (CLOUDFLARE_API_TOKEN or "").strip()

    endpoint = _text(
        block.get("openAiImageBaseUrl"), "Image endpoint URL", MAX_ENDPOINT_LENGTH
    )
    if endpoint:
        try:
            endpoint = validate_endpoint_url(endpoint, "Image endpoint URL")
        except IntegrationConfigError as error:
            raise _fail(str(error)) from error
        endpoint = endpoint.rstrip("/")
    endpoint_key = _text(block.get("openAiImageApiKey"), "Image endpoint key", 512)
    if provider == "openai-compatible":
        if not endpoint:
            raise _fail(
                "An OpenAI-compatible image endpoint needs a base URL, for "
                "example http://localhost:8000/v1."
            )
        if not endpoint_key and not _is_loopback_endpoint(endpoint):
            raise _fail(
                "A remote image endpoint needs its own API key. Only a "
                "localhost endpoint may be used without one."
            )

    settings = ImageGenerationSettings(
        enabled=enabled,
        provider=provider,
        model_id=model_id,
        replicate_api_key=replicate_key,
        cloudflare_account_id=cloudflare_account or None,
        cloudflare_api_token=cloudflare_token or None,
        openai_image_base_url=endpoint or None,
        openai_image_api_key=endpoint_key or None,
        openai_image_model=model_id if provider == "openai-compatible" else "",
        custom_replicate_model=(
            model_id
            if provider == "replicate" and not is_built_in_model(provider, model_id)
            else None
        ),
    )

    if provider == "cloudflare" and enabled:
        missing = [
            name
            for name, value in (
                ("account ID", cloudflare_account),
                ("API token", cloudflare_token),
            )
            if not value
        ]
        if missing and (cloudflare_account or cloudflare_token):
            raise _fail(
                "Cloudflare Workers AI needs both an account ID and an API "
                f"token; the {missing[0]} is missing."
            )

    return settings


def settings_from_environment() -> ImageGenerationSettings:
    """The provider configuration a headless run (evals, CLI) should use."""
    account = (CLOUDFLARE_ACCOUNT_ID or "").strip()
    token = (CLOUDFLARE_API_TOKEN or "").strip()
    replicate_key = (REPLICATE_API_KEY or "").strip()
    provider: ImageProvider = "replicate"
    if not replicate_key and account and token:
        provider = "cloudflare"
    return ImageGenerationSettings(
        enabled=True,
        provider=provider,
        model_id=default_model_for(provider),
        replicate_api_key=replicate_key or None,
        cloudflare_account_id=account or None,
        cloudflare_api_token=token or None,
    )


def with_model(
    settings: ImageGenerationSettings, model_id: str
) -> ImageGenerationSettings:
    return replace(settings, model_id=model_id)


__all__ = [
    "CLOUDFLARE_API_BASE_URL",
    "ImageConfigError",
    "ImageGenerationSettings",
    "is_built_in_model",
    "parse_image_settings",
    "settings_from_environment",
    "with_model",
]
