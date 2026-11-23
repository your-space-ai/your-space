#!/bin/bash
# Assemble a native candidate on a Mac of the target architecture.
set -euo pipefail
[[ $(uname -s) == Darwin && $# == 2 ]] || { echo 'Usage on macOS: package-macos.sh VERSION OUTPUT-DIR' >&2; exit 2; }
version=$1
[[ $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[a-zA-Z0-9.-]+)?$ ]] || { echo 'Expected a release version, e.g. 0.1.0.' >&2; exit 2; }
mkdir -p "$2"
out=$(cd "$2" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
electron=45.4.1
node_version=v26.13.1
case $(uname -m) in
  arm64)
    arch=arm64
    electron_sha=d080c3b05a01bd16137f2c12ab9ebf083c577757fe846844ba325bafa8e8bdf4
    node_sha=aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735 ;;
  x86_64)
    arch=x64
    electron_sha=1c80d2ccf71b02c8fd9940fd09cafe88090a48c1bab0193c79b597b08d890e79
    node_sha=82bb96078a24ca50b9c9a38f2379e6be6d87171fcd400fc14c8934b3bce96e2f ;;
  *) echo 'Unsupported Mac CPU.' >&2; exit 2 ;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
curl --fail --location --silent --show-error --retry 3 --proto '=https' --proto-redir '=https' \
  "https://github.com/electron/electron/releases/download/v$electron/electron-v$electron-darwin-$arch.zip" -o electron.zip
curl --fail --location --silent --show-error --retry 3 --proto '=https' --proto-redir '=https' \
  "https://nodejs.org/dist/$node_version/node-$node_version-darwin-$arch.tar.gz" -o node.tar.gz
printf '%s  %s\n' "$electron_sha" electron.zip "$node_sha" node.tar.gz | shasum -a 256 -c -
ditto -x -k electron.zip electron
tar -xzf node.tar.gz "node-$node_version-darwin-$arch/bin/node" "node-$node_version-darwin-$arch/LICENSE"
node_bin="$work/node-$node_version-darwin-$arch/bin/node"
app="$work/Your Space.app"
mv electron/Electron.app "$app"
resources="$app/Contents/Resources"
mkdir -p "$resources/app/desktop" "$resources/bin" "$resources/licenses" "$resources/release"
# Keep shared theme code inside the sealed archive at its source-relative path.
mkdir -p "$resources/app/shared/appearance"
cp "$root/shared/appearance/theme.mjs" "$resources/app/shared/appearance/"
rm "$resources/default_app.asar"
# Keep only product assets, excluding tooling, developer files and test fixtures.
cp "$root/desktop/package.json" "$resources/app/"
ditto --norsrc --noextattr "$root/desktop/src" "$resources/app/desktop/src"
if [[ -d $root/desktop/renderer ]]; then ditto --norsrc --noextattr "$root/desktop/renderer" "$resources/app/desktop/renderer"; fi
find "$resources/app" -name '._*' -type f -delete
"$node_bin" -e '
  const fs = require("node:fs"), [file, version] = process.argv.slice(1);
  const {name, productName, main, license, type} = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({name, productName, main:"desktop/"+main, license, type, version}, null, 2) + "\n");
' "$resources/app/package.json" "$version"
test -f "$resources/app/$("$node_bin" -p 'require(process.argv[1]).main' "$resources/app/package.json")"

plist="$app/Contents/Info.plist"
plutil -replace LSMinimumSystemVersion -string '13.5' "$plist"
plutil -replace CFBundleIdentifier -string 'ai.your-space.desktop' "$plist"
cp "$root/desktop/assets/your-space.icns" "$resources/your-space.icns"
rm "$resources/electron.icns"
plutil -replace CFBundleIconFile -string 'your-space.icns' "$plist"
plutil -replace CFBundleName -string 'Your Space' "$plist"
plutil -replace CFBundleDisplayName -string 'Your Space' "$plist"
plutil -replace CFBundleShortVersionString -string "${version%%-*}" "$plist"
plutil -replace CFBundleVersion -string "${version%%-*}" "$plist"
# Match Chromium's helper lookup to the outer executable name.
mv "$app/Contents/MacOS/Electron" "$app/Contents/MacOS/Your Space"
plutil -replace CFBundleExecutable -string 'Your Space' "$plist"
for helper in "$app/Contents/Frameworks"/Electron\ Helper*.app; do
  old_name=$(basename "$helper" .app)
  new_name="Your Space${old_name#Electron}"
  mv "$helper/Contents/MacOS/$old_name" "$helper/Contents/MacOS/$new_name"
  helper_plist="$helper/Contents/Info.plist"
  plutil -replace CFBundleName -string "$new_name" "$helper_plist"
  plutil -replace CFBundleExecutable -string "$new_name" "$helper_plist"
  case "$old_name" in
    'Electron Helper') helper_id=helper ;;
    'Electron Helper (Renderer)') helper_id=helper.renderer ;;
    'Electron Helper (GPU)') helper_id=helper.gpu ;;
    'Electron Helper (Plugin)') helper_id=helper.plugin ;;
    *) echo 'Unrecognized Electron helper bundle.' >&2; exit 1 ;;
  esac
  plutil -replace CFBundleIdentifier -string "ai.your-space.desktop.$helper_id" "$helper_plist"
  mv "$helper" "$app/Contents/Frameworks/$new_name.app"
done
cp electron/LICENSE "$resources/licenses/Electron-LICENSE.txt"
cp electron/LICENSES.chromium.html "$resources/licenses/"
cp "node-$node_version-darwin-$arch/LICENSE" "$resources/licenses/Node-LICENSE.txt"
cp "$root/LICENSE" "$resources/licenses/Your-Space-LICENSE.txt"
cp "$root/desktop/THIRD-PARTY.md" "$resources/licenses/THIRD-PARTY.md"

# Reuse the CLI's bundle and its upstream notices, stamped for the same release as the stack.
(cd "$root/cli" && "$node_bin" scripts/build.mjs "$version")
sed -n '/^ \* Bundled packages and their licenses:/,$p' "$root/cli/dist/your-space.cjs" > "$resources/licenses/CLI-NOTICES.txt"
test -s "$resources/licenses/CLI-NOTICES.txt"
"$node_bin" -e '
  const fs = require("node:fs"), [main, executable, output] = process.argv.slice(1);
  fs.writeFileSync("sea.json", JSON.stringify({main, executable, output, disableExperimentalSEAWarning: true}));
' "$root/cli/dist/your-space.cjs" "$node_bin" "$resources/bin/your-space"
"$node_bin" --build-sea sea.json
chmod +x "$resources/bin/your-space"
"$root/deploy/release-files.sh" "$version" "$resources/release"
(cd "$resources/release" && shasum -a 256 your-space.tar.gz > SHA256SUMS)
"$node_bin" "$root/desktop/scripts/seal-macos.mjs" seal "$app"
"$root/desktop/scripts/sign-bundle.sh" "$app" -
test "$("$resources/bin/your-space" --version)" = "$version"
name="your-space-macos-$arch-$version-preview.zip"
ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$app" "$work/$name"
mv "$work/$name" "$out/$name"
(cd "$out" && shasum -a 256 "$name" > "$name.sha256")
echo "Prepared $name"
