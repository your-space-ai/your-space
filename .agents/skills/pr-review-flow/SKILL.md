---
name: "pr-review-flow"
description: "Take a pull request from draft to ready: open it as a draft, fix and resolve every CodeRabbit finding there, mark it ready, and after that fix only browser test failures. Use when opening, updating or marking ready a pull request in this repository."
---

## Why

A ready pull request runs CircleCI's browser tests, which take 30 to 45 minutes, on every push that
changes product code. A draft runs only the GitHub Actions checks, and CodeRabbit reviews drafts.
So all review and implementation work happens while the pull request is a draft, and a ready pull
request is pushed to only to fix a browser test failure.

A push that changes only CI configuration or documentation (`.github/`, `.circleci/`, `*.md`,
`docs/`, `specs/`, `.specify/`) since the branch last passed the browser tests doesn't run them
again, but it still restarts the other checks. Don't rely on it to fix a ready pull request.

## Steps

1. **Open it as a draft.** `gh pr create --draft`, with the description written from
   `.github/pull_request_template.md`. A stacked pull request is based on the one below it.

2. **Finish it as a draft.** The code and its implementation are complete, the local checks pass
   (see `AGENTS.md`), and the description is current.

3. **Fix CodeRabbit's findings in rounds.** CodeRabbit reviews each push to the draft. Wait for its
   review of the latest commit, then fix or answer every finding of that round in one commit and
   push once. Don't push after each fix. For a stack, push the whole stack once per round. If
   CodeRabbit doesn't review a pushed commit, comment `@coderabbitai review` on the pull request.

4. **Resolve every thread.** Each finding is fixed, or answered with a reply that says why it
   isn't changed. Then resolve its thread. `gh` has no command for this, so use the GraphQL API:

   ```sh
   # Unresolved threads, with their first comment.
   gh api graphql -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{author{login} path body}}}}}}}' \
     -F owner=your-space-ai -F repo=your-space -F pr=<number> \
     --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)'
   # Resolve one.
   gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -F id=<thread id>
   ```

5. **Mark it ready** once CodeRabbit has reviewed the latest commit with no new findings and no
   thread is unresolved: `gh pr ready <number>`. This starts the browser tests.

6. **On a ready pull request, fix only browser test failures.** Push the fix and wait for the
   tests to pass (`gh pr checks <number>`). Nothing else is changed while it is ready.

7. **Anything else goes back to draft.** A new review finding, a design change or more
   implementation: `gh pr ready <number> --undo`, make the change, go through steps 3 to 5 again,
   and mark it ready again.

A maintainer merges. Don't merge a pull request yourself.
