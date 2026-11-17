#!/bin/sh
# Builds the standalone Linux executable for one processor, x64 or arm64, from dist/your-space.cjs
# with Node's own single-executable feature (Node 25.5 or newer; research R3):
#   scripts/executable.sh x64     ->  dist/your-space-linux-x64
# For another processor it uses the official Node binary of the same version, checked against
# Node's published checksums, so one machine builds both.
set -eu
arch=$1
case "$arch" in x64 | arm64) ;; *) echo "usage: $0 x64|arm64" >&2; exit 1 ;; esac
cd "$(dirname "$0")/.."
test -f dist/your-space.cjs || { echo "Run npm run build first." >&2; exit 1; }

version=$(node --version)
if [ "$(node -p process.arch)" = "$arch" ]; then
  node_bin=$(command -v node)
else
  dir=dist/node-$version-linux-$arch
  if [ ! -x "$dir/bin/node" ]; then
    base=https://nodejs.org/dist/$version
    file=node-$version-linux-$arch.tar.xz
    curl -fsSL -o "dist/$file" "$base/$file"
    curl -fsSL -o dist/SHASUMS256.txt "$base/SHASUMS256.txt"
    (cd dist && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
    mkdir -p "$dir" && tar -xJf "dist/$file" -C "$dir" --strip-components=1
  fi
  node_bin=$dir/bin/node
fi

out=dist/your-space-linux-$arch
cat > "dist/sea-$arch.json" <<JSON
{
  "main": "dist/your-space.cjs",
  "output": "$out",
  "executable": "$node_bin",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": false,
  "useSnapshot": false
}
JSON
node --build-sea "dist/sea-$arch.json"
chmod 755 "$out"
echo "Built $out with Node $version."
