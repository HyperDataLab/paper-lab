# Making AI development reliable: audit and plan

Status: **audit done; slices proposed**. Date: 2026-11-11.

The owner's direction: reliability does not come from better prompts but from architecture, tests and CI that let
an agent find, fix and verify its own mistakes. Order of priority: **codebase architecture → static analysis and
CI → agent instructions → human review**. This document audits PaperLab in that order, with evidence from recent
work, and lists the slices.

## 1. Codebase architecture

What already works:

- Layer rules enforced by ESLint: `core/` imports no React, Dexie, `shared/`, `modules/` or `app/`; `shared/`
  imports no `modules/` or `app/` (`eslint.config.js`).
- Raw HTML controls are banned in `app/` and `modules/` (use `shared/ui`); a test forbids raw colours and sizes in
  CSS modules (`designTokens.test`).
- Every model output and stored record is parsed through Zod; contracts with other systems are generated from code
  and checked by drift tests (`schemas/paper-model-v1.schema.json`).
- Pure logic in `core/` has a 90 % line-coverage threshold.

Gaps:

| Gap                             | Evidence                                                                         | Why it matters to an agent                                                               |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| No rule between feature modules | nothing stops `modules/a` importing `modules/b`                                  | changes leak across features; an agent cannot tell what a change can break               |
| Very large files                | `PaperMapPage.tsx` 1,478 lines, `repositories.ts` 1,061, `evaluate/Page.tsx` 738 | an agent reads and edits these whole; most UI bugs this month were in `PaperMapPage.tsx` |
| UI logic mixed into components  | tab, space and back-chip logic live in `PaperMapPage.tsx`                        | it can only be tested by rendering the whole page                                        |

## 2. Static analysis and CI

What already works: one CI job runs typecheck, lint, format, tests with coverage, build, and the worker's
typecheck and tests on every PR and on `main`.

Gaps:

| Gap                               | Evidence                                                                                                                                                                                                                 | Fix                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No merge gate**                 | PR #90 was merged while its check was red: the merge command piped `gh pr checks` into `tail`, which hid the failure. Branch protection is not available on this private repo's plan                                     | `scripts/merge-when-green.sh` (PR #91); later replaced by merging at once and gating the deploy instead (`scripts/merge-pr.sh`, `scripts/deploy.sh`)                |
| **Flaky UI tests**                | `overview-ui.test.tsx` "P3 shows distributions…" failed on CI for a docs-only PR and passed on the re-run on `main`; `paper-ui.test.tsx` "P2 estimates selected calls…" failed once in a local full run and passed alone | find the race in each (both click, then wait for a button that appears after an async write); a red build that is not about the change teaches agents to ignore red |
| One serial job, about 6–7 minutes | `ci.yml`                                                                                                                                                                                                                 | split into a fast job (typecheck, lint, format: about 1 minute) and the test job, so an agent gets the cheap errors first                                           |
| No browser test in CI             | UI checks rely on the desktop browser pane, which often does not paint (scroll and rAF events do not fire)                                                                                                               | none: the owner dropped browser tests (2026-11-11); jsdom tests and hand checks instead                                                                             |
| Deploy does not check CI          | deploys run from a local build                                                                                                                                                                                           | the deploy step refuses unless the `main` commit being deployed has a green CI run                                                                                  |
| No dead-code or cycle check       | none                                                                                                                                                                                                                     | `knip` (unused files and exports) and an import-cycle rule                                                                                                          |

## 3. Agent instructions

`CLAUDE.md` still says Codex develops, Claude writes no feature code and runs the test suite locally. The owner has
since decided:

- Codex gets implementation first, in a worktree; when Codex fails or is out of credits, an Opus agent does it.
- The full test suite is not run locally: push and let CI test (2026-11-11).
- Merge only through the merge gate; deploy only on the owner's "Deploy now".

This PR updates `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` and the PR template to match.

## 4. Human review

What must reach the owner: product decisions (listed at the end of each plan), anything "not verified" (the PR
template section), and every deploy ("Deploy now"). Nothing enforces review before a merge today: merges are
autonomous when CI is green, so CI must be trustworthy before anything else. Briefs and PR bodies keep a short
"Not verified" list so the owner can see where human checking is still needed.

## 5. Slices

Recommended order: make CI trustworthy and the instructions true **before** splitting large files, because a
refactor of a 1,478-line page with flaky tests and no merge gate cannot be verified.

| #   | Slice                                                                                   | Who                                        | Done when                                                          |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Q1  | Merge gate script, instructions updated, this audit                                     | Claude (docs and tooling)                  | this PR                                                            |
| Q2  | Fix the two flaky UI tests at the cause                                                 | Codex, Opus fallback                       | each passes 20 full-suite runs in CI-like load (`--maxWorkers=2`)  |
| Q3  | CI split into fast and test jobs; deploy refuses without green `main`                   | Claude (`.github`) + Codex (deploy script) | a lint error fails in about a minute                               |
| Q4  | Dropped (owner, 2026-11-11): no Playwright; jsdom tests plus hand checks in the browser | —                                          | —                                                                  |
| Q5  | ESLint rule between feature modules; `knip`; cycle check                                | Codex                                      | violations listed, then fixed or allowed explicitly                |
| Q6  | Split `PaperMapPage.tsx`: tab and space state into a tested hook, blocks into files     | Codex, after Q2–Q3                         | page under 500 lines; behaviour unchanged by the existing UI tests |
| Q7  | Split `repositories.ts` by store                                                        | Codex                                      | same                                                               |
