#!/bin/bash
# Exercise the Finder installation contract on an isolated Applications directory. With
# --notarized, the image and the installed app must also pass Gatekeeper with their stapled tickets;
# with a VERSION, the installed app's CLI must report it.
set -euo pipefail
notarized=false
if [[ ${1:-} == --notarized ]]; then notarized=true; shift; fi
if [[ $(uname -s) != Darwin || ($# != 2 && $# != 3) || ! -f $1 ]]; then
  echo 'Usage on macOS: test-dmg-install.sh [--notarized] IMAGE.dmg arm64|x64 [VERSION]' >&2
  exit 2
fi
version=${3:-}
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
if [[ $notarized == true ]]; then
  xcrun stapler validate "$image"
  spctl --assess --type open --context context:primary-signature --verbose "$image"
fi
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
if [[ $notarized == true ]]; then
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose "$app"
fi
if [[ -n $version && $("$cli" --version) != "$version" ]]; then
  echo "Expected the CLI at $cli to report version $version." >&2
  exit 1
fi
node "$root/desktop/scripts/seal-macos.mjs" verify "$app"
(cd "$app/Contents/Resources/release" && shasum -a 256 -c SHA256SUMS)
(cd "$root" && YS_DESKTOP_EXECUTABLE="$executable" npm run test:native -w desktop)
echo "Verified $cpu installation and relaunch after ejecting the disk image."
