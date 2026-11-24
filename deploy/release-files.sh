#!/bin/sh
# Makes a release's install files, your-space.tar.gz, from deploy/: compose.yaml, stack.yaml, modes/
# and env.example, with stack.yaml running that release's images by default, so a later
# `docker compose pull` never pairs new images with old mode files. The tarball holds no .env, so
# unpacking it over an installation keeps the owner's settings; its files sit at the top level.
# The release workflow and the CLI's browser tests both use it:
#   deploy/release-files.sh 0.3.0 <out-folder>   ->  <out-folder>/your-space.tar.gz
set -eu
version=$1
out=$2
deploy=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp -r "$deploy/compose.yaml" "$deploy/stack.yaml" "$deploy/modes" "$work/"
cp "$deploy/.env.example" "$work/env.example"
# The release's own images, with no variable an .env could set to run other ones (decision
# 2026-11-23, Alpha scope).
image='ghcr\.io/your-space-ai/your-space-(server|web|runtime)'
sed -E "s#($image):latest\$#\1:$version#" "$deploy/stack.yaml" > "$work/stack.yaml"
# Every Your Space image: the secrets step, Caddy, the server and the runtime manager.
images=$(grep -Ec "$image:$version\$" "$work/stack.yaml")
if [ "$images" -ne 4 ]; then echo "Expected 4 images pinned to $version in stack.yaml, found $images." >&2; exit 1; fi
if grep -Erq "$image:latest" "$work"; then echo "A file still runs the latest images." >&2; exit 1; fi
mkdir -p "$out"
# Owned by root in the archive, not by the build machine's user. Only GNU tar takes these options;
# the CLI and the guide unpack with --no-same-owner anyway, so the Mac build's bsdtar needs nothing.
set --
if tar --version 2>/dev/null | grep -q "GNU tar"; then set -- --owner=0 --group=0 --numeric-owner; fi
tar "$@" -czf "$out/your-space.tar.gz" -C "$work" compose.yaml stack.yaml modes env.example
