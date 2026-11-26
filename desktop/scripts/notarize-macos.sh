#!/bin/bash
# Runs only in a protected signing job on a GitHub-hosted Mac: Release macOS app's for a release, and
# the Mac canary's for a canary. It expects the Developer ID identity in the job's temporary keychain
# and an App Store Connect API key for notarytool.
#   notarize-macos.sh CANDIDATE.dmg OUTPUT-DIR
# For a release, it writes the notarized DMG and the in-app updater's ZIP of the same stapled app,
# each with a .sha256.
#   notarize-macos.sh --update-only CANDIDATE.dmg... OUTPUT-DIR
# For the Mac canary, which ships no DMG, it writes only each app's update ZIP, with its .sha256. It
# signs every candidate's app and submits them all before it waits for any, so Apple's reviews of the
# two architectures overlap.
set -euo pipefail
update_only=false
if [[ ${1:-} == --update-only ]]; then update_only=true; shift; fi
usage() {
  echo 'Usage: notarize-macos.sh CANDIDATE.dmg OUTPUT-DIR, or notarize-macos.sh --update-only CANDIDATE.dmg... OUTPUT-DIR' >&2
  exit 2
}
if [[ $update_only == true ]]; then (($# >= 2)) || usage; else (($# == 2)) || usage; fi
candidates=("${@:1:$#-1}")
output=${!#}
for i in "${!candidates[@]}"; do
  [[ -f ${candidates[i]} ]] || usage
  candidates[i]=$(cd "$(dirname "${candidates[i]}")" && pwd)/$(basename "${candidates[i]}")
done
: "${MACOS_SIGN_IDENTITY:?Configure the approved Developer ID signing identity}"
: "${APPLE_API_KEY_PATH:?Provide the App Store Connect API key file}"
: "${APPLE_API_KEY_ID:?Provide the App Store Connect API key ID}"
: "${APPLE_API_ISSUER:?Provide the App Store Connect API issuer ID}"
[[ $MACOS_SIGN_IDENTITY != - ]] || exit 2
mkdir -p "$output"
out=$(cd "$output" && pwd)
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
developer_id='anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists'

# Reads a candidate's architecture and version from its name, into arch, cpu and version.
candidate_name() {
  [[ $(basename "$1") =~ ^your-space-macos-(arm64|x64)-([0-9]+\.[0-9]+\.[0-9]+(-[[:alnum:].-]+)?)-candidate\.dmg$ ]] || exit 2
  arch=${BASH_REMATCH[1]}
  version=${BASH_REMATCH[2]}
  if [[ $arch == x64 ]]; then cpu=x86_64; else cpu=arm64; fi
}

# Copies the app out of a candidate image to DIR/Your Space.app, checks it, signs it with the
# Developer ID and zips it to DIR/submit.zip for Apple. It sets asar_sha to the digest of its archive.
sign_app() {
  local app="$2/Your Space.app"
  attach "$1"
  ditto --rsrc --extattr --noqtn "$mount/Your Space.app" "$app"
  detach
  [[ $(lipo -archs "$app/Contents/MacOS/Your Space") == "$cpu" &&
     $(lipo -archs "$app/Contents/Resources/bin/your-space") == "$cpu" &&
     $(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist") == "$version" ]]
  codesign --verify --deep --strict "$app"
  asar_sha=$(shasum -a 256 < "$app/Contents/Resources/app.asar")
  "$bin/sign-bundle.sh" "$app" "$MACOS_SIGN_IDENTITY"
  codesign --verify --deep --strict -R="$developer_id" "$app"
  # Run the bundled CLI under its release signature (hardened runtime, JIT allowed) before the first
  # submission, so a signature that stops it from starting fails in minutes, not after Apple's review.
  # cli-version.sh runs it as another user, away from this job's credentials. Only this Mac's own
  # processor runs it: the other architecture's notarized app is opened on a Mac of that architecture.
  if [[ $cpu == "$(uname -m)" ]]; then
    [[ $("$bin/cli-version.sh" "$app") == "$version" ]] ||
      { echo "The signed CLI didn't report version $version." >&2; exit 1; }
  fi
  ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$app" "$2/submit.zip"
}

if [[ $update_only == true ]]; then
  # One candidate for each architecture, all of one version, before anything is signed.
  seen=
  for candidate in "${candidates[@]}"; do
    candidate_name "$candidate"
    [[ " $seen " != *" $arch "* ]] || { echo "Two candidates for $arch." >&2; exit 2; }
    [[ ${first_version:=$version} == "$version" ]] || { echo 'The candidates are of different versions.' >&2; exit 2; }
    seen="$seen $arch"
  done
  # Each app in a folder of its own, signed and submitted in turn; then each submission is waited for.
  ids=()
  dirs=()
  for candidate in "${candidates[@]}"; do
    candidate_name "$candidate"
    dir="$work/$arch"
    mkdir "$dir"
    sign_app "$candidate" "$dir"
    xcrun notarytool submit "$dir/submit.zip" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
      --output-format json > "$dir/submitted.json"
    id=$(plutil -extract id raw -o - "$dir/submitted.json")
    ids+=("$id")
    dirs+=("$dir")
  done
  for i in "${!ids[@]}"; do
    dir=${dirs[i]}
    arch=$(basename "$dir")
    xcrun notarytool wait "${ids[i]}" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
      --output-format json > "$dir/result.json"
    [[ $(plutil -extract status raw -o - "$dir/result.json") == Accepted ]] ||
      { echo "Apple did not accept the $arch submission ${ids[i]}." >&2; exit 1; }
    # Staple the app itself so its ticket also travels with a copy to Applications.
    app="$dir/Your Space.app"
    xcrun stapler staple "$app"
    xcrun stapler validate "$app"
    codesign --verify --deep --strict -R="$developer_id" "$app"
    spctl --assess --type execute "$app"
    # The in-app updater installs this ZIP of the stapled app. Squirrel.Mac accepts it only if it
    # carries the same Developer ID designated requirement as the running app.
    update="your-space-macos-$arch-$version.zip"
    ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$app" "$dir/$update"
    (cd "$dir" && shasum -a 256 "$update" > "$update.sha256")
    mv "$dir/$update" "$dir/$update.sha256" "$out/"
  done
  exit 0
fi

candidate=${candidates[0]}
candidate_name "$candidate"
name="your-space-macos-$arch-$version.dmg"
app="$work/Your Space.app"
sign_app "$candidate" "$work"
notarize submit.zip
# Staple the app itself so its ticket also travels with a copy to Applications.
xcrun stapler staple "$app"
xcrun stapler validate "$app"
# The in-app updater installs this ZIP of the stapled app. Squirrel.Mac accepts it only if it carries
# the same Developer ID designated requirement as the running app.
update="your-space-macos-$arch-$version.zip"
ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$app" "$update"

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
shasum -a 256 "$update" > "$update.sha256"
mv "$name" "$name.sha256" "$update" "$update.sha256" "$out/"
