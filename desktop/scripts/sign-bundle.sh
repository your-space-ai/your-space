#!/bin/bash
# Sign nested code inside-out. '-' creates an ad-hoc signature for internal candidates.
set -euo pipefail
[[ $# == 2 && -d "$1/Contents/Frameworks" ]] || { echo 'Usage: sign-bundle.sh APP IDENTITY' >&2; exit 2; }
app=$1
identity=$2
options=(--force --sign "$identity")
# Ad-hoc code has no Apple Team ID. Hardened library validation can only match
# the Electron Framework to the host after both carry the public Developer ID.
if [[ $identity == - ]]; then options+=(--options 0 --timestamp=none); else options+=(--options runtime --timestamp); fi
entitlements=$(cd "$(dirname "$0")" && pwd)/jit.entitlements
frameworks="$app/Contents/Frameworks"
electron_framework="$frameworks/Electron Framework.framework/Versions/A"
sign() { codesign "${options[@]}" "$@"; }

for item in "$electron_framework"/Libraries/*.dylib "$electron_framework"/Helpers/* \
  "$frameworks/Squirrel.framework/Versions/A/Resources/ShipIt"; do
  sign "$item"
done
for item in "$frameworks"/*.framework; do sign "$item"; done
for helper in "$frameworks"/*.app; do
  sign --entitlements "$entitlements" "$helper"
done
sign --entitlements "$entitlements" "$app/Contents/Resources/bin/your-space"
sign --entitlements "$entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
