import base64


def extract_tag_content(tag: str, text: str) -> str:
    """
    Extracts content for a given tag from the provided text.

    :param tag: The tag to search for.
    :param text: The text to search within.
    :return: The content found within the tag, if any.
    """
    tag_start = f"<{tag}>"
    tag_end = f"</{tag}>"
    start_idx = text.find(tag_start)
    end_idx = text.find(tag_end, start_idx)
    if start_idx != -1 and end_idx != -1:
        return text[start_idx : end_idx + len(tag_end)]
    return ""


def get_video_bytes_and_mime_type(video_data_url: str) -> tuple[bytes, str]:
    video_encoded_data = video_data_url.split(",")[1]
    video_bytes = base64.b64decode(video_encoded_data)
    mime_type = video_data_url.split(";")[0].split(":")[1]
    return video_bytes, mime_type


# Copilot caps images per request (gemini-3.6-flash allows 10) and the SDK adds
# a few of its own on top of ours, so sample conservatively. Five frames still
# captures the start, end and the transitions in between for a short recording.
DEFAULT_FRAME_COUNT = 5


def extract_evenly_spaced_frames(
    video_bytes: bytes,
    frame_count: int = DEFAULT_FRAME_COUNT,
) -> list[bytes]:
    """Sample ``frame_count`` PNG frames spread across the video.

    Gemini accepts video natively, but providers that only take images - the
    GitHub Copilot SDK, for one - need the video flattened into stills first.
    Sampling evenly keeps the start and end states, which is what matters when
    reproducing a screen recording.

    Returns PNG-encoded frames, or an empty list if the video can't be decoded.
    """
    import io
    import os
    import tempfile
    from typing import Any, cast

    import imageio
    from PIL import Image

    path = None
    try:
        # imageio's ffmpeg reader wants a real file, not a stream.
        fd, path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(fd, "wb") as handle:
            handle.write(video_bytes)

        # imageio's stubs don't describe the ffmpeg reader accurately; it is
        # iterable at runtime and yields numpy frames.
        reader = cast(Any, imageio).get_reader(path, "ffmpeg")
        try:
            frames: list[Any] = [frame for frame in reader]
        finally:
            reader.close()

        if not frames:
            return []

        if len(frames) <= frame_count:
            chosen = frames
        else:
            step = (len(frames) - 1) / (frame_count - 1)
            chosen = [frames[round(i * step)] for i in range(frame_count)]

        encoded: list[bytes] = []
        for frame in chosen:
            buffer = io.BytesIO()
            Image.fromarray(frame).save(buffer, format="PNG")
            encoded.append(buffer.getvalue())
        return encoded
    except Exception as exc:
        print(f"[video] frame extraction failed: {type(exc).__name__}: {exc}")
        return []
    finally:
        if path and os.path.exists(path):
            try:
                os.unlink(path)
            except OSError:
                pass
