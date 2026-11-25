#!/bin/sh
# Prints the version of a canary build of main: the release it follows, then canary, the build's
# UTC date and a number that grows with each build (decision 2026-11-25, canary builds). It sorts
# after that release and before any later one, so `your-space upgrade` moves an installation onto
# a canary from the release it follows, and from a canary on to the next release:
#   deploy/canary-version.sh v0.1.0-alpha.1 20261125 42   ->  0.1.0-alpha.1.canary.20261125.42
#   deploy/canary-version.sh v0.1.0 20261125 42           ->  0.1.1-0.canary.20261125.42
# After a stable release the patch number goes up, and the leading 0 sorts the canary before any
# prerelease of that next version, such as 0.1.1-alpha.1.
set -eu
tag=$1
day=$2
build=$3
number='(0|[1-9][0-9]*)'
if ! printf '%s\n' "$tag" | grep -Eqx "v$number\.$number\.$number(-(alpha|beta)(\.[0-9A-Za-z-]+)*)?"; then
  echo "$tag isn't a release tag such as v0.1.0 or v0.1.0-alpha.1." >&2
  exit 1
fi
if ! printf '%s\n' "$day" | grep -Eqx '[1-9][0-9]{7}'; then echo "$day isn't a date such as 20261125." >&2; exit 1; fi
if ! printf '%s\n' "$build" | grep -Eqx '[1-9][0-9]*'; then echo "$build isn't a build number such as 42." >&2; exit 1; fi

release=${tag#v}
case $release in
  *-*) version="$release.canary.$day.$build" ;;
  *)
    patch=${release##*.}
    version="${release%.*}.$((patch + 1))-0.canary.$day.$build"
    ;;
esac
# Every identifier is valid Semantic Versioning: numbers without leading zeroes.
identifier='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
if ! printf '%s\n' "$version" | grep -Eqx "$number\.$number\.$number-$identifier(\.$identifier)*"; then
  echo "$version isn't a valid version." >&2
  exit 1
fi
echo "$version"
