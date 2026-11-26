#!/usr/bin/env bash
# Chooses the build the Mac canary packages (spec 016, decision 3, FR-005), in the Mac canary
# workflow's version job, from a checkout of the run's commit on main with its history:
#   deploy/mac-canary-version.sh
# The build is the newest Linux canary, the one the rolling `canary` prerelease holds, which channel.json
# names (deploy/channel-json.sh) once its images are pushed and its install test has passed. It
# requires that build's SHA256SUMS beside it, so the Linux canary isn't replacing its files, and its
# commit on main and the checkout's: every later job checks out the run's commit, so the scripts that
# build, sign, check and publish the build are the ones it was built from, and a run on main runs no
# other commit's code. It builds nothing when the build is of an older commit on main, as until main's
# newest commit has a Linux canary, when the prerelease's canary-mac.yml already lists that build or a
# newer one, or when either Linux file is missing; a canary-mac.yml that isn't there yet is the first
# Mac canary.
#
# It writes build=true or build=false, and with true the build's version and commit, to
# $GITHUB_OUTPUT. Only GitHub's 404 means a file isn't there; any other answer, a channel.json or
# canary-mac.yml in another form, or a commit that isn't on main stops it with an error, so a moment's
# failure never builds an older canary. It needs bash, curl, git, Node, awk and coreutils.
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: deploy/mac-canary-version.sh" >&2
  exit 1
fi
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=deploy/gh-retry.sh
. "$root/deploy/gh-retry.sh"

# The canary's files at their fixed address, as clients read them. Only this repository has them.
feed=https://github.com/your-space-ai/your-space/releases/download/canary
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
output=${GITHUB_OUTPUT:-/dev/stdout}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
say() { echo "$1"; echo "$1" >> "$summary"; }
skip() {
  say "$1"
  echo "build=false" >> "$output"
  exit 0
}

# One of the prerelease's files, saved as $work/NAME. Only GitHub's 404 means there is none.
fetch() {
  local name=$1 code
  rm -f "$work/$name"
  code=$(curl --silent --show-error --location --proto '=https' --max-time 60 \
    --output "$work/$name" --write-out '%{http_code}' "$feed/$name") || return 1
  case $code in
    200) ;;
    404) rm -f "$work/$name" ;;
    *) echo "HTTP $code from $feed/$name" >&2; return 1 ;;
  esac
}

# Prints 1, 0 or -1 as the first version is newer than, the same as or older than the second, by
# Semantic Versioning's precedence as the CLI compares versions (cli/src/version.ts, which Node runs
# as it is), and fails when it can't compare them.
order() {
  local result
  if result=$(node --input-type=module -e '
      import { pathToFileURL } from "node:url";
      const [file, a, b] = process.argv.slice(1);
      const { compareVersions } = await import(pathToFileURL(file));
      console.log(Math.sign(compareVersions(a, b)) || 0);' "$root/cli/src/version.ts" "$1" "$2") &&
    [[ $result =~ ^(1|0|-1)$ ]]; then
    echo "$result"
  else
    echo "::error::Couldn't compare $1 with $2." >&2
    return 1
  fi
}

# The build channel.json names: Canary's, in the one form deploy/channel-json.sh writes.
retry fetch channel.json
[[ -f $work/channel.json ]] || skip "The canary prerelease has no channel.json, so no Linux canary is complete there: no Mac canary is built."
if ! fields=$(node -e '
    const named = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const values = [named.channel, named.version, named.commit];
    if (!values.every(value => typeof value === "string")) process.exit(1);
    console.log(values.join("\n"));' "$work/channel.json" 2> /dev/null) ||
  ! { read -r channel && read -r version && read -r commit; } <<< "$fields" ||
  [[ $channel != canary ]] ||
  ! "$root/deploy/channel-json.sh" canary "$version" "$commit" 2> /dev/null | cmp -s - "$work/channel.json"; then
  echo "::error::The canary prerelease's channel.json isn't one deploy/channel-json.sh writes for Canary, so no Mac canary is built. Find what wrote it at $feed/channel.json." >&2
  exit 1
fi

# Its SHA256SUMS, which lists its npm package: the Linux canary uploads it before channel.json and
# deletes both before it replaces any file, so without it a newer build is on its way.
retry fetch SHA256SUMS
if [[ ! -f $work/SHA256SUMS ]] || ! awk -v name="your-space-ai-cli-$version.tgz" '$2 == name { found = 1 } END { exit !found }' "$work/SHA256SUMS"; then
  skip "The canary prerelease's SHA256SUMS isn't $version's, so the Linux canary is replacing its files: no Mac canary is built."
fi

# Built from main: the checkout's main holds the commit.
if ! git merge-base --is-ancestor "$commit" origin/main; then
  echo "::error::$commit, which the canary prerelease's channel.json names, isn't on main, so no Mac canary is built." >&2
  exit 1
fi
# And the run's own commit, the one every later job checks out.
run_commit=$(git rev-parse HEAD)
if [[ $commit != "$run_commit" ]]; then
  skip "The canary prerelease's channel.json names $commit, not this run's commit, $run_commit, the newest on main when it started: no Mac canary is built."
fi

# The build canary-mac.yml lists: its first line, as update-feed.mjs writes it, which must name a
# canary.
retry fetch canary-mac.yml
if [[ -f $work/canary-mac.yml ]]; then
  first=
  pattern="^version: '([^']+)'\$"
  IFS= read -r first < "$work/canary-mac.yml" || true
  if [[ ! $first =~ $pattern ]] || ! "$root/deploy/channel-json.sh" canary "${BASH_REMATCH[1]}" "$commit" > /dev/null 2>&1; then
    echo "::error::The canary prerelease's canary-mac.yml doesn't list a canary in the form the Mac canary writes it, so no Mac canary is built. Find what wrote it at $feed/canary-mac.yml." >&2
    exit 1
  fi
  listed=${BASH_REMATCH[1]}
  listed_order=$(order "$listed" "$version") || exit 1
  if ((listed_order >= 0)); then
    skip "The canary prerelease's canary-mac.yml already lists $listed, so no Mac canary of $version is built."
  fi
fi

say "Mac canary of $version, built from $commit."
{
  echo "build=true"
  echo "version=$version"
  echo "commit=$commit"
} >> "$output"
