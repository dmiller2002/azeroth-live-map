#!/usr/bin/env python3
"""Build a portable Windows addon and companion bundle with setup instructions."""
from pathlib import Path
from subprocess import run
from shutil import copyfile
import sys
from zipfile import ZipFile, ZIP_DEFLATED


ROOT = Path(__file__).resolve().parent.parent


def main():
    # Keep the companion's existing addon download in sync with this checkout.
    run([sys.executable, str(ROOT / 'scripts/package_addon.py')], check=True)
    files = {}
    for path in sorted((ROOT / 'addon/AzerothLiveMap').rglob('*')):
        if path.is_file():
            files[path.relative_to(ROOT / 'addon').as_posix()] = path
    for path in sorted((ROOT / 'dist').rglob('*')):
        # Never embed older Windows bundles (or a previous copy of this ZIP).
        if path.is_file() and (path.suffix.lower() != '.zip' or path.name == 'AzerothLiveMap.zip'):
            files['Companion/' + path.relative_to(ROOT).as_posix()] = path
    files['Companion/scripts/serve.py'] = ROOT / 'scripts/serve.py'
    for name in ('README.txt', 'START-MAP.cmd'):
        files[name] = ROOT / 'packaging/windows' / name
    for path in files.values():
        if path.is_symlink():
            raise RuntimeError('Refusing to package a symlink: ' + str(path))
    target = ROOT / 'dist/AzerothLiveMap-Windows.zip'
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for name, path in files.items():
            if name in ('README.txt', 'START-MAP.cmd'):
                # Native Windows line endings, including for Command Prompt.
                archive.writestr(name, path.read_text(encoding='utf-8').replace('\n', '\r\n').encode('utf-8'))
            else:
                archive.write(path, name)
    print(target)
    named_target = ROOT / 'dist/Drunks_Azeroth_live_Atlas.zip'
    copyfile(target, named_target)
    print(named_target)


if __name__ == '__main__':
    main()
