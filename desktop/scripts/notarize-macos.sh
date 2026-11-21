#!/bin/bash
# Runs only for a release candidate on the protected signing runner.
set -euo pipefail
[[ $# == 2 && -f $1 ]] || { echo 'Usage: notarize-macos.sh PREVIEW-ZIP OUTPUT-DIR' >&2; exit 2; }
: "${MACOS_SIGN_IDENTITY:?Configure the approved Developer ID signing identity}"
: "${MACOS_NOTARY_PROFILE:?Configure the existing notarytool keychain profile}"
[[ $MACOS_SIGN_IDENTITY != - ]] || exit 2
zip=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
name=$(basename "$zip")
[[ $name == your-space-macos-*-preview.zip ]] || exit 2
mkdir -p "$2"
out=$(cd "$2" && pwd)
bin=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
ditto -x -k "$zip" extracted
app="$work/extracted/Your Space.app"
"$bin/sign-bundle.sh" "$app" "$MACOS_SIGN_IDENTITY"
# Apple-issued Developer ID Application, never an ad-hoc or private test certificate.
codesign --verify --deep --strict -R='anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' "$app"
ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$app" submit.zip
xcrun notarytool submit submit.zip --keychain-profile "$MACOS_NOTARY_PROFILE" --wait --output-format json > result.json
[[ $(plutil -extract status raw -o - result.json) == Accepted ]] || { echo 'Apple did not accept this archive.' >&2; exit 1; }
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute "$app"
name="${name%-preview.zip}.zip"
ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$app" "$work/$name"
# Verify the stapled app after the final distribution archive is unpacked.
ditto -x -k "$work/$name" verify
xcrun stapler validate 'verify/Your Space.app'
codesign --verify --deep --strict 'verify/Your Space.app'
spctl --assess --type execute 'verify/Your Space.app'
mv "$work/$name" "$out/$name"
(cd "$out" && shasum -a 256 "$name" > "$name.sha256")
