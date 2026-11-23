#!/bin/bash
# Prints the version an app's bundled CLI reports. It runs a copy of the CLI, whose signature is
# embedded in it, as the unprivileged `nobody` user with an empty environment, so the release
# signing job's keychain, API key file and secret environment stay out of the CLI's reach.
set -euo pipefail
[[ $(uname -s) == Darwin && $# == 1 && -f "$1/Contents/Resources/bin/your-space" ]] || {
  echo 'Usage on macOS: cli-version.sh APP' >&2
  exit 2
}
dir=$(mktemp -d /tmp/your-space-cli.XXXXXX)
trap 'rm -rf "$dir"' EXIT
cp "$1/Contents/Resources/bin/your-space" "$dir/your-space"
chmod 755 "$dir" "$dir/your-space"
cd "$dir"
sudo -n -u nobody /usr/bin/env -i PATH=/usr/bin:/bin "$dir/your-space" --version
