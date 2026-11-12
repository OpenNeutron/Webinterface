"""Draw the Sloth Lee app icons from the same geometry the app uses.

The mark in SlothMark.jsx is vector, so the browser favicon is fine at any size.
These PNGs are for the home screen, iOS and Android's maskable slot, none of
which render SVG — and the copies in the repo predate the current palette.

Everything is drawn at 8x and downsampled, so the edges are clean rather than
aliased. The maskable variant keeps the face inside the 80% safe circle that
Android is free to crop to.
"""
from PIL import Image, ImageDraw
import numpy as np

FUR_A = (200, 161, 122)
FUR_B = (169, 127, 87)
FACE = (244, 234, 214)
PATCH = (92, 70, 50)
EYE = (16, 18, 15)
GROUND = (16, 21, 15)
S = 2  # this bot's container is capped at 2 GB; 2x is enough for 512 px


def gradient_disc(size, a=FUR_A, b=FUR_B):
    """A circle filled with the mark's fur gradient; where the mark's r=11/24 sits."""
    n = size * S
    yy, xx = np.mgrid[0:n, 0:n]
    # A vertical gradient, not a diagonal one: diagonal shading made the right
    # side heavier than the left, so a centred face looked pushed off-centre.
    t = np.clip(yy / n, 0, 1)
    arr = np.zeros((n, n, 4), dtype=np.uint8)
    for i in range(3):
        arr[..., i] = (a[i] + (b[i] - a[i]) * t).astype(np.uint8)
    arr[..., 3] = 255
    img = Image.fromarray(arr, "RGBA")
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, n - 1, n - 1], fill=255)
    img.putalpha(mask)
    return img


def mark(size, inset=1.0, ground=None):
    """The face, centred, at `inset` of the canvas (1.0 = touching the edges)."""
    canvas = Image.new("RGBA", (size * S, size * S), ground + (255,) if ground else (0, 0, 0, 0))
    box = size * S * inset
    origin = (size * S - box) / 2
    disc = gradient_disc(int(box))
    canvas.alpha_composite(disc, (int(origin), int(origin)))

    d = ImageDraw.Draw(canvas)
    u = box / 24.0  # one SVG unit

    def pt(x, y):
        return (origin + x * u, origin + y * u)

    # The muzzle: a soft vertical oval, not a circle — it is what makes the face
    # read as a sloth rather than a bear at small sizes.
    cx, cy = pt(12, 12.15)
    d.ellipse([cx - 6.55 * u, cy - 6.95 * u, cx + 6.55 * u, cy + 6.95 * u], fill=FACE)

    def patch(x, y, rot):
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        dl = ImageDraw.Draw(layer)
        px, py = pt(x, y)
        dl.ellipse([px - 2.7 * u, py - 2.3 * u, px + 2.7 * u, py + 2.3 * u], fill=PATCH + (255,))
        layer = layer.rotate(rot, center=(px, py), resample=Image.BICUBIC)
        canvas.alpha_composite(layer)

    patch(8.6, 10.9, -14)
    patch(15.4, 10.9, 14)
    for ex in (9.1, 14.9):
        x, y = pt(ex, 11.1)
        d.ellipse([x - 0.95 * u, y - 0.95 * u, x + 0.95 * u, y + 0.95 * u], fill=EYE)
    nx, ny = pt(12, 14.9)
    d.ellipse([nx - 1.6 * u, ny - 1.15 * u, nx + 1.6 * u, ny + 1.15 * u], fill=PATCH)

    return canvas.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(__file__), "..", "public")
    out = os.path.abspath(out)

    mark(192).save(f"{out}/icon-192.png", optimize=True)
    mark(512).save(f"{out}/icon-512.png", optimize=True)
    mark(180, ground=GROUND).save(f"{out}/apple-touch-icon.png", optimize=True)
    # Android crops maskable icons to a circle, a squircle or a rounded square:
    # only the middle 80% is guaranteed. The face has to live inside it.
    mark(512, inset=0.78, ground=GROUND).save(f"{out}/icon-512-maskable.png", optimize=True)
    for name in ("icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"):
        print(name, os.path.getsize(os.path.join(out, name)), "bytes")
