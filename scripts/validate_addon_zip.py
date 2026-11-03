"""Check that an upload ZIP installs one complete Forever addon and no app."""
import re
import sys
from pathlib import PurePosixPath
from zipfile import ZipFile


def validate(filename):
    with ZipFile(filename) as archive:
        files = {}
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                raise ValueError("Unsafe archive path")
            if entry.is_dir():
                continue
            if path.parts[0] != "AzerothLiveMap" or len(path.parts) != 2:
                raise ValueError("Only files directly inside AzerothLiveMap/ may ship")
            if path.suffix.lower() not in {".toc", ".lua", ".tga", ".md", ".txt"}:
                raise ValueError(f"Not an addon asset: {entry.filename}")
            if path.name in files:
                raise ValueError(f"Duplicate archive entry: {path.name}")
            files[path.name] = archive.read(entry)
        toc = files["AzerothLiveMap.toc"].decode("utf-8-sig")
        interface = re.search(r"^## Interface:\s*(\d+)\s*$", toc, re.M)
        if not interface or not 16000 <= int(interface[1]) < 17000:
            raise ValueError("TOC must target the Forever interface family")
        if "## SavedVariables: AzerothLiveMapDB" not in toc:
            raise ValueError("SavedVariables migration key is missing")
        declared = [line.strip() for line in toc.splitlines()
                    if line.strip() and not line.lstrip().startswith("#")]
        for name in [*declared, "Elephant.tga", "README.md"]:
            if name not in files:
                raise ValueError(f"Missing required addon file: {name}")
        if not declared or declared[0] != "Compat.lua":
            raise ValueError("Compatibility helpers must load first")
        print(f"Validated {filename}: {len(files)} addon files, interface {interface[1]}")


if __name__ == "__main__":
    for filename in sys.argv[1:]:
        validate(filename)
