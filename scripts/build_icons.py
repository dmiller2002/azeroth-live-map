#!/usr/bin/env python3
"""Export app icon sizes from the first frame of the existing HUZZAH artwork."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
source = Image.open(root / 'assets/huzzah-idle-source.png').convert('RGBA')
frame = source.crop((0, 0, source.width // 4, source.height // 2))
icons = root / 'app/icons'
icons.mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    frame.resize((size, size), Image.Resampling.LANCZOS).save(icons / f'huzzah-icon-{size}.png')
frame.resize((256, 256), Image.Resampling.LANCZOS).save(
    icons / 'huzzah.ico', sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)]
)
print('Exported HUZZAH PNG and Windows ICO app icons.')
