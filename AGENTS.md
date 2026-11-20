# AGENTS.md

Shared rules for every coding agent (Codex, Claude) and every human contributor working in this repo.
Claude-specific workflow is in `CLAUDE.md`; UI rules are in `DESIGN.md`; the spec is `docs/PRD.md`.

## What this is

**PaperLab**: a single-page React + TypeScript + Vite app for research papers, extraction projects and corpora.
Paper-level writing and style analysis stays with each paper; standalone paragraph writing is moving to Writing Lab.

Modules (see `docs/ROADMAP.md`):

| Module      | Purpose                                          |
| ----------- | ------------------------------------------------ |
| Papers      | Import, read, inspect and analyse research papers |
| Projects    | Organise paper extraction and research plans      |
| Corpus      | Collect, label, profile and compare paper sets    |
| Settings    | 9router endpoint / key, privacy consent, account  |

The UI is in Vietnamese; analysed text is English. Code, identifiers and commit messages are in English.

## Hard platform constraints

- **Deploy the SPA = Firebase Hosting only** (Spark, no billing). Cloudflare Workers provide the existing PDF,
  NLP and ResearchHub workspace APIs. Do not add Firebase Cloud Functions or Firebase Storage.
- **A ResearchHub project is mandatory for all features.** Without a valid `projectId`, the application gates
  feature routes; with one, PaperLab stores the project workspace in R2 and authorizes access through HyperDataLab
  SSO and ResearchHub's owned-project API (ADR-0007, ADR-0008). Do not add Firestore or another remote database
  without a new ADR.
- **Auth = HyperDataLab SSO** for all features. PaperLab can use OIDC Authorization Code + PKCE or receive the
  existing ResearchHub session through an exact-origin, state-checked `postMessage` handoff. No client secret is
  bundled; tokens stay in `sessionStorage` and never in URLs. Server calls validate the SSO token through
  `/oauth/userinfo` and verify project access.
- **LLM = 9router**, an OpenAI-compatible chat-completions endpoint supplied by the owner (ADR-0003).
  - Dev: `VITE_LLM_BASE_URL=/llm` goes through the Vite proxy, which adds `LLM_PROXY_API_KEY` server-side.
    Real values go in gitignored `.env.development.local`.
  - Production: the browser calls the router (through the CORS Cloudflare Worker) and the user types the key in
    Settings; it is stored in `localStorage` only.
  - **Never bundle, commit or log an API key.** Never send text to the LLM before privacy consent is recorded.
- No new runtime dependency without saying why in the PR. Prefer small, browser-only, tree-shakable libraries.

## Architecture rules

```
src/
  app/                 shell: router, layout, sidebar, module registry, providers
  modules/<module>/    one folder per menu module (evaluate, revise, generate, history, settings)
    index.ts           ModuleDefinition: id, label, icon, route, nav group, lazy page
    pages/ components/ hooks/
  core/                pure domain logic, no React, no browser APIs  <- most tests live here
    text/              segmentation, tokenisation, offsets (code points <-> UTF-16)
    analysis/          metrics, candidate detectors, scoring
    revision/          diff alignment, meaning-preservation checks
    schemas/           Zod schemas = the contract for storage, LLM output and export
  shared/
    llm/               9router client, JSON-schema prompting, repair round, consent gate
    storage/           Dexie DB + repositories (only place that touches IndexedDB)
    ui/                design-system primitives (see DESIGN.md)
```

- **Dependency direction:** `app -> modules -> shared -> core`. `core` imports nothing from React, Dexie, `fetch`
  or `window`. ESLint enforces this with `no-restricted-imports`.
- Feature modules import other feature modules only through their public `index.ts` entry. ESLint reports
  internal cross-module imports; existing exceptions are listed explicitly in `eslint.config.js`.
- **Adding a module** = create `src/modules/<id>/index.ts` exporting a `ModuleDefinition` and register it in
  `src/app/modules.ts`. The sidebar, routes and breadcrumbs are generated from the registry. Do not hand-edit nav.
- **Zod schemas in `core/schemas` are the single source of truth.** Every IndexedDB write, every LLM response and
  every import is parsed through them. Timestamps are ISO strings. Schemas carry a `schemaVersion`.
- **Storage access goes only through `shared/storage` repositories.** Components never call Dexie directly.
- Project workspace synchronization is implemented at the storage boundary. It serializes papers, extraction
  projects, corpora and paper-level analysis; standalone paragraph writing records stay out of the ResearchHub
  workspace. The Worker stores one versioned JSON object per project in R2 and uses ETags to reject stale writes.
- **Prompts are versioned** (`PROMPT_VERSIONS`). Store prompt, model, rubric, tokenizer and rule-set versions plus
  `source_hash` on every analysis (PRD §9 Versioning). Bump the version when a prompt changes.

## Domain invariants (from the PRD; tests enforce them)

1. **Offsets are computed, never LLM-guessed.** The LLM may return quoted text or token indexes; the code anchors
   them against `source_text` and computes `start`/`end` (exclusive end, declared `offset_unit`). A span that cannot
   be anchored is **suppressed and logged**, never rendered (PRD §7, §9 Precision).
2. **The source text is immutable.** No trimming, normalising or whitespace collapsing of the stored original.
   Revisions are separate records; replacing the original requires an explicit user action.
3. **Signals are not violations.** Passive voice, adjectives, adverbs, long sentences and threshold hits are
   _review candidates_. Counts never deduct score directly (PRD §5, MVP #9).
4. **Uncertain measurements return `null` + confidence**, never a fabricated number (subject–verb distance etc.).
5. **Issue status chain:** `candidate -> confirmed_by_model -> confirmed_by_human | dismissed_by_human`.
   `confirmed_by_model` never means scientifically true. Human decisions are written to an audit log.
6. **Scores:** 0–100 per dimension from a 0–4 rubric; overall = weighted mean of applicable dimensions with
   renormalised weights; no overall score when 2+ dimensions are `not_assessable`. Always show coverage,
   confidence, `context_limited` and rubric version.
7. **Revision safety:** never add facts, numbers or references; preserve hedging, negation, modality and claim
   strength; missing evidence becomes `needs_evidence`.
8. Thresholds (e.g. subject–verb gap ≥ 8 / ≥ 15 tokens) live in one config object labelled _heuristic, needs
   calibration_. They are never presented as Schimel's rules.

## Coding standards

- TypeScript `strict`, `noUncheckedIndexedAccess`; no `any` (use `unknown` + Zod). No non-null `!` in `core`.
- React 19 function components and hooks. State: local state first, Zustand for cross-page UI state, no Redux.
- Pure functions for domain logic; side effects at the edges (`shared/*`). No hidden globals.
- Names: `camelCase` functions/vars, `PascalCase` components/types, `kebab-case` folders, `SCREAMING_SNAKE` consts.
- Files ≤ ~300 lines; split when larger. One React component per file.
- Errors: typed error classes in `shared/*`; UI shows a Vietnamese message plus a technical detail toggle.
- Comments explain _why_, not _what_. No commented-out code.
- Formatting: Prettier (repo config). Lint: ESLint flat config. Both must pass with zero warnings in CI.
- **Encoding: UTF-8 without BOM, LF line endings.** The UI is Vietnamese, so diacritics must survive. On Windows,
  never write source files with PowerShell `Set-Content` / `Out-File` / `>` (they use the ANSI code page and turn
  `Đánh giá` into `??nh gi?`). Use the editor/patch tool. A test guards module labels against `?` corruption.

## Testing

- Vitest + Testing Library (jsdom). Test files sit next to code: `foo.ts` -> `foo.test.ts`.
- `core/` targets ≥ 90 % line coverage; every PRD acceptance item gets a test whose name carries its ID:
  `EV-01`, `WR-06`, `AC-11` (MVP acceptance criteria §10 numbered `AC-01..AC-12`).
- Offset tests must cover Unicode (emoji, combining marks, CJK), multiple spaces, citations `(Smith et al., 2010)`,
  abbreviations (`e.g.`, `Fig. 2`, `et al.`), decimals and punctuation (AC-11).
- LLM is mocked in unit tests with recorded fixtures under `src/test/fixtures/llm/`. Never call the network in tests.
- No browser (Playwright) tests: the owner dropped them on 2026-11-11 because installs and reruns slowed CI. UI
  behaviour is covered by Vitest + Testing Library in jsdom, and checked by hand in the browser when it matters.

## Commands

```bash
npm run dev          # Vite dev server, port 5173 (proxy /llm -> 9router)
npm run typecheck    # tsc -b
npm run lint         # eslint . --max-warnings 0
npm run format       # prettier --write .
npm test             # vitest run
npm run test:cov     # vitest run --coverage
npm run build        # tsc -b && vite build
npm run check:router-cors -- <baseUrl> [origin]
firebase deploy --only hosting
```

Definition of done for any change: `typecheck`, `lint`, `test`, `build` all green **in CI**; new behaviour has
tests; docs (`docs/ROADMAP.md`, ADRs, this file) updated when behaviour or rules change. Locally, run the cheap
checks and the tests you touched; the full suite runs in CI (about 6 minutes).

Flaky tests are defects. A test that fails without a related change is fixed at its cause (usually a wait for an
element that appears after an async write), never by a retry. A longer wait is right only when a measured run shows
the work is slow, not stuck; the test then says so in a comment.

## Git

- Trunk-based: short branches off `main` named `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Conventional Commits (`feat(evaluate): …`). One logical change per commit. PRs use the template.
- Merge with `scripts/merge-pr.sh <pr>` without waiting for CI. CI runs on `main` after the merge; a red `main` is
  fixed or reverted in the next commit. Deploy only with `scripts/deploy.sh`, which requires green CI on the
  deployed `main` commit.
- Never commit `.env*.local`, keys, or the Schimel book PDF (copyrighted; reference chapters/sections only).
