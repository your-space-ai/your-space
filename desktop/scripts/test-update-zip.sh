#!/bin/bash
# Checks an update ZIP the way the in-app updater uses it: the feed in the same folder lists it with
# its SHA-512 and size, and it unpacks to a sealed app of the right architecture and version with the
# updater's settings. The feed is latest-mac.yml, a release's, unless --feed names another, such as
# canary-mac.yml, the Mac canary's. With --notarized, the app must also carry the Developer ID
# signature Squirrel.Mac requires, a stapled ticket and Gatekeeper's approval. It only reads the feed.
set -euo pipefail
usage() {
  echo 'Usage on macOS: test-update-zip.sh [--notarized] [--feed NAME-mac.yml] UPDATE.zip arm64|x64 VERSION' >&2
  exit 2
}
notarized=false
feed_name=latest-mac.yml
while [[ ${1:-} == --* ]]; do
  case $1 in
    --notarized) notarized=true; shift ;;
    --feed) (($# >= 2)) || usage; feed_name=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ $(uname -s) == Darwin && $# == 3 && -f $1 && $feed_name =~ ^[a-z]+-mac\.yml$ ]] || usage
zip=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
version=$3
case $2 in
  arm64) cpu=arm64 ;;
  x64) cpu=x86_64 ;;
  *) echo 'Choose arm64 or x64.' >&2; exit 2 ;;
esac
name="your-space-macos-$2-$version.zip"
[[ $(basename "$zip") == "$name" ]] || { echo "Expected $name." >&2; exit 1; }
feed="$(dirname "$zip")/$feed_name"
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

grep -Fxq "version: '$version'" "$feed" || { echo "$feed_name isn't for $version." >&2; exit 1; }
sha512=$(openssl dgst -sha512 -binary "$zip" | openssl base64 -A)
size=$(wc -c < "$zip" | tr -d ' ')
grep -A2 -Fx "  - url: $name" "$feed" | diff - <(printf '%s\n' "  - url: $name" "    sha512: '$sha512'" "    size: $size") ||
  { echo "$feed_name doesn't list $name with its digest and size." >&2; exit 1; }

# Squirrel.Mac unpacks the update with ditto, as here.
ditto -x -k "$zip" "$work"
app="$work/Your Space.app"
[[ -d $app && ! -L $app && $(find "$work" -mindepth 1 -maxdepth 1 | wc -l) -eq 1 ]] ||
  { echo 'The ZIP must hold Your Space.app alone.' >&2; exit 1; }
for binary in "$app/Contents/MacOS/Your Space" "$app/Contents/Resources/bin/your-space"; do
  [[ $(file -b "$binary") == "Mach-O 64-bit executable $cpu" ]] || { echo "Expected a $cpu Mach-O executable at $binary." >&2; exit 1; }
done
[[ $(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist") == "$version" ]] ||
  { echo "The app doesn't report version $version." >&2; exit 1; }
diff "$root/desktop/app-update.yml" "$app/Contents/Resources/app-update.yml"
codesign --verify --deep --strict "$app"
if [[ $notarized == true ]]; then
  codesign --verify --deep --strict -R='anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' "$app"
  xcrun stapler validate "$app"
  spctl --assess --type execute "$app"
fi
node "$root/desktop/scripts/seal-macos.mjs" verify "$app"
node -e '
  const asar = require(require.resolve("@electron/asar", { paths: [process.argv[2]] }));
  const files = asar.listPackage(process.argv[1], { isPack: false });
  if (!files.includes("/desktop/vendor/electron-updater.cjs")) throw new Error("The sealed archive has no updater.");
' "$app/Contents/Resources/app.asar" "$root/desktop"
echo "Verified the $cpu update ZIP for $version."
