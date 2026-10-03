"""Generate the shot2code application icon family from one geometric mark."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DESKTOP_BUILD = ROOT / "desktop" / "build"
FAVICON_DIR = ROOT / "frontend" / "public" / "favicon"
CANVAS = 1024
OUTPUT = 512

BACKGROUND = "#0A1020"
INK = "#F8FAFC"
CYAN = "#2DD4F7"
CORAL = "#FF6B57"
AMBER = "#FFC928"


def rounded_line(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    *,
    fill: str,
    width: int,
) -> None:
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width // 2
    for x, y in points:
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=fill,
        )


def build_icon(*, active: bool = False) -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (16, 16, CANVAS - 16, CANVAS - 16),
        radius=238,
        fill=BACKGROUND,
    )

    # One capture corner enters as cyan; the opposite corner exits as coral.
    rounded_line(
        draw,
        [(174, 308), (174, 174), (308, 174)],
        fill=CYAN,
        width=34,
    )
    rounded_line(
        draw,
        [(716, 850), (850, 850), (850, 716)],
        fill=CORAL,
        width=34,
    )

    # The central path is an ownable "2": captured input turns into output.
    path = [(246, 292), (546, 292), (684, 430), (398, 650), (724, 650)]
    rounded_line(draw, path, fill=INK, width=92)
    draw.ellipse((208, 254, 284, 330), fill=CYAN)
    draw.ellipse((686, 612, 762, 688), fill=CORAL)

    # A small pixel trail suggests visual input without reusing a camera glyph.
    for x, y, size in [(130, 452, 34), (166, 498, 26), (202, 536, 18)]:
        draw.rounded_rectangle((x, y, x + size, y + size), radius=6, fill=CYAN)

    if active:
        draw.ellipse((754, 754, 906, 906), fill=BACKGROUND)
        draw.ellipse((772, 772, 888, 888), fill=AMBER)
        draw.ellipse((808, 808, 852, 852), fill=BACKGROUND)

    return image.resize((OUTPUT, OUTPUT), Image.Resampling.LANCZOS)


def main() -> None:
    DESKTOP_BUILD.mkdir(parents=True, exist_ok=True)
    FAVICON_DIR.mkdir(parents=True, exist_ok=True)

    default = build_icon()
    active = build_icon(active=True)

    default.save(DESKTOP_BUILD / "icon.png", optimize=True)
    default.save(FAVICON_DIR / "main.png", optimize=True)
    active.save(FAVICON_DIR / "coding.png", optimize=True)
    default.save(
        DESKTOP_BUILD / "icon.ico",
        format="ICO",
        sizes=[
            (16, 16),
            (20, 20),
            (24, 24),
            (32, 32),
            (40, 40),
            (48, 48),
            (64, 64),
            (96, 96),
            (128, 128),
            (256, 256),
        ],
    )


if __name__ == "__main__":
    main()
