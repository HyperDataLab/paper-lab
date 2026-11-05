# Roadmap

Slices are built in order. Each slice is one PR, developed by Codex and accepted by Claude.
Status: ⬜ not started · 🟨 in progress · ✅ accepted.

| #   | Slice                                                                                                                                  | PRD                            | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| S0  | Tooling scaffold: Vite + React 19 + TS strict, ESLint/Prettier, Vitest, CI, Firebase Hosting config, `.env.example`, Vite `/llm` proxy | §9                             | ✅     |
| S1  | App shell: module registry, collapsible sidebar + drawer, routes, breadcrumbs, theme tokens, `shared/ui` primitives, placeholder pages | DESIGN §1, §4                  | ✅     |
| S2  | `core/text`: source hash, sentence segmentation, tokenisation with exact offsets (code point + UTF-16), abbreviation/citation handling | EV-01, AC-01, AC-11            | ✅     |
| S3  | Storage: Dexie DB, repositories, Zod schemas v1 (Analysis, SentenceAnnotation, Issue, AuditEvent), JSON export/import                  | EV-11, EV-12                   | ⬜     |
| S4  | 9router client + consent gate + Settings page (endpoint, key, model, test connection)                                                  | §9 Privacy, ADR-0003           | ⬜     |
| S5  | Evaluate v1: paste paragraph → sentence view with Topic/Action/Stress badges (LLM candidates anchored by code), S–V distance           | EV-02, EV-03, AC-02            | ⬜     |
| S6  | Candidate detectors: S–V gap, clause depth, fuzzy verbs, nominalisations, weak modifiers, wordiness + contextual LLM judgement         | EV-04..06, AC-03, AC-09        | ⬜     |
| S7  | Highlights + inspector + filters + confirm/dismiss + audit log                                                                         | EV-10, EV-11, AC-04..06, AC-12 | ⬜     |
| S8  | Paragraph structure & flow: TS-D/LD/LDR/OCAR, sentence roles, stress→topic links                                                       | EV-07, EV-08                   | ⬜     |
| S9  | Scoring: rubric, weights, coverage, `not_assessable` rule                                                                              | EV-09, §5, AC-10               | ⬜     |
| S10 | Revise: select issues → revised text, aligned diff, meaning checks, re-evaluate                                                        | WR-02..08, AC-07, AC-08        | ⬜     |
| S11 | Generate                                                                                                                               | WR-01                          | ⬜     |
| S12 | Report export (JSON + printable HTML/PDF), version comparison                                                                          | EV-12                          | ⬜     |

## Later modules (sidebar group "Sắp có")

Calibration set & inter-rater agreement (PRD §12 caveat), batch mode for a whole section, link with
paper-understanding (import paragraphs from its export package).

## Open decisions

- Hosting: Firebase Hosting (ADR-0001) or an Oracle Cloud Always Free VM (ADR-0005, proposed). Keep the app
  host-agnostic: relative `/llm` and `/api/nlp` URLs, no Firebase SDK.
- spaCy service: optional `SyntaxProvider` (ADR-0004), built once the Oracle VM exists.
