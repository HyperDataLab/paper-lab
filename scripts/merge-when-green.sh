#!/usr/bin/env bash
# Merge a PR only when every CI check has passed.
# Branch protection is not available for this private repository on the current GitHub plan, so this script is the
# merge gate. Usage: scripts/merge-when-green.sh <pr-number>
# Never pipe `gh pr checks` into another command before merging: the pipe hides its exit code
# (PR #90 was merged on a red check that way).
set -euo pipefail

pr="${1:?usage: scripts/merge-when-green.sh <pr-number>}"

if ! gh pr checks "$pr" --watch --interval 30; then
  echo "PR $pr: checks failed or were cancelled. Not merging." >&2
  exit 1
fi

# Re-read after the watch: a new push during the wait starts new checks.
if ! gh pr checks "$pr" >/dev/null; then
  echo "PR $pr: checks are not all green after the wait. Not merging." >&2
  exit 1
fi

gh pr merge "$pr" --squash
echo "PR $pr merged."
