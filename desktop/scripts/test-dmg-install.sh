#!/bin/bash
# Exercise the Finder installation contract on an isolated Applications directory.
set -euo pipefail
if [[ $(uname -s) != Darwin || $# != 2 || ! -f $1 ]]; then
  echo 'Usage on macOS: test-dmg-install.sh IMAGE.dmg arm64|x64' >&2
  exit 2
fi
case $2 in
  arm64) cpu=arm64 ;;
  x64) cpu=x86_64 ;;
  *) echo 'Choose arm64 or x64.' >&2; exit 2 ;;
esac

image=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
mount="$work/mounted"
destination="$work/Applications"
app="$destination/Your Space.app"
mounted=false
cleanup() {
  if [[ $mounted == true ]] && ! hdiutil detach "$mount"; then
    echo "Could not detach the verification image at $mount." >&2
    return 1
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

mkdir "$mount" "$destination"
hdiutil verify "$image"
hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mount" "$image"
mounted=true
if [[ ! -d "$mount/Your Space.app" || -L "$mount/Your Space.app" ||
      ! -L "$mount/Applications" || $(readlink "$mount/Applications") != /Applications ||
      ! -d "$mount/Applications" ]]; then
  echo 'The image must contain Your Space.app and an Applications shortcut to /Applications.' >&2
  exit 1
fi
# Copy the bundle as a unit, preserving metadata as Finder does. The destination
# is private to this run so the test can never overwrite an existing installation.
ditto --rsrc --extattr "$mount/Your Space.app" "$app"
hdiutil detach "$mount"
mounted=false

executable="$app/Contents/MacOS/Your Space"
cli="$app/Contents/Resources/bin/your-space"
for binary in "$executable" "$cli"; do
  if [[ $(file -b "$binary") != "Mach-O 64-bit executable $cpu" ]]; then
    echo "Expected a $cpu Mach-O executable at $binary." >&2
    exit 1
  fi
done
codesign --verify --deep --strict "$app"
node "$root/desktop/scripts/seal-macos.mjs" verify "$app"
(cd "$app/Contents/Resources/release" && shasum -a 256 -c SHA256SUMS)
(cd "$root" && YS_DESKTOP_EXECUTABLE="$executable" npm run test:native -w desktop)
echo "Verified $cpu installation and relaunch after ejecting the disk image."
