#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from shutil import copyfile

root = Path(__file__).resolve().parent.parent
target = root / 'dist' / 'DrunksAzerothUI.zip'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for path in sorted((root / 'addon' / 'AzerothLiveMap').glob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(root / 'addon'))
print(target)
# Keep existing download links working; the addon identity preserves saved data.
copyfile(target, root / 'dist' / 'AzerothLiveMap.zip')
