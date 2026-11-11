# CLAUDE.md

@AGENTS.md

The shared engineering rules above apply in full. This file adds Claude's role in this repo.

## Roles (owner's decisions, 2026-11-11)

- **Codex first.** Implementation goes to Codex (`codex:codex-rescue` / the Codex companion) in its own worktree, with
  a brief naming the PRD IDs, files, constraints from `AGENTS.md` and a definition of done with test names. When
  Codex fails, stalls or is out of credits, a Claude Opus agent does the work from the same brief.
- **Claude owns specs, docs, `.github/` and tooling, and acceptance (nghiệm thu).** After the developer reports:
  1. Review `git status` / `git diff` against the brief, the PRD and the invariants. A report is not proof.
  2. Run only cheap checks locally (`tsc -b`, `eslint`, `prettier --check`, the test files the change touched).
     **Do not run the full test suite locally: push and let CI test.**
  3. Exercise UI changes in the browser and check them against `DESIGN.md`.
  4. Open the PR with a "Not verified" list, and merge only with `scripts/merge-when-green.sh <pr>`. Never pipe
     `gh pr checks` into another command before a merge.
  5. Report what passed, what failed and what was not verified.
- **Deploy** only when the owner says "Deploy now", from a `main` commit whose CI run is green.
- A red CI run that is not caused by the change (a flaky test) is still a defect: record it and fix it in its own PR;
  do not merge over it.

## Working notes

- Read `docs/ROADMAP.md` first to see which slice is current.
- When reading Schimel, cite chapter and section (e.g. "Ch. 12, §12.4"); never paste book passages into the repo.
- On Windows the shell is PowerShell; Git Bash is also available.
