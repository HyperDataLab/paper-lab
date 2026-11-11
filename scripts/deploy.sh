#!/usr/bin/env bash
# Deploy PaperLab hosting from main, only when CI passed on that exact commit.
# Merges do not wait for CI, so this is the gate before anything reaches users.
# Run only when the owner says "Deploy now". Usage: scripts/deploy.sh
set -euo pipefail

if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Not on main. Check out main first." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Uncommitted changes in tracked files. Not deploying." >&2
  exit 1
fi
git pull -q --ff-only origin main
sha="$(git rev-parse HEAD)"

state="$(gh run list --branch main --commit "$sha" --workflow CI --limit 1 --json conclusion,status \
  -q '.[0] | if .status == "completed" then .conclusion else .status end')"
if [ "$state" != "success" ]; then
  echo "CI on main ${sha:0:7} is '${state:-missing}', not success. Not deploying." >&2
  exit 1
fi

npm run build
npx firebase deploy --only hosting --project hyperdatalab-paragraph-lab
echo "Deployed ${sha:0:7}."
