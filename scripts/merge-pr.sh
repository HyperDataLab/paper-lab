#!/usr/bin/env bash
# Merge a PR now, without waiting for CI. Owner's choice (2026-11-11): the project has almost no users, so the gate
# is the deploy, not the merge. CI still runs on main after the merge; a red main is fixed or reverted in the next
# commit, and scripts/deploy.sh refuses to deploy a commit whose CI is not green.
# Usage: scripts/merge-pr.sh <pr-number>
set -euo pipefail

pr="${1:?usage: scripts/merge-pr.sh <pr-number>}"
gh pr merge "$pr" --squash
echo "PR $pr merged. CI runs on main; deploy only through scripts/deploy.sh."
