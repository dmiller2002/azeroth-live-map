#!/usr/bin/env bash
set -euo pipefail
companion_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$companion_root/release/1.0.3/linux-unpacked/drunks-azeroth-companion" ]]; then
  exec "$companion_root/release/1.0.3/linux-unpacked/drunks-azeroth-companion" "$@"
elif [[ -x "$companion_root/node_modules/electron/dist/electron" ]]; then
  exec "$companion_root/node_modules/electron/dist/electron" "$companion_root" "$@"
else
  echo 'Install Node.js, then run npm ci in the companion folder before launching.' >&2
  exit 1
fi
