# AGENTS.md

Shared rules for every coding agent (Codex, Claude) and every human contributor working in this repo.
Claude-specific workflow is in `CLAUDE.md`; UI rules are in `DESIGN.md`; the spec is `docs/PRD.md`.

## What this is

**Paragraph Lab**: a single-page React + TypeScript + Vite app that evaluates and revises **one English scientific
paragraph** at the paragraph and sentence level, following Joshua Schimel, *Writing Science* (2012), Ch. 11–16.

Modules (see `docs/ROADMAP.md`):

| Module | Purpose | PRD |
|---|---|---|
| Evaluate | Segment, annotate (Topic / Action / Stress), measure, score, highlight issues | §3, §4, §5, §6 |
| Revise | Rewrite selected issues, diff, meaning-preservation checks, re-evaluate | §2 (WR-02..08) |
| Generate | Draft a paragraph from claim + supplied evidence | §2 (WR-01) |
| History | Local analyses, versions, comparisons, export / import | EV-11, EV-12 |
| Settings | 9router endpoint / key / model, privacy consent | §9 |

The UI is in Vietnamese; analysed text is English. Code, identifiers and commit messages are in English.

## Hard platform constraints

- **Deploy = Firebase Hosting only** (Spark, no billing). No Cloud Functions, no Storage, no server routes.
- **Database use is minimised: local-first.** All user data lives in the browser (IndexedDB via Dexie) and moves
  between machines through JSON export / import. There is no Auth and no Firestore in the MVP (ADR-0002).
  Do not add a remote database without a new ADR approved by the product owner.
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
- **Adding a module** = create `src/modules/<id>/index.ts` exporting a `ModuleDefinition` and register it in
  `src/app/modules.ts`. The sidebar, routes and breadcrumbs are generated from the registry. Do not hand-edit nav.
- **Zod schemas in `core/schemas` are the single source of truth.** Every IndexedDB write, every LLM response and
  every import is parsed through them. Timestamps are ISO strings. Schemas carry a `schemaVersion`.
- **Storage access goes only through `shared/storage` repositories.** Components never call Dexie directly.
- **Prompts are versioned** (`PROMPT_VERSIONS`). Store prompt, model, rubric, tokenizer and rule-set versions plus
  `source_hash` on every analysis (PRD §9 Versioning). Bump the version when a prompt changes.

## Domain invariants (from the PRD; tests enforce them)

1. **Offsets are computed, never LLM-guessed.** The LLM may return quoted text or token indexes; the code anchors
   them against `source_text` and computes `start`/`end` (exclusive end, declared `offset_unit`). A span that cannot
   be anchored is **suppressed and logged**, never rendered (PRD §7, §9 Precision).
2. **The source text is immutable.** No trimming, normalising or whitespace collapsing of the stored original.
   Revisions are separate records; replacing the original requires an explicit user action.
3. **Signals are not violations.** Passive voice, adjectives, adverbs, long sentences and threshold hits are
   *review candidates*. Counts never deduct score directly (PRD §5, MVP #9).
4. **Uncertain measurements return `null` + confidence**, never a fabricated number (subject–verb distance etc.).
5. **Issue status chain:** `candidate -> confirmed_by_model -> confirmed_by_human | dismissed_by_human`.
   `confirmed_by_model` never means scientifically true. Human decisions are written to an audit log.
6. **Scores:** 0–100 per dimension from a 0–4 rubric; overall = weighted mean of applicable dimensions with
   renormalised weights; no overall score when 2+ dimensions are `not_assessable`. Always show coverage,
   confidence, `context_limited` and rubric version.
7. **Revision safety:** never add facts, numbers or references; preserve hedging, negation, modality and claim
   strength; missing evidence becomes `needs_evidence`.
8. Thresholds (e.g. subject–verb gap ≥ 8 / ≥ 15 tokens) live in one config object labelled *heuristic, needs
   calibration*. They are never presented as Schimel's rules.

## Coding standards

- TypeScript `strict`, `noUncheckedIndexedAccess`; no `any` (use `unknown` + Zod). No non-null `!` in `core`.
- React 19 function components and hooks. State: local state first, Zustand for cross-page UI state, no Redux.
- Pure functions for domain logic; side effects at the edges (`shared/*`). No hidden globals.
- Names: `camelCase` functions/vars, `PascalCase` components/types, `kebab-case` folders, `SCREAMING_SNAKE` consts.
- Files ≤ ~300 lines; split when larger. One React component per file.
- Errors: typed error classes in `shared/*`; UI shows a Vietnamese message plus a technical detail toggle.
- Comments explain *why*, not *what*. No commented-out code.
- Formatting: Prettier (repo config). Lint: ESLint flat config. Both must pass with zero warnings in CI.

## Testing

- Vitest + Testing Library (jsdom). Test files sit next to code: `foo.ts` -> `foo.test.ts`.
- `core/` targets ≥ 90 % line coverage; every PRD acceptance item gets a test whose name carries its ID:
  `EV-01`, `WR-06`, `AC-11` (MVP acceptance criteria §10 numbered `AC-01..AC-12`).
- Offset tests must cover Unicode (emoji, combining marks, CJK), multiple spaces, citations `(Smith et al., 2010)`,
  abbreviations (`e.g.`, `Fig. 2`, `et al.`), decimals and punctuation (AC-11).
- LLM is mocked in unit tests with recorded fixtures under `src/test/fixtures/llm/`. Never call the network in tests.
- E2E (Playwright, later) runs against `vite preview` with a mocked 9router.

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

Definition of done for any change: `typecheck`, `lint`, `test`, `build` all green; new behaviour has tests;
docs (`docs/ROADMAP.md`, ADRs, this file) updated when behaviour or rules change.

## Git

- Trunk-based: short branches off `main` named `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Conventional Commits (`feat(evaluate): …`). One logical change per commit. PRs use the template.
- Never commit `.env*.local`, keys, or the Schimel book PDF (copyrighted; reference chapters/sections only).
