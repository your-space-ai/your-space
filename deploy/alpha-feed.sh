#!/usr/bin/env bash
# Points the Alpha channel's feed at a published release (spec 016, decision 5, FR-003):
#   deploy/alpha-feed.sh v0.1.0-alpha.2
# Release publish runs it, and nothing else does, once the release has passed its stranger check.
# The feed is the rolling `alpha` prerelease, at a fixed address, which holds two files and nothing
# else: latest-mac.yml, which the Mac app on Alpha reads and which lists the release's two update
# ZIPs by their full links into the `v` release (desktop/scripts/channel-feed.mjs), and
# channel.json, which names the release for `your-space upgrade --channel alpha`
# (deploy/channel-json.sh). It never points the feed at an older release than the one it names, and
# never at a canary.
#
# Safe to re-run: it changes nothing once the feed names this release or a newer one, it looks for
# the `alpha` prerelease before it creates one, and --clobber replaces a file an attempt uploaded.
# Each call to GitHub is retried while GitHub answers with a server error (deploy/gh-retry.sh).
# latest-mac.yml goes up first and channel.json last, each checked once it is there, so channel.json
# names this release only once the Mac app's feed is this release's. It needs bash, curl, gh, Node,
# awk and coreutils, and GH_TOKEN with contents: write.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: deploy/alpha-feed.sh TAG" >&2
  exit 1
fi
tag=$1
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=deploy/gh-retry.sh
. "$root/deploy/gh-retry.sh"

# The feed's fixed address, which the Mac app and the CLI read. Only this repository has it.
repo=your-space-ai/your-space
api=repos/$repo
feed=https://github.com/$repo/releases/download/alpha
title='Alpha channel feed (not a release)'
notes="The Alpha channel's feed: latest-mac.yml, which the Mac app reads when its Update Channel is Alpha, and channel.json, which your-space upgrade --channel alpha reads. Both point at the newest published release, and Release publish replaces them when a newer one is published. This isn't a release: to install Your Space, use a numbered release as the installation guide says: https://github.com/$repo/blob/main/docs/install/index.md"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
say() { echo "$1"; echo "$1" >> "$summary"; }

if [[ $tag != v* ]]; then
  echo "$tag isn't a release's tag, such as v0.1.0-alpha.2." >&2
  exit 1
fi
version=${tag#v}

# Alpha's channel.json for this release, at the commit its tag points to. channel-json.sh refuses a
# version that isn't one, or is a canary's, before anything changes.
commit=$(retry gh api "$api/commits/$tag" --jq .sha)
"$root/deploy/channel-json.sh" alpha "$version" "$commit" > "$work/channel.json"

# The feed's channel.json at its fixed address, as clients read it, saved as $work/named.json. Only
# GitHub's 404 means there is none yet: no `alpha` prerelease, only a draft an attempt left, or no
# channel.json on it. Any other answer stops, so a moment's failure never lets an older release in.
fetch_named() {
  local code
  rm -f "$work/named.json"
  code=$(curl --silent --show-error --location --proto '=https' --max-time 60 \
    --output "$work/named.json" --write-out '%{http_code}' "$feed/channel.json") || return 1
  case $code in
    200) ;;
    404) rm -f "$work/named.json" ;;
    *) echo "HTTP $code from $feed/channel.json" >&2; return 1 ;;
  esac
}

# The version the feed's channel.json names, or nothing when there is none. It must be Alpha's, in
# the one form deploy/channel-json.sh writes, or nothing changes, for a maintainer to look.
named_version() {
  local fields channel named named_commit
  [[ -f $work/named.json ]] || return 0
  if fields=$(node -e '
      const named = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      const values = [named.channel, named.version, named.commit];
      if (!values.every(value => typeof value === "string")) process.exit(1);
      console.log(values.join("\n"));' "$work/named.json" 2> /dev/null) &&
    { read -r channel && read -r named && read -r named_commit; } <<< "$fields" &&
    [[ $channel == alpha ]] &&
    "$root/deploy/channel-json.sh" alpha "$named" "$named_commit" 2> /dev/null | cmp -s - "$work/named.json"; then
    echo "$named"
  else
    echo "::error::The alpha feed's channel.json isn't one deploy/channel-json.sh writes for Alpha, so nothing is replaced. Find what wrote it at $feed/channel.json, then re-run." >&2
    return 1
  fi
}

# Succeeds when the feed already names this release or a newer one, by Semantic Versioning's
# precedence as the CLI compares versions (cli/src/version.ts, which Node runs as it is). Any
# failure to read or compare stops the script rather than counting as an older feed.
covered() {
  local named status=0
  retry fetch_named || exit 1
  named=$(named_version) || exit 1
  [[ -n $named ]] || return 1
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const [file, named, version] = process.argv.slice(1);
    const { compareVersions } = await import(pathToFileURL(file));
    process.exit(compareVersions(named, version) >= 0 ? 0 : 10);' "$root/cli/src/version.ts" "$named" "$version" || status=$?
  case $status in
    0) say "The alpha feed already names $named, so it stays as it is for $tag." ;;
    10) return 1 ;;
    *) echo "::error::Couldn't compare $named, which the alpha feed names, with $version." >&2; exit 1 ;;
  esac
}

if covered; then exit 0; fi

# The release's own latest-mac.yml, checked against its SHA256SUMS, which lists it once.
mkdir "$work/release"
retry gh release download "$tag" --repo "$repo" --pattern latest-mac.yml --pattern SHA256SUMS --dir "$work/release" --clobber > /dev/null
if ! (cd "$work/release" && test "$(awk '$2 == "latest-mac.yml"' SHA256SUMS | wc -l)" -eq 1 &&
  awk '$2 == "latest-mac.yml"' SHA256SUMS | sha256sum --check --status -); then
  echo "::error::$tag's latest-mac.yml is missing or doesn't match its SHA256SUMS, so the alpha feed stays as it is. Check the release's files." >&2
  exit 1
fi
node "$root/desktop/scripts/channel-feed.mjs" "$version" "$work/release/latest-mac.yml" "$work/latest-mac.yml"

# The alpha prerelease's id. It looks before it creates, so a retry after GitHub failed but made the
# release anyway takes that one rather than making another. A draft an attempt left is published as
# it is, and a missing release is created with no files, tagged alpha at this release's commit. It
# is a prerelease and never the latest release; a draft gets the same commit, so publishing it makes
# the alpha tag there too when there is none.
options=(-F prerelease=true -f make_latest=false -f target_commitish="$commit" --jq .id)
alpha_release() {
  local found
  found=$(gh api --paginate "$api/releases?per_page=100" --jq '.[] | select(.tag_name == "alpha") | "\(.draft) \(.id)"') || return 1
  # The published one, if there is one, comes before any draft.
  found=$(sort <<< "$found" | sed -n 1p)
  case $found in
    false\ *) echo "${found#* }" ;;
    true\ *) gh api --method PATCH "$api/releases/${found#* }" -F draft=false "${options[@]}" ;;
    *) gh api --method POST "$api/releases" -f tag_name=alpha -f name="$title" -f body="$notes" "${options[@]}" ;;
  esac
}
id=$(retry alpha_release)
retry gh api --method PATCH "$api/releases/$id" -F prerelease=true -f make_latest=false -f name="$title" -f body="$notes" --silent

# Just before writing, in case a newer release was published meanwhile.
if covered; then exit 0; fi

# Replaces one of the feed's files and checks it downloads unchanged. Any file an upload left half
# there (not "uploaded") is deleted first: GitHub refuses the next upload of its name (HTTP 422)
# until it is. A file already gone (HTTP 404) counts as deleted.
replace() {
  local name=$1 asset state listed
  gh api --paginate "$api/releases/$id/assets?per_page=100" --jq '.[] | "\(.id) \(.state) \(.name)"' > "$work/listed" || return 1
  while read -r asset state listed; do
    if [[ $listed == "$name" && $state != uploaded ]]; then
      gh api --method DELETE "$api/releases/assets/$asset" 2> "$work/deleted" ||
        grep -q 'HTTP 404' "$work/deleted" || { cat "$work/deleted" >&2; return 1; }
    fi
  done < "$work/listed"
  gh release upload alpha "$work/$name" --repo "$repo" --clobber
}
for name in latest-mac.yml channel.json; do
  retry replace "$name"
  retry gh release download alpha --repo "$repo" --pattern "$name" --output "$work/downloaded" --clobber
  cmp -s "$work/$name" "$work/downloaded" || { echo "::error::The alpha feed's $name doesn't download as it was uploaded. Re-run the job." >&2; exit 1; }
done
say "The alpha feed points at $tag."
