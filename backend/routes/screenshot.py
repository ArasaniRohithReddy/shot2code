import base64
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from urllib.parse import urlparse

router = APIRouter()


class ScreenshotCaptureError(RuntimeError):
    """An actionable, credential-safe ScreenshotOne failure."""


def normalize_url(url: str) -> str:
    """
    Normalize URL to ensure it has a proper protocol.
    If no protocol is specified, default to https://
    """
    url = url.strip()
    
    # Parse the URL
    parsed = urlparse(url)
    
    # Check if we have a scheme
    if not parsed.scheme:
        # No scheme, add https://
        url = f"https://{url}"
    elif parsed.scheme in ['http', 'https']:
        # Valid scheme, keep as is
        pass
    else:
        # Check if this might be a domain with port (like example.com:8080)
        # urlparse treats this as scheme:netloc, but we want to handle it as domain:port
        if ':' in url and not url.startswith(('http://', 'https://', 'ftp://', 'file://')):
            # Likely a domain:port without protocol
            url = f"https://{url}"
        else:
            # Invalid protocol
            raise ValueError(f"Unsupported protocol: {parsed.scheme}")
    
    return url


def bytes_to_data_url(image_bytes: bytes, mime_type: str) -> str:
    base64_image = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{base64_image}"


async def capture_screenshot(
    target_url: str, api_key: str, device: str = "desktop"
) -> bytes:
    api_base_url = "https://api.screenshotone.com/take"

    params = {
        "access_key": api_key,
        "url": target_url,
        "full_page": "true",
        "device_scale_factor": "1",
        "format": "png",
        "block_ads": "true",
        "block_cookie_banners": "true",
        "block_trackers": "true",
        "cache": "false",
        "viewport_width": "342",
        "viewport_height": "684",
    }

    if device == "desktop":
        params["viewport_width"] = "1280"
        params["viewport_height"] = "832"

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            response = await client.get(api_base_url, params=params)
        except httpx.TimeoutException as exc:
            raise ScreenshotCaptureError(
                "ScreenshotOne timed out while loading this page. Check that the "
                "URL is public and try again."
            ) from exc
        except httpx.HTTPError as exc:
            raise ScreenshotCaptureError(
                "Could not reach ScreenshotOne. Check your network connection and "
                "try again."
            ) from exc

        if response.status_code == 200 and response.content:
            return response.content

        if response.status_code in {401, 403}:
            message = (
                "ScreenshotOne rejected the API key or this request. Verify the key "
                "and the account's access."
            )
        elif response.status_code == 402:
            message = (
                "ScreenshotOne requires billing or available credits for this request."
            )
        elif response.status_code == 429:
            message = (
                "ScreenshotOne rate-limited this request. Wait briefly and try again."
            )
        elif 400 <= response.status_code < 500:
            message = (
                f"ScreenshotOne could not capture this URL "
                f"(HTTP {response.status_code}). Verify that it is public and valid."
            )
        else:
            message = (
                f"ScreenshotOne is unavailable right now "
                f"(HTTP {response.status_code}). Try again shortly."
            )
        raise ScreenshotCaptureError(message)


class ScreenshotRequest(BaseModel):
    url: str
    apiKey: str


class ScreenshotResponse(BaseModel):
    url: str


class ScreenshotKeyRequest(BaseModel):
    apiKey: str


@router.post("/api/screenshot/test")
async def test_screenshot_key(request: ScreenshotKeyRequest) -> dict[str, str | bool]:
    api_key = request.apiKey.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Add a ScreenshotOne API key.")
    params = {
        "access_key": api_key,
        "url": "https://example.com",
        "response_type": "empty",
        "viewport_width": "320",
        "viewport_height": "240",
        "cache": "false",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://api.screenshotone.com/take",
                params=params,
            )
        if response.status_code == 200:
            return {
                "ok": True,
                "message": "ScreenshotOne accepted the key.",
            }
        if response.status_code in {401, 403}:
            detail = "ScreenshotOne rejected the key or this account's access."
        elif response.status_code == 402:
            detail = "ScreenshotOne needs billing or available credits."
        elif response.status_code == 429:
            detail = "ScreenshotOne rate-limited the test. Try again later."
        else:
            detail = f"ScreenshotOne returned HTTP {response.status_code}."
        raise HTTPException(status_code=502, detail=detail)
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail="ScreenshotOne did not answer before the test timed out.",
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="Could not reach ScreenshotOne.",
        ) from error


@router.post("/api/screenshot")
async def app_screenshot(request: ScreenshotRequest):
    # Extract the URL from the request body
    url = request.url
    api_key = request.apiKey

    try:
        # Normalize the URL
        normalized_url = normalize_url(url)
        
        # Capture screenshot with normalized URL
        image_bytes = await capture_screenshot(normalized_url, api_key=api_key)

        # Convert the image bytes to a data url
        data_url = bytes_to_data_url(image_bytes, "image/png")

        return ScreenshotResponse(url=data_url)
    except ValueError as e:
        # Handle URL normalization errors
        raise HTTPException(status_code=500, detail=str(e))
    except ScreenshotCaptureError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
