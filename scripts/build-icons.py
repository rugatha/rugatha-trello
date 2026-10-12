"""Build transparent favicons and full-bleed PWA icons from the original PNG.

Requires Pillow. Only the connected dark exterior and its antialiased edge
are changed; the emblem interior keeps its original RGB values.
Usage: python3 scripts/build-icons.py
"""
from collections import deque
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
source = Image.open(ROOT / "assets/rugatha-trello-icon.png").convert("RGB")
width, height = source.size
pixels = source.load()
background = Image.new("L", source.size, 0)
mask = background.load()
queue = deque()


def enqueue(x, y):
    if mask[x, y] == 0 and max(pixels[x, y]) <= 12:
        mask[x, y] = 255
        queue.append((x, y))


for x in range(width):
    enqueue(x, 0)
    enqueue(x, height - 1)
for y in range(height):
    enqueue(0, y)
    enqueue(width - 1, y)
while queue:
    x, y = queue.popleft()
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < width and 0 <= ny < height:
            enqueue(nx, ny)

# The outer rim is gold on a black matte. Recover edge coverage from the
# nearby rim brightness and unpremultiply black-matted RGB at that edge.
# Do not touch dark ornamentation enclosed by the gold rim.
red, green, blue = source.split()
brightness = ImageChops.lighter(ImageChops.lighter(red, green), blue)
nearby = brightness.filter(ImageFilter.MaxFilter(7)).load()
edge = background.filter(ImageFilter.MaxFilter(7)).load()
result = source.convert("RGBA")
output = result.load()
changed = transparent = 0
for y in range(height):
    for x in range(width):
        if mask[x, y]:
            output[x, y] = (0, 0, 0, 0)
            transparent += 1
        elif edge[x, y]:
            rgb = pixels[x, y]
            alpha = max(1, min(255, round(255 * max(rgb) / max(1, nearby[x, y]))))
            output[x, y] = tuple(min(255, round(c * 255 / alpha)) for c in rgb) + (alpha,)
            changed += 1
        else:
            assert output[x, y] == pixels[x, y] + (255,)
assert transparent > width * height * 0.15
assert result.getpixel((width // 2, height // 2)) == pixels[width // 2, height // 2] + (255,)

result.save(ROOT / "assets/rugatha-trello-icon-transparent.png", optimize=True)
icons = ROOT / "assets/icons"
icons.mkdir(exist_ok=True)
for name, size in (("favicon-32-transparent.png", 32),):
    icon = result.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(icons / name, optimize=True)
    assert icon.mode == "RGBA" and icon.getpixel((0, 0))[3] == 0
    print(f"{name}: {size} x {size}, RGBA, {(icons / name).stat().st_size:,} bytes")

# Installed app icons fill the entire platform mask. Preserve the original
# full-width circular artwork; extend its forest-green background to all
# corners instead of making the browser supply a white padded backing.
full_bleed = Image.new("RGBA", result.size, (45, 79, 70, 255))
full_bleed.alpha_composite(result)
full_bleed = full_bleed.convert("RGB")
for name, size in (("apple-touch-icon-full.png", 180),
                   ("icon-192-full.png", 192),
                   ("icon-512-full.png", 512)):
    icon = full_bleed.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(icons / name, optimize=True)
    assert icon.mode == "RGB" and icon.size == (size, size)
    assert all(icon.getpixel(position) == (45, 79, 70) for position in
               ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)))
    print(f"{name}: {size} x {size}, opaque full-bleed PNG, {(icons / name).stat().st_size:,} bytes")
print(f"Exterior transparent pixels: {transparent:,}; antialiased edge pixels: {changed:,}")
