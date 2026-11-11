# Contributing

1. Pick the current slice in `docs/ROADMAP.md`. Branch from `main`: `feat/<slice>-<short-name>`.
2. Follow `AGENTS.md` (architecture, invariants, coding standards) and `DESIGN.md` (UI).
3. Write tests first for `core/` logic; name them with PRD IDs (`EV-01 …`, `AC-11 …`).
4. Before pushing: `npm run typecheck && npm run lint && npm run format:check` and the tests you touched. CI runs
   the full suite.
5. Commit with Conventional Commits: `feat(evaluate): …`, `fix(core): …`, `docs: …`, `chore(ci): …`.
6. Open a PR with the template. CI must be green. Acceptance (nghiệm thu) by Claude/owner before merge.
7. Squash-merge with `scripts/merge-when-green.sh <pr>`. Update the slice status in `docs/ROADMAP.md` in the same
   PR.

Secrets: never commit `.env*.local` or API keys. Copyright: do not add passages or the PDF of Schimel's book;
cite chapter/section only.
