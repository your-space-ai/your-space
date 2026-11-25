#!/bin/sh
# Prints a channel's channel.json, the file `your-space upgrade --channel <name>` reads to find the
# channel's build (spec 016, decision 5). Every channel.json has this one form, on one line:
#   deploy/channel-json.sh canary 0.1.0-alpha.1.canary.20261125.5 69525a9569f68a39b76598af86662a04b6fb2886
#   ->  {"channel":"canary","version":"0.1.0-alpha.1.canary.20261125.5","commit":"69525a9569f68a39b76598af86662a04b6fb2886"}
# The version is the build's, and the commit the full one it was built from. Canary names only a
# canary build, as deploy/canary-version.sh makes them, and Alpha never names one, so an Alpha
# client never gets a canary.
set -eu
channel=$1
version=$2
commit=$3
identifier='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
number='(0|[1-9][0-9]*)'
# Semantic Versioning 2.0.0, as the CLI reads versions (cli/src/version.ts).
if ! printf '%s\n' "$version" | grep -Eqx "$number\.$number\.$number(-$identifier(\.$identifier)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?"; then
  echo "$version isn't a version such as 0.1.0-alpha.2." >&2
  exit 1
fi
# A canary is a version with a prerelease identifier `canary`; build metadata after + doesn't count.
release=${version%%+*}
case $release in
  *-*) prerelease=.${release#*-}. ;;
  *) prerelease= ;;
esac
case $prerelease in
  *.canary.*) canary=true ;;
  *) canary=false ;;
esac
case $channel in
  canary)
    if [ "$canary" = false ]; then echo "$version isn't a canary build, so Canary's channel.json can't name it." >&2; exit 1; fi
    ;;
  alpha)
    if [ "$canary" = true ]; then echo "$version is a canary build, so Alpha's channel.json can't name it." >&2; exit 1; fi
    ;;
  *) echo "$channel isn't a channel: alpha or canary." >&2; exit 1 ;;
esac
if ! printf '%s\n' "$commit" | grep -Eqx '[0-9a-f]{40}'; then
  echo "$commit isn't a full commit such as 69525a9569f68a39b76598af86662a04b6fb2886." >&2
  exit 1
fi
printf '{"channel":"%s","version":"%s","commit":"%s"}\n' "$channel" "$version" "$commit"
