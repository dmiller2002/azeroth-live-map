"""Package the distributable source; omit dependencies, caches and old builds."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from package_addon import package

ROOT = Path(__file__).resolve().parents[1]
package()
version = json.loads((ROOT / "package.json").read_text())["version"]
output = ROOT / "release" / version / f"Drunks-Azeroth-Companion-Forever-{version}-source.zip"
output.parent.mkdir(parents=True, exist_ok=True)
directories = ["addon", "app", "assets", "desktop", "docs", "packaging", "scripts", "tests", ".github"]
files = ["README.md", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md", ".pkgmeta", "package.json", "package-lock.json", ".gitignore", "start-companion.sh", "START-COMPANION.cmd"]
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(ROOT / name, f"drunks-azeroth-ui-companion/{name}")
    for name in directories:
        for file in sorted((ROOT / name).rglob("*")):
            if file.is_file() and "__pycache__" not in file.parts:
                archive.write(file, "drunks-azeroth-ui-companion/" + str(file.relative_to(ROOT)))
print(f"Built {output.relative_to(ROOT)}")
