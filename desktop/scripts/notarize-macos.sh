#!/bin/bash
# Runs only for a release candidate, in the protected signing job of Release macOS app. It expects the
# Developer ID identity in the job's temporary keychain and an App Store Connect API key for notarytool.
set -euo pipefail
[[ $# == 2 && -f $1 ]] || { echo 'Usage: notarize-macos.sh CANDIDATE.dmg OUTPUT-DIR' >&2; exit 2; }
: "${MACOS_SIGN_IDENTITY:?Configure the approved Developer ID signing identity}"
: "${APPLE_API_KEY_PATH:?Provide the App Store Connect API key file}"
: "${APPLE_API_KEY_ID:?Provide the App Store Connect API key ID}"
: "${APPLE_API_ISSUER:?Provide the App Store Connect API issuer ID}"
[[ $MACOS_SIGN_IDENTITY != - ]] || exit 2
candidate=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
name=$(basename "$candidate")
[[ $name =~ ^your-space-macos-(arm64|x64)-([0-9]+\.[0-9]+\.[0-9]+(-[[:alnum:].-]+)?)-candidate\.dmg$ ]] || exit 2
arch=${BASH_REMATCH[1]}
version=${BASH_REMATCH[2]}
if [[ $arch == x64 ]]; then cpu=x86_64; else cpu=arm64; fi
name="your-space-macos-$arch-$version.dmg"
mkdir -p "$2"
out=$(cd "$2" && pwd)
bin=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
mount="$work/mount"
mounted=false
cleanup() {
  if "$mounted"; then
    # Only this script's private mount can be attached here.
    hdiutil detach "$mount" -quiet || hdiutil detach "$mount" -force -quiet || return 1
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
cd "$work"
attach() {
  mkdir -p "$mount"
  hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mount" "$1" >/dev/null
  mounted=true
  [[ ! -L "$mount/Your Space.app" && -d "$mount/Your Space.app" && $(readlink "$mount/Applications") == /Applications ]]
}
detach() {
  hdiutil detach "$mount" -quiet
  mounted=false
}
notarize() {
  xcrun notarytool submit "$1" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
    --wait --output-format json > result.json
  [[ $(plutil -extract status raw -o - result.json) == Accepted ]] || { echo 'Apple did not accept the submission.' >&2; return 1; }
}

attach "$candidate"
app="$work/Your Space.app"
ditto --rsrc --extattr --noqtn "$mount/Your Space.app" "$app"
detach
[[ $(lipo -archs "$app/Contents/MacOS/Your Space") == "$cpu" &&
   $(lipo -archs "$app/Contents/Resources/bin/your-space") == "$cpu" &&
   $(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist") == "${version%%-*}" ]]
codesign --verify --deep --strict "$app"
asar_sha=$(shasum -a 256 < "$app/Contents/Resources/app.asar")
developer_id='anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists'
"$bin/sign-bundle.sh" "$app" "$MACOS_SIGN_IDENTITY"
codesign --verify --deep --strict -R="$developer_id" "$app"
# Run the bundled CLI under its release signature (hardened runtime, JIT allowed) before the first
# submission, so a signature that stops it from starting fails in minutes, not after Apple's review.
# cli-version.sh runs it as another user, away from this job's credentials. Only this Mac's own
# processor runs it: Release macOS app opens the other architecture's notarized app on a Mac of that
# architecture.
if [[ $cpu == "$(uname -m)" ]]; then
  [[ $("$bin/cli-version.sh" "$app") == "$version" ]] ||
    { echo "The signed CLI didn't report version $version." >&2; exit 1; }
fi
# Staple the app itself so its ticket also travels with a copy to Applications.
ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$app" submit.zip
notarize submit.zip
xcrun stapler staple "$app"
xcrun stapler validate "$app"

"$bin/create-dmg.sh" "$app" "$work/$name"
codesign --sign "$MACOS_SIGN_IDENTITY" --timestamp --identifier ai.your-space.desktop.dmg "$name"
notarize "$name"
xcrun stapler staple "$name"
xcrun stapler validate "$name"
codesign --verify --strict -R="$developer_id" "$name"
spctl --assess --type open --context context:primary-signature "$name"

attach "$work/$name"
delivered="$mount/Your Space.app"
[[ $(shasum -a 256 < "$delivered/Contents/Resources/app.asar") == "$asar_sha" ]]
xcrun stapler validate "$delivered"
codesign --verify --deep --strict -R="$developer_id" "$delivered"
spctl --assess --type execute "$delivered"
detach
shasum -a 256 "$name" > "$name.sha256"
mv "$name" "$name.sha256" "$out/"
