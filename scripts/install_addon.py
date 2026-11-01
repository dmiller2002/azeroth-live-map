#!/usr/bin/env python3
"""Install only this project's addon, preserving an existing copy as a backup."""

import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil
import sys
import tempfile


ADDON_NAME = "AzerothLiveMap"
SOURCE = Path(__file__).resolve().parent.parent / "addon" / ADDON_NAME


def install(addons_dir: Path, dry_run: bool = False) -> None:
    addons_dir = addons_dir.expanduser().resolve(strict=True)
    if not addons_dir.is_dir():
        raise ValueError(f"AddOns path is not a directory: {addons_dir}")
    required = ("AzerothLiveMap.toc", "Protocol.lua", "Questie.lua", "Main.lua")
    for name in required:
        if not (SOURCE / name).is_file():
            raise ValueError(f"Missing addon source file: {SOURCE / name}")
    if SOURCE.is_symlink() or any(path.is_symlink() for path in SOURCE.rglob("*")):
        raise ValueError("Addon source must not contain symbolic links.")

    target = addons_dir / ADDON_NAME
    if target.is_symlink():
        raise ValueError(f"Refusing to replace an addon symbolic link: {target}")
    if target.exists() and not target.is_dir():
        raise ValueError(f"Addon destination exists but is not a directory: {target}")
    source = SOURCE.resolve()
    if target == source or source in target.parents or target in source.parents:
        raise ValueError("The installation destination overlaps the project source.")

    backup_root = addons_dir / ".AzerothLiveMap-backups"
    backup = None
    if target.exists():
        if backup_root.is_symlink() or (backup_root.exists() and not backup_root.is_dir()):
            raise ValueError(f"Backup location is not an ordinary directory: {backup_root}")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        backup = backup_root / stamp / ADDON_NAME

    print(f"Source: {SOURCE}")
    print(f"Install: {target}")
    if backup is not None:
        print(f"Preserve existing addon at: {backup}")
    if dry_run:
        print("Dry run: no files changed.")
        return

    # Prepare a complete copy on the same filesystem before replacing anything.
    with tempfile.TemporaryDirectory(prefix=".AzerothLiveMap-install-", dir=addons_dir) as staging:
        staged = Path(staging) / ADDON_NAME
        shutil.copytree(SOURCE, staged)
        if backup is not None:
            backup.parent.mkdir(parents=True, exist_ok=False)
            target.rename(backup)
        try:
            staged.rename(target)
        except OSError:
            if backup is not None and backup.exists() and not target.exists():
                backup.rename(target)
            raise

    if backup is not None:
        print("Updated AzerothLiveMap. Type /reload in WoW to load the update.")
    else:
        print("Installed AzerothLiveMap. Restart WoW, then enable it in the AddOns list.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--addons-dir", type=Path, required=True,
        help="Existing Interface/AddOns directory for the WoW client you play.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show the planned copy and backup without writing files.")
    args = parser.parse_args()
    try:
        install(args.addons_dir, args.dry_run)
    except (OSError, ValueError) as error:
        print(f"Installation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
