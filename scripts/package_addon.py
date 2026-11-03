"""Build the addon ZIP from the current TOC, without including local game data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
ADDON = ROOT / "addon" / "AzerothLiveMap"
OUTPUT = ROOT / "app" / "DrunksAzerothUI.zip"


def package():
    toc = ADDON / "AzerothLiveMap.toc"
    declared = [line.strip() for line in toc.read_text().splitlines()
                if line.strip() and not line.lstrip().startswith("#")]
    files = [toc, *(ADDON / name for name in declared)]
    # The sprite's Lua module references this texture outside the TOC file list.
    files.extend([ADDON / "Elephant.tga", ADDON / "README.md"])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".zip.tmp")
    with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.relative_to(ADDON.parent))
    temporary.replace(OUTPUT)
    print(f"Built {OUTPUT.relative_to(ROOT)} ({len(files)} files)")


if __name__ == "__main__":
    package()
