#!/usr/bin/env python3
"""Install the standalone local map and its desktop menu entry for this user."""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

APP = 'azeroth-live-map'
SOURCE = Path(__file__).resolve().parent.parent


def atomic(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data); output.flush(); os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def exec_quote(value):
    # Desktop Exec has its own quoting rules; it is never executed through a shell.
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%') + '"'


def no_symlinks(path):
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise RuntimeError('Refusing to install through a symlink: ' + str(parent))


def desktop_text(data_dir):
    return ('[Desktop Entry]\nType=Application\nName=Azeroth Live Map\n'
            'Comment=Your WoW Anniversary map on a second monitor\n'
            f'Exec={exec_quote(sys.executable)} {exec_quote(data_dir / "scripts/companion.py")} --notify\n'
            f'Icon={data_dir / "dist/icon.svg"}\nTerminal=false\nCategories=Game;\n'
            'Keywords=WoW;Warcraft;Anniversary;Map;\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--data-dir', type=Path, default=Path.home() / '.local/share' / APP)
    parser.add_argument('--applications-dir', type=Path, default=Path.home() / '.local/share/applications')
    args = parser.parse_args()
    data_dir = args.data_dir.expanduser().absolute()
    applications = args.applications_dir.expanduser().absolute()
    for path in (data_dir, applications):
        no_symlinks(path)
        if any(c in str(path) for c in '\n\r\0'):
            raise RuntimeError('Installation paths cannot contain line breaks or NUL.')
    if not (SOURCE / 'dist/index.html').is_file():
        raise RuntimeError('Missing dist/index.html; run this installer from a complete project copy.')
    changes = []
    for source in sorted((SOURCE / 'dist').rglob('*')):
        if source.relative_to(SOURCE / 'dist').parts[0] in ('server', '.openai'):
            continue
        if source.is_symlink():
            raise RuntimeError('Refusing to package a symlink: ' + str(source))
        if source.is_file():
            changes.append((data_dir / source.relative_to(SOURCE), source.read_bytes()))
    for name in ('companion.py', 'install_companion.py', 'model_assets.py', 'build_item_models.py'):
        changes.append((data_dir / 'scripts' / name, (SOURCE / 'scripts' / name).read_bytes()))
    changes.append((data_dir / 'THIRD_PARTY_NOTICES.md', (SOURCE / 'THIRD_PARTY_NOTICES.md').read_bytes()))
    desktop = applications / (APP + '.desktop')
    text = desktop_text(data_dir)
    changes.append((desktop, text.encode()))
    for path, _ in changes:
        no_symlinks(path)
        if path.exists() and not path.is_file():
            raise RuntimeError('An installation file is occupied by a directory: ' + str(path))
    changes = [(path, content) for path, content in changes if not path.is_file() or path.read_bytes() != content]
    if args.dry_run:
        for path, _ in changes:
            print(('Back up and replace: ' if path.exists() else 'Create: ') + str(path))
        print('No files changed. The addon and game configuration are not part of this installer.')
        return
    validator = shutil.which('desktop-file-validate')
    if not validator:
        raise RuntimeError('desktop-file-validate is required (provided by desktop-file-utils).')
    with tempfile.TemporaryDirectory(prefix=APP + '-desktop-') as temporary:
        check = Path(temporary) / (APP + '.desktop')
        check.write_text(text)
        subprocess.run([validator, str(check)], check=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup_dir = data_dir.parent / (APP + '-backups') / stamp
    no_symlinks(backup_dir)
    previous = {}
    completed = []
    try:
        for path, content in changes:
            old = (path.read_bytes(), path.stat().st_mode & 0o777) if path.exists() else None
            previous[path] = old
            if old:
                relative = Path('applications') / path.name if path == desktop else path.relative_to(data_dir)
                atomic(backup_dir / relative, old[0], old[1])
            atomic(path, content)
            completed.append(path)
        subprocess.run([validator, str(desktop)], check=True)
    except Exception:
        for path in reversed(completed):
            old = previous[path]
            if old is None:
                path.unlink()
            else:
                atomic(path, *old)
        raise
    updater = shutil.which('update-desktop-database')
    if updater:
        subprocess.run([updater, str(applications)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('Installed Azeroth Live Map. Open it from the application menu.')
    print('App files: ' + str(data_dir))
    if backup_dir.exists():
        print('Replaced files were backed up to: ' + str(backup_dir))
    print('Choose Connect WoW and approve screen sharing. The local server starts on demand.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print('Installation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
