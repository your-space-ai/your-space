#!/usr/bin/env bash
# Publishes a Mac canary on the rolling `canary` prerelease (spec 016, decision 5, FR-005), in the Mac
# canary workflow's publish job:
#   deploy/mac-canary-publish.sh 0.1.0-alpha.2.canary.20261201.60 DIR
# DIR holds what the workflow's sign job made and its verify jobs checked: the build's two update
# ZIPs, each with its .sha256, and canary-mac.yml, which lists them (update-feed.mjs --channel canary).
# It uploads both ZIPs, then canary-mac.yml, each checked once it is there, and only then deletes the
# older Mac ZIPs, so canary-mac.yml never lists a ZIP that isn't there. A Mac app that read the older
# canary-mac.yml just before finds its ZIP gone, and its next check gets this build. --clobber deletes
# the older canary-mac.yml before it uploads this one, so for a moment there is none: a Mac app on
# Canary that checks then says it couldn't check. A run that stops in between leaves none until it is
# re-run, or until the next day's run, which then builds as for the first Mac canary.
#
# It changes only the Mac canary's own files there: canary-mac.yml and the Mac ZIPs. The prerelease is
# the Canary workflow's: this never creates or publishes it, and never touches its title, its notes,
# the Linux files, SHA256SUMS or channel.json. It never uploads latest-mac.yml, the file an Alpha Mac
# app reads, and if the prerelease holds one it stops before changing anything. It changes nothing
# when canary-mac.yml or a Mac ZIP there names a newer build, such as one whose run stopped part way,
# or when canary-mac.yml lists this build as another run signed it.
#
# Safe to re-run: once canary-mac.yml is this build's, it only checks the files and finishes the
# deletions; a file an upload left half there is deleted before its name is uploaded again, and
# --clobber replaces one that is there. Each call to GitHub is retried while GitHub answers with a
# server error (deploy/gh-retry.sh). It needs bash, gh, Node, awk and coreutils, and GH_TOKEN with
# contents: write.
set -euo pipefail

if [[ $# -ne 2 || ! -d $2 ]]; then
  echo "Usage: deploy/mac-canary-publish.sh VERSION DIR" >&2
  exit 1
fi
version=$1
dir=$(cd "$2" && pwd)
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=deploy/gh-retry.sh
. "$root/deploy/gh-retry.sh"

repo=your-space-ai/your-space
api=repos/$repo
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
say() { echo "$1"; echo "$1" >> "$summary"; }
# The Mac canary's own files on the prerelease: canary-mac.yml, and the update ZIPs, whose names
# carry their build's version.
own_zip='your-space-macos-(arm64|x64)-(.+)\.zip'

# Succeeds for a canary's version, by the CLI's rules (cli/src/version.ts, which Node runs as it is).
is_canary() {
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const [file, version] = process.argv.slice(1);
    const { isVersion, isCanary } = await import(pathToFileURL(file));
    process.exit(isVersion(version) && isCanary(version) ? 0 : 1);' "$root/cli/src/version.ts" "$1"
}

# Prints 1, 0 or -1 as the first version is newer than, the same as or older than the second, by
# Semantic Versioning's precedence as the CLI compares versions, and fails when it can't compare them.
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

# This build's files in DIR: exactly the two ZIPs with their .sha256, which they match, and
# canary-mac.yml, which lists both for this version.
if ! is_canary "$version"; then
  echo "$version isn't a canary build, so it isn't published as a Mac canary." >&2
  exit 1
fi
zips=("your-space-macos-arm64-$version.zip" "your-space-macos-x64-$version.zip")
if ! diff <(printf '%s\n' "${zips[@]}" "${zips[@]/%/.sha256}" canary-mac.yml | sort) <(cd "$dir" && find . -mindepth 1 -maxdepth 1 -printf '%P\n' | sort) ||
  ! (cd "$dir" && sha256sum --check --status -- "${zips[@]/%/.sha256}") ||
  ! grep -Fxq "version: '$version'" "$dir/canary-mac.yml" ||
  ! grep -Fxq "  - url: ${zips[0]}" "$dir/canary-mac.yml" || ! grep -Fxq "  - url: ${zips[1]}" "$dir/canary-mac.yml"; then
  echo "::error::$dir doesn't hold $version's two update ZIPs, matching their .sha256, and the canary-mac.yml that lists them, so nothing is uploaded." >&2
  exit 1
fi

# The canary prerelease, published. The Canary workflow creates it; a draft is what one of its
# attempts left, for that workflow to finish.
found=$(retry gh api --paginate "$api/releases?per_page=100" --jq '.[] | select(.tag_name == "canary") | "\(.draft) \(.id)"')
id=$(sed -n 's/^false \([0-9][0-9]*\)$/\1/p' <<< "$found" | head -n 1)
if [[ -z $id ]]; then
  echo "::error::There is no published canary prerelease, which the Canary workflow creates, so nothing is uploaded. Re-run once a Canary run has published one." >&2
  exit 1
fi

# The prerelease's files, as "ID STATE NAME" lines in $work/listed.
list_files() {
  gh api --paginate "$api/releases/$id/assets?per_page=100" --jq '.[] | "\(.id) \(.state) \(.name)"' > "$work/listed"
}
retry list_files

# No canary release may carry latest-mac.yml (spec 016, the guard), so finding one stops the run
# before it changes anything, for a maintainer to find where it came from.
if awk '{ print $3 }' "$work/listed" | grep -Fxq latest-mac.yml; then
  echo "::error::The canary prerelease holds latest-mac.yml, which no canary release may carry, so nothing is uploaded. Find which workflow uploaded it, delete it, then re-run." >&2
  exit 1
fi

# The builds the prerelease's Mac files name: canary-mac.yml's, and each Mac ZIP's, half uploaded or
# not, since a newer build's run uploads its ZIPs before its canary-mac.yml. None may be newer.
held=()
listed=
while read -r _ state name; do
  if [[ $name =~ ^$own_zip$ ]]; then held+=("${BASH_REMATCH[2]}"); fi
  if [[ $name == canary-mac.yml && $state == uploaded ]]; then listed=true; fi
done < "$work/listed"
if [[ -n $listed ]]; then
  retry gh release download canary --repo "$repo" --pattern canary-mac.yml --output "$work/held-canary-mac.yml" --clobber
  first=
  pattern="^version: '([^']+)'\$"
  IFS= read -r first < "$work/held-canary-mac.yml" || true
  if [[ ! $first =~ $pattern ]] || ! is_canary "${BASH_REMATCH[1]}"; then
    echo "::error::The canary prerelease's canary-mac.yml doesn't list a canary in the form the Mac canary writes it, so nothing is uploaded. Find what wrote it." >&2
    exit 1
  fi
  listed=${BASH_REMATCH[1]}
  held+=("$listed")
fi
for other in "${held[@]}"; do
  newer=$(order "$other" "$version") || exit 1
  if ((newer > 0)); then
    say "The canary prerelease's Mac files already name $other, a newer build, so they stay as they are for $version."
    if [[ $other != "$listed" ]]; then
      echo "::warning::The canary prerelease's canary-mac.yml doesn't list $other yet, so its Mac canary run stopped part way: re-run that run's failed jobs to finish." >&2
    fi
    exit 0
  fi
done
# Another run of this build, signed apart from this one (its digests and date differ), already
# published it: its ZIPs, which canary-mac.yml lists, stay as they are.
if [[ $listed == "$version" ]] && ! cmp -s "$dir/canary-mac.yml" "$work/held-canary-mac.yml"; then
  say "The canary prerelease's canary-mac.yml already lists $version as another run signed it, so its Mac files stay as they are."
  exit 0
fi

# Uploads files of this build from DIR. Any of their names an upload left half there (not
# "uploaded") is deleted first: GitHub refuses the next upload of that name (HTTP 422) until it is.
# A file already gone (HTTP 404) counts as deleted. --clobber replaces one that is there by deleting
# it before it uploads the new one, so an upload that then fails leaves the name missing.
upload() {
  local asset state name paths=()
  list_files || return 1
  while read -r asset state name; do
    if [[ $state != uploaded && " $* " == *" $name "* ]]; then
      gh api --method DELETE "$api/releases/assets/$asset" 2> "$work/deleted" ||
        grep -q 'HTTP 404' "$work/deleted" || { cat "$work/deleted" >&2; return 1; }
    fi
  done < "$work/listed"
  for name; do paths+=("$dir/$name"); done
  gh release upload canary "${paths[@]}" --repo "$repo" --clobber
}
# Each file downloads from the prerelease as it is in DIR.
check() {
  local name
  for name; do
    retry gh release download canary --repo "$repo" --pattern "$name" --output "$work/downloaded" --clobber
    if ! cmp -s "$dir/$name" "$work/downloaded"; then
      echo "::error::The canary prerelease's $name doesn't download as it was uploaded. Re-run the job." >&2
      exit 1
    fi
  done
}

# canary-mac.yml is this build's as this run signed it, so an earlier attempt of this run got past it.
if [[ $listed == "$version" ]]; then
  say "The canary prerelease's canary-mac.yml already lists $version, so its ZIPs are checked and the older ones deleted."
  check "${zips[@]}"
else
  retry upload "${zips[@]}"
  check "${zips[@]}"
  retry upload canary-mac.yml
  check canary-mac.yml
fi

# Last, the Mac ZIPs canary-mac.yml doesn't list: older builds', and any an attempt left half there.
delete_older() {
  local asset state name
  list_files || return 1
  while read -r asset state name; do
    [[ $name =~ ^$own_zip$ && " ${zips[*]} " != *" $name "* ]] || continue
    gh api --method DELETE "$api/releases/assets/$asset" 2> "$work/deleted" ||
      grep -q 'HTTP 404' "$work/deleted" || { cat "$work/deleted" >&2; return 1; }
  done < "$work/listed"
}
retry delete_older

# Of its own files, the prerelease holds exactly this build's, all uploaded.
retry list_files
if ! diff <(printf '%s\n' "${zips[@]}" canary-mac.yml | sort) <(awk '{ print $3 }' "$work/listed" | grep -Ex "canary-mac\.yml|$own_zip" | sort) ||
  awk '$2 != "uploaded" { print $3 }' "$work/listed" | grep -Eqx "canary-mac\.yml|$own_zip"; then
  echo "::error::The canary prerelease's Mac files aren't exactly $version's. Re-run the job." >&2
  exit 1
fi
say "The canary prerelease holds the Mac canary $version."
