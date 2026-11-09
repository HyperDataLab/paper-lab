# Roadmap

Slices are built in order. Each slice is one PR, developed by Codex and accepted by Claude.
Status: ⬜ not started · 🟨 in progress · ✅ accepted.

| #   | Slice                                                                                                                                  | PRD                            | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| S0  | Tooling scaffold: Vite + React 19 + TS strict, ESLint/Prettier, Vitest, CI, Firebase Hosting config, `.env.example`, Vite `/llm` proxy | §9                             | ✅     |
| S1  | App shell: module registry, collapsible sidebar + drawer, routes, breadcrumbs, theme tokens, `shared/ui` primitives, placeholder pages | DESIGN §1, §4                  | ✅     |
| S2  | `core/text`: source hash, sentence segmentation, tokenisation with exact offsets (code point + UTF-16), abbreviation/citation handling | EV-01, AC-01, AC-11            | ✅     |
| S3  | Storage: Dexie DB, repositories, Zod schemas v1 (Analysis, SentenceAnnotation, Issue, AuditEvent), JSON export/import                  | EV-11, EV-12                   | ✅     |
| S4  | 9router client + consent gate + Settings page (endpoint, key, model, test connection)                                                  | §9 Privacy, ADR-0003           | ✅     |
| S5  | Evaluate v1: paste paragraph → sentence view with Topic/Action/Stress badges (LLM candidates anchored by code), S–V distance           | EV-02, EV-03, AC-02            | ✅     |
| S6  | Candidate detectors: S–V gap, clause depth, fuzzy verbs, nominalisations, weak modifiers, wordiness + contextual LLM judgement         | EV-04..06, AC-03, AC-09        | ✅     |
| S7  | Highlights + inspector + filters + confirm/dismiss + audit log                                                                         | EV-10, EV-11, AC-04..06, AC-12 | ✅     |
| S8  | Paragraph structure & flow: TS-D/LD/LDR/OCAR, sentence roles, stress→topic links                                                       | EV-07, EV-08                   | ✅     |
| S9  | Scoring: rubric, weights, coverage, `not_assessable` rule                                                                              | EV-09, §5, AC-10               | ✅     |
| S10 | Revise: select issues → revised text, aligned diff, meaning checks, re-evaluate                                                        | WR-02..08, AC-07, AC-08        | ✅     |
| S11 | Generate                                                                                                                               | WR-01                          | ✅     |
| S12 | Report export (JSON + printable HTML/PDF), version comparison                                                                          | EV-12                          | ✅     |

## Phân tích bài báo — paper-level AI Review (ADR-0006, `docs/plans/AI-REVIEW.md`)

| #    | Slice                                                                                   | Status |
| ---- | --------------------------------------------------------------------------------------- | ------ |
| P1   | Paper import and paper map (PDF / LaTeX / Markdown, IMRaD roles) — beta                 | ✅     |
| P1.1 | PDF layout quality: wrapped headings, two-column order, superscripts, real-PDF fixtures | ✅     |
| P2   | Batch paragraph pipeline with section-aware prompts                                     | ✅     |
| P3   | Paper-level aggregation and inter-paragraph flow                                        | ✅     |
| P4   | Verifiable checks (citations, numbers, figures/tables, acronyms)                        | ✅     |
| P5   | AI reviewer panel (lenses, anchored points, diversity metrics)                          | ✅     |
| P6   | Score robustness probe (style-only rewrite → score sensitivity)                         | ✅     |
| P7   | Calibration and transparency                                                            | ✅     |

## Paper measurement extraction (`docs/PRD_Measurement.md`)

| #   | Slice                                                                 | Status |
| --- | --------------------------------------------------------------------- | ------ |
| M1  | Table and equation blocks in the PDF reader                           | ✅     |
| M2  | Schema, paper classification, per-section extraction, evidence checks | ✅     |
| M3  | Linking, same-name metrics, claims, six warnings, survey mode         | ✅     |
| M4  | `Đo lường` tab, human review, audit, evidence navigation              | ✅     |
| M5  | JSON/Markdown/CSV export, transparency, gold-standard tool            | ✅     |
| M6  | Atomic sentences: short verified statements linked to the profile     | ✅     |

Measurement quality targets (PRD §12) are not measured yet: they need a gold standard of at least 30 papers labelled by two people.

P2 follow-up: share syntax requests across paragraphs in the same section, in batches of at most 40
sentences. Until then, syntax uses one request per selected paragraph and estimates use the same unit.

## Open decisions

- Hosting: Firebase Hosting (ADR-0001) or an Oracle Cloud Always Free VM (ADR-0005, proposed). Keep the app
  host-agnostic: relative `/llm` and `/api/nlp` URLs, no Firebase SDK.
- spaCy service: optional `SyntaxProvider` (ADR-0004), built once the Oracle VM exists.
