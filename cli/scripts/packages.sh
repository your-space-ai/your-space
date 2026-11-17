#!/bin/sh
# Builds the .deb and .rpm packages for one processor from its standalone executable, with the
# distributions' own tools, dpkg-deb and rpmbuild (research R3):
#   scripts/packages.sh x64   ->  dist/your-space_<version>_amd64.deb, dist/your-space-<version>-1.x86_64.rpm
# Each package holds one file, /usr/bin/your-space, and depends on nothing.
set -eu
arch=$1
case "$arch" in
  x64) deb=amd64 rpm=x86_64 ;;
  arm64) deb=arm64 rpm=aarch64 ;;
  *) echo "usage: $0 x64|arm64" >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."
exe=dist/your-space-linux-$arch
test -x "$exe" || { echo "Build $exe first with scripts/executable.sh $arch." >&2; exit 1; }
version=$(node -p 'require("./package.json").version')
summary="Install and run Your Space"
url=https://github.com/your-space-ai/your-space

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# .deb
root=$work/deb
mkdir -p "$root/DEBIAN" "$root/usr/bin" "$root/usr/share/doc/your-space"
install -m 755 "$exe" "$root/usr/bin/your-space"
cat > "$root/DEBIAN/control" <<CONTROL
Package: your-space
Version: $version
Architecture: $deb
Maintainer: Your Space maintainers <$url>
Homepage: $url
Section: admin
Priority: optional
Description: $summary
 The your-space command: init a folder, start Your Space, and manage it.
CONTROL
printf 'Your Space\nLicense: AGPL-3.0-only\nSource: %s\n' "$url" > "$root/usr/share/doc/your-space/copyright"
dpkg-deb --root-owner-group --build "$root" "dist/your-space_${version}_${deb}.deb"

# .rpm. Versions can't hold "-", so a pre-release's "-" becomes "~", which sorts before the release.
rpmversion=$(echo "$version" | tr - '~')
mkdir -p "$work/rpm/SOURCES"
cp "$exe" "$work/rpm/SOURCES/your-space"
cat > "$work/your-space.spec" <<SPEC
Name: your-space
Version: $rpmversion
Release: 1
Summary: $summary
License: AGPL-3.0-only
URL: $url
Source0: your-space
# The executable carries the CLI inside it: stripping or changing it would break it.
%global debug_package %{nil}
%global __os_install_post %{nil}
%global __strip /bin/true
%global _build_id_links none
AutoReqProv: no

%description
The your-space command: init a folder, start Your Space, and manage it.

%install
install -D -m 755 %{SOURCE0} %{buildroot}/usr/bin/your-space

%files
/usr/bin/your-space
SPEC
rpmbuild -bb --quiet --target "$rpm" --define "_topdir $work/rpm" "$work/your-space.spec"
cp "$work"/rpm/RPMS/*/your-space-*.rpm dist/
echo "Built dist/your-space_${version}_${deb}.deb and the .rpm for $rpm."
