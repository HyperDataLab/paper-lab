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

Check reanalysis carries human decisions to uniquely matching anchored findings; unmatched decisions remain
visible in the findings view and in local exports.

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

The P2 batch runs up to five paragraph or transition requests concurrently, with a shared budget and 429 cooldown.

## Paper library (adapted from SLR Paper Fetcher)

| #   | Slice                                                                   | Status |
| --- | ----------------------------------------------------------------------- | ------ |
| F1  | DOI library: paste or CSV, metadata, status table, RIS export           | ✅     |
| F2  | Open full text: find open copies, arXiv download, attach a PDF to a row | ✅     |
| F3  | OpenAlex classification and filters                                     | ✅     |
| F4  | Hyland stance and engagement                                            | ✅     |

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

## Five dimensions of a paper

Hồ sơ organises the paper page by question: Khoa học, Lập luận, Diễn ngôn, Viết học thuật, Bối cảnh. Indicators are in `core/paperProfile`.

| #   | Slice                                                                                   | Status |
| --- | --------------------------------------------------------------------------------------- | ------ |
| D0  | Hồ sơ from existing data, tabs by dimension, evidence drawer                            | ✅     |
| D1  | Bối cảnh: reference age and retraction status from metadata                             | ✅     |
| D2  | Viết học thuật: vocabulary, repeated phrases, comparison baseline                       | ✅     |
| D3  | Khoa học: validity threats, data and code; Diễn ngôn: moves, Abstract match             | ✅     |
| D4  | Lập luận: Toulmin and AIF, built natively in PaperLab                                   | ✅     |
| D5  | Measure indicator quality against human labels                                          | ⬜     |
| SM  | Snapshot (7 attributes with verified quotes) and Metadata (OpenAlex or the DOI library) | ✅     |

## Paper Extraction (`docs/PRD_Extraction.md`)

A separate menu: one matrix per project, rows are papers, columns are fields, every cell carries evidence.

| #   | Slice                                                                                        | Status |
| --- | -------------------------------------------------------------------------------------------- | ------ |
| X1  | Projects, 50 suggested and custom columns, Standard mode, evidence drawer, review, export    | ✅     |
| X2  | High Quality: verification pass per cell, conflicts, selective rerun                         | ✅     |
| X3  | Deep Research: search plan, OpenAlex discovery, screening, cross-paper synthesis             | ✅     |
| X4  | Citation grounding: each synthesis citation shows the verified passage, links into the paper | ✅     |

## Journal corpus setup

The journal form searches Writing Bank's live journal registry and reads article types from the release snapshot.
Protocol versions record the stable registry ID, its writing profile when available and the release of any selected
article types. Manual entry and the built-in ESWA values remain available when Writing Bank cannot be reached.

## Corpus topics

The corpus topics service runs BERTopic and KeyBERT in a separate Cloudflare container, with snapshots
stored in the shared R2 bucket and cached locally. Deployment is controlled through the
`deploy/topics-worker` branch; see `topics-worker/README.md`.

The `corpus-topics-v1` contract accepts optional nullable member fit and weak-reason fields for older
snapshots. Weakness follows centroid fit or an unassigned topic, independently of HDBSCAN probability.
AI topic names are candidates until accepted, individually or in bulk.

## Paper OpenKG

| #   | Slice                                                          | Status               |
| --- | -------------------------------------------------------------- | -------------------- |
| K1  | Five-layer paper graph and Turtle, JSON-LD, and report exports | ✅                   |
| K2  | Interactive graph in paper analysis                            | ✅                   |
| K3  | Corpus knowledge graph, keyword trends, and full exports       | ✅                   |
| K4  | SciAtlas grounding                                             | Owner token required |

See the [paper OpenKG contract](contracts/openkg-paper.md) and [branch plan](plans/OPENKG_PAPER_BRANCH.md).

## Open decisions

- Hosting: Firebase Hosting (ADR-0001) or an Oracle Cloud Always Free VM (ADR-0005, proposed). Keep the app
  host-agnostic: relative `/llm` and `/api/nlp` URLs, no Firebase SDK.
- spaCy service: optional `SyntaxProvider` (ADR-0004). Built in P6 (2026-11-18) as a container of the topics worker
  (`POST /nlp/parse`), not on the Oracle VM; not deployed yet. The browser uses it only when `VITE_NLP_URL` is set.
  It feeds passive voice and tense per section (`section.<ROLE>.passive`, `section.<ROLE>.tense.*`, wired by P2).
