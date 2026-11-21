#!/bin/bash
# Build the Finder installation volume from an already signed app. The release
# runner signs the image after this step; private QA can use the same layout.
set -euo pipefail
[[ $# == 2 && -d "$1/Contents" && $2 == *.dmg ]] || {
  echo 'Usage: create-dmg.sh APP OUTPUT.dmg' >&2
  exit 2
}
app=$(cd "$1" && pwd)
[[ $(basename "$app") == 'Your Space.app' ]] || exit 2
codesign --verify --deep --strict "$app"
mkdir -p "$(dirname "$2")"
out=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/volume"
# Preserve bundle metadata, including the stapled ticket on public release builds.
ditto --rsrc --extattr --noqtn "$app" "$work/volume/Your Space.app"
ln -s /Applications "$work/volume/Applications"
hdiutil create -quiet -fs HFS+ -format UDZO -volname 'Your Space' \
  -srcfolder "$work/volume" "$work/distribution.dmg"
mv "$work/distribution.dmg" "$out"
