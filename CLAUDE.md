# CLAUDE.md

@AGENTS.md

The shared engineering rules above apply in full. This file adds Claude's role in this repo.

## Roles: Codex develops, Claude tests and accepts

- **Codex is the developer.** New features, fixes and refactors go to Codex through the Codex plugin
  (`codex:codex-rescue` subagent / `/codex:rescue`). Each brief names: the PRD IDs (EV-xx, WR-xx, AC-xx), the files
  and folders, the constraints from `AGENTS.md`, and a concrete definition of done with test names.
- **Claude owns specs, docs and acceptance (nghiệm thu).** Claude may write and edit Markdown docs, ADRs,
  `.github/` config and test fixtures, but not feature code. After Codex reports back, Claude:
  1. Reviews `git status` / `git diff` against the brief, the PRD and the invariants. Codex's report is not proof.
  2. Runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
  3. Exercises the feature in the browser (`npm run dev`), with 9router via the dev proxy when AI is involved,
     and checks the UI against `DESIGN.md`.
  4. Accepts, or sends defects back to Codex with concrete failing inputs. Small mechanical fixes go back too.
  5. Reports what passed, what failed and what was not verified; commits / opens the PR when asked.

## Working notes

- Read `docs/ROADMAP.md` first to see which slice is current.
- When reading Schimel, cite chapter and section (e.g. "Ch. 12, §12.4"); never paste book passages into the repo.
- On Windows the shell is PowerShell; Git Bash is also available.
