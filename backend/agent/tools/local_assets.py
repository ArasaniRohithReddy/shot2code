"""Backwards-compatible alias for :mod:`asset_urls`.

The helpers moved to the top level so the image subsystem and the uploaded
asset store can use them without importing the agent package - importing
``agent.tools`` from ``image_generation`` created a cycle. Existing imports of
``agent.tools.local_assets`` keep working through this module.

``LOCAL_ASSET_DIR`` is intentionally *not* re-exported: the functions read it
from :mod:`asset_urls`, so anything overriding it must override it there.
"""

from asset_urls import (
    LOCAL_ASSET_HOSTS,
    guess_image_mime,
    is_local_host_url,
    local_asset_url_to_bytes,
    local_asset_url_to_data_url,
)

__all__ = [
    "LOCAL_ASSET_HOSTS",
    "guess_image_mime",
    "is_local_host_url",
    "local_asset_url_to_bytes",
    "local_asset_url_to_data_url",
]
