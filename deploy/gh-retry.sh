# shellcheck shell=bash
# Sourced by scripts that change GitHub releases, such as deploy/alpha-feed.sh:
#   . deploy/gh-retry.sh
#   id=$(retry gh api "repos/$repo/releases/$id" --jq .id)
#
# GitHub's API fails now and then for a moment, as an HTTP 500 did when the first canary's release
# was created. retry runs a command again while GitHub answers with a server error or can't be
# reached: five attempts, 10 to 80 seconds apart. A refusal (HTTP 4xx) fails at once, except one
# because a name is already taken: a call that failed may still have made its release or file, and
# the next attempt looks first. Only the attempt that worked writes to stdout. Every command it runs
# must be safe to run twice, so a function it runs looks at what is there before it changes
# anything, and returns 1 itself on a failure: errexit doesn't apply inside it.
#
# The Canary workflow keeps its own copy of this function inline (.github/workflows/canary.yml,
# PR #128); the two behave the same.
retry() {
  local attempt out err
  out=$(mktemp) && err=$(mktemp) || return 1
  for attempt in 1 2 3 4 5; do
    if "$@" > "$out" 2> "$err"; then
      cat "$err" >&2
      cat "$out"
      rm -f "$out" "$err"
      return 0
    fi
    cat "$out" "$err" >&2
    if ((attempt == 5)) ||
      { grep -Eq 'HTTP 4[0-9]{2}' "$err" && ! grep -Eq 'already.exists' "$out" "$err"; }; then
      rm -f "$out" "$err"
      return 1
    fi
    echo "::warning::Attempt $attempt of 5 failed ($(tail -n 1 "$err")); trying again in $((10 << (attempt - 1))) seconds." >&2
    sleep $((10 << (attempt - 1)))
  done
}
