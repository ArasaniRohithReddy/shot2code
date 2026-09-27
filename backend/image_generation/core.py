"""The image subsystem's public surface.

``generate_images`` is the honest entry point: it returns one
:class:`ImageResult` per prompt, each either an image or a classified failure.
``process_tasks`` is the old URL-only shim, kept so existing callers keep
working while nothing new relies on it.
"""

from image_generation.assets import (
    NormalizedImage,
    normalize_image_result,
    persist_image_bytes,
)
from image_generation.catalog import (
    BUILT_IN_IMAGE_MODELS,
    IMAGE_PROVIDERS,
    ImageModelInfo,
    ImageProvider,
    default_model_for,
    find_model,
    models_for_provider,
    supports_background_removal,
    supports_editing,
)
from image_generation.errors import (
    ImageProviderFailure,
    failure_from_exception,
    failure_from_status,
    image_failure,
)
from image_generation.generation import (
    BatchImageResult,
    ImageResult,
    generate_image_replicate,
    generate_images,
    generate_one,
    process_tasks,
)
from image_generation.settings import (
    ImageConfigError,
    ImageGenerationSettings,
    parse_image_settings,
    settings_from_environment,
)


__all__ = [
    "BUILT_IN_IMAGE_MODELS",
    "BatchImageResult",
    "IMAGE_PROVIDERS",
    "ImageConfigError",
    "ImageGenerationSettings",
    "ImageModelInfo",
    "ImageProvider",
    "ImageProviderFailure",
    "ImageResult",
    "NormalizedImage",
    "default_model_for",
    "failure_from_exception",
    "failure_from_status",
    "find_model",
    "generate_image_replicate",
    "generate_images",
    "generate_one",
    "image_failure",
    "models_for_provider",
    "normalize_image_result",
    "parse_image_settings",
    "persist_image_bytes",
    "process_tasks",
    "settings_from_environment",
    "supports_background_removal",
    "supports_editing",
]
