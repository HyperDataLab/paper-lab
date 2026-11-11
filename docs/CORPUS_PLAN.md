# Corpus: plan

Status: **decided after critique**. Date: 2026-11-11. No code yet: this document lists the work to do next.

How it was made: Claude read the code of both systems and drafted the plan; three agents attacked the draft
(sampling and corpus method for the signature, systematic-review workflow, architecture against the code); Claude
checked every claim against the files and decided each point (section 9).

The owner asked for corpora of two kinds, both built from `paper-model.json` (`docs/PAPER_MODEL.md`, schema
`schemas/paper-model-v1.schema.json`):

- **Journal corpus**: papers from one journal, measured against a control corpus to find that journal's signature,
  which goes to the Writing Bank as a Journal Signature v2.1 profile.
- **Topic corpus**: papers on one research topic, searched, screened and extracted for a literature review.

## 1. What exists and what it implies

| Exists                                                                                                                                                                                                                                                                                                                                                                                          | Where                                    | What it means for Corpus                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Paper model v1, frozen; every object has `additionalProperties: false`; no paper id; `doi` and `source.sha256` nullable; `generatedAt` inside                                                                                                                                                                                                                                                   | R17a                                     | A corpus is an envelope around unchanged v1 models, with its own member id. Model files cannot be hashed as they are |
| Paper models are built on demand from Paper + metadata + insights + stance (`PaperMetadata.tsx`), never stored                                                                                                                                                                                                                                                                                  | R17a                                     | Store the inputs' versions, not the models                                                                           |
| Library: DOI rows (`&doi`), OpenAlex metadata and taxonomy, open copies, attached PDF                                                                                                                                                                                                                                                                                                           | `core/library`                           | Intake by DOI                                                                                                        |
| R2 holds **PDFs only**, at `paperlab/pdfs/<sha256>`, 25 MB cap; no paper text, no models                                                                                                                                                                                                                                                                                                        | `worker/src/app.ts`                      | Sharing corpora in the lab needs a new route (or files); PDFs of 300 papers are 0.6–1.5 GB in IndexedDB              |
| Extraction project: `papers` (already included, keyed `paper:` / `library:` / `search:`), cells keyed by `paperKey` + `paperRevision`, 50 columns                                                                                                                                                                                                                                               | `core/extraction`                        | Cells depend on the project's paper keys: no destructive migration                                                   |
| Deep research holds the search plan (criteria, years, approval), rounds (`foundBy`, query), candidates with screening, dedup by DOI then title + year (`mergeCandidates`)                                                                                                                                                                                                                       | `core/extraction/deep.ts`                | Screening and search provenance already exist; the corpus promotes and extends them                                  |
| `decideCandidate` stores the AI suggestion's reason when no human reason is given                                                                                                                                                                                                                                                                                                               | `deep.ts`                                | AI reasons look like human ones: fix                                                                                 |
| Batch runner works on the paragraphs of one paper, driven from a React hook; rhetoric and stance are separate per-paper runs                                                                                                                                                                                                                                                                    | `core/batch`, `storage/paperInsights.ts` | A corpus needs its own queue that calls the per-paper runners; it runs only while a tab is open                      |
| Journal Signature v2.1: `scope`, `coverage`, `provenance`, `empirical_fingerprint`, `Comparison` (`matched_control_corpus_id`, effect size, CI, p, `bootstrap_unit`, `confound_checks`, `holdout_verified`, `interpretation_status`), `EvidencePointer.paper_id` pattern without `/`, `feature_registry_binding` with a digest; current profiles have an all-zero digest and empty fingerprints | bank schema and `data/banks/journals`    | The plan is built backwards from these fields (section 5)                                                            |

## 2. The model

```
Corpus (paperlab-corpus, schemaVersion 1)
├─ id, kind: journal | topic | control, title, createdAt, updatedAt
├─ protocol (versioned; every change makes a new version)
│    journal/control: venue(s) (name, ISSN, OpenAlex source id), years, article types, version of record only,
│                     sampling rule, seed, strata, caps per issue, exclusions (editorials, errata, retracted)
│    topic:           research question, inclusion / exclusion criteria, searches (below), years
├─ searches[]       source, exact request URL and parameters, run at, total reported, retrieved, duplicates,
│                   added, truncated?, update round; or an imported RIS/CSV export from Scopus / WoS / PubMed
├─ members[]
│    memberId       opaque uuid, never changes
│    identifiers    doi?, openalexId?, sha256[], paperIds[], libraryIds[]   (grows; a merge writes an alias record)
│    exportId       slug of memberId, matches the bank's EvidencePointer.paper_id pattern
│    role           journal: target | held_out    (control papers live in their own corpus)
│    stratum        year, article type, issue, special issue flag
│    version        publishedVersion | acceptedVersion | submittedVersion (as OpenAlex reports it)
│    retrieval      sought | retrieved | not_retrieved
│    textRead       FULL_TEXT | ABSTRACT_ONLY | METADATA_ONLY   (what was read; Library's `access` is what exists)
│    authorsIds     OpenAlex author ids and institution countries
│    decisions[]    topic: append-only log of stage (title-abstract | full-text), decision, reason code + text,
│                   decider (person or "ai-suggestion"), at
│    appraisal[]    topic: tool (RoB 2, ROBINS-I, CASP, MMAT), domain judgements with quotes, appraiser
│    inputs         Paper textHash list, metadata digest, insight and stance run ids, segmenter and key versions
├─ runs[]           corpus-wide labelling runs: scheme, model, prompt version, members done / failed / skipped
└─ releases[]       frozen snapshots: canonical digest (JCS, sorted keys, no timestamps) of protocol version,
                    members with roles and strata, inputs, run ids and registry version; the digest is
                    `corpus_manifest_id`
```

Rules:

- **Members are found by any identifier.** Adding a paper whose DOI, OpenAlex id, file hash or paper id matches an
  existing member adds the identifier to that member; a match on title and year only is shown to a person to confirm.
  A preprint and its published version are one member with two files; `version` says which file is measured.
- **Models are rebuilt, not stored.** A member is stale when its current inputs differ from those recorded in the
  last release.
- **One prompt version per run across the corpus.** Members labelled by another version count as not covered.
- **Members without full text stay** for screening and metadata, are left out of text measurements and are counted
  separately in every report and synthesis.
- **Labels keep their state.** Exports say how many labels are `machine`.
- **The corpus file holds no paper text.** Evidence excerpts in a signature follow decision 6 (section 8).

## 3. Topic corpus and Extraction

The corpus takes over the search and screening record; an Extraction project keeps its matrix.

- New topic corpora hold the search plan, searches, candidates and screening decisions (the deep research data,
  promoted, reusing `mergeCandidates` and the plan approval gate).
- An Extraction project gets an optional `corpusId`. Included members are copied **one way** into `project.papers`,
  which stays authoritative for cells, runs and exports. No Dexie migration of existing data, no package version bump
  for projects without a corpus.
- An existing project can be "promoted": a new corpus is made from its deep research data and linked. Nothing is
  moved or deleted.
- Screening: two stages, an append-only decision log, a fixed list of exclusion reasons plus free text. An AI
  suggestion is stored as a suggestion and never becomes a decision until a person accepts it (fixes `decideCandidate`).
- Dual screening (blind mode, conflicts, adjudication, kappa per stage) is possible only if corpora are shared
  (decision 3). In a single browser it is out of scope and the export says one screener.
- PRISMA 2020 counts come from searches and the decision log: identified per source, duplicates, screened, excluded
  at each stage with reasons, sought, not retrieved, included; citation searching as "other methods".
- Snowballing: seeds chosen by the user; backward via OpenAlex `referenced_works` (parsed references after R17d),
  forward via `cites:`; each iteration recorded until no new inclusions.
- Living review: "update search" re-runs stored searches from the last run date; new records carry the update round.
- Exports: RIS and CSV of included members, PRISMA counts, the screening log and the search log; capped searches are
  marked "not exhaustive".

## 4. Journal corpus: method

- **Control corpus.** A separate corpus (`kind: control`) with its own release id, matched to the target on OpenAlex
  topics, years and article type, drawn from at least three comparable journals. Results are also reported leaving
  each control journal out.
- **Size.** Default minimums: 150 target and 150 control full-text papers of record, at least 20 per stratum cell,
  20% held out, drawn before any feature is selected. Below the minimums every feature is `exploratory`.
- **Sampling.** Stratified by year, capped per issue; editorials, errata and retracted papers excluded; special
  issues flagged; article type checked by hand on a sample. Only the version of record is measured; other versions
  are a separate stratum or left out.
- **Measuring only the text.** Body blocks only; declared rules remove publisher boilerplate (competing interests,
  CRediT, data availability, running heads); one parser version for target and control; parse quality reported per
  corpus and per stratum.
- **Distinctiveness.** Per-paper values; paper-level bootstrap CIs (author clusters when authors repeat); phrases by
  log-likelihood G² with Log Ratio as effect size and document prevalence; Benjamini–Hochberg FDR over the whole
  registry; a minimum effect before a feature enters `distinctive_feature_ids`.
- **Held-out test.** The registry and selected features are frozen first. Then a classifier separates held-out target
  from held-out control papers (AUC with CI), split so that no author is on both sides. `holdout_verified` is written
  only from this test.
- **Confounds.** Topic, year and author country mix reported per corpus in `confound_checks`.
- **Machine labels.** Before R17c, PaperLab rhetoric and stance feed only document prevalence ("does the paper have a
  gap statement"), never sequences; a stratified sample of labels is checked by a person in both target and control,
  and precision is reported per corpus. `move_sequences` and paragraph patterns wait for full sentence labels (R17c).

## 5. Journal corpus: what feeds the signature

PaperLab owns the paper side: it publishes a **feature registry** (`feature-registry-v1.json`, generated from code,
with its digest) and a **corpus profile** (`corpus-profile.json`, with values, comparisons and coverage per feature).
Both are vendored read-only into `writing-bank/schemas/vendor/paperlab/`. The bank only maps them into its signature
and never recomputes values.

| Signature field                                                                                                            | Comes from                                         | Before R17c?           |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------- |
| `scope` (years, article types, sampling policy, target population, combined Results-Discussion)                            | protocol                                           | yes                    |
| `coverage` (target, control, held-out, strata, dedup policy, parse and annotation pass rates per section)                  | release, member status, runs                       | yes                    |
| `provenance` (manifest id, parser, taxonomy and registry versions, extractor versions, annotation protocol, rights policy) | release, generator, registry                       | yes                    |
| `feature_registry_binding`                                                                                                 | PaperLab registry and its digest                   | yes                    |
| `features` with `comparison_to_controls` (structure, length, citation, stance)                                             | profile                                            | yes                    |
| `section_profiles` (headings, body word share; declared mapping from PaperLab roles to the signature's sections)           | profile                                            | yes                    |
| rhetoric as document prevalence; machine share in `extractor`, `review_status`, `uncertainty_notes`                        | profile                                            | yes                    |
| `phrase_signals` (G², Log Ratio, prevalence, normalisation and tokenizer versions)                                         | profile                                            | yes, within decision 5 |
| `scientific_profile` (declared mapping: niche → GAP, limitation → LIMITATION; CLAIM not mapped)                            | profile                                            | partly                 |
| `move_frequencies`, `move_sequences`, `paragraph_patterns`                                                                 | CoreSC / AZ-II labels                              | after R17c             |
| `evidence` pointers                                                                                                        | `exportId` + sentence key, excerpts per decision 6 | yes                    |

## 6. Slices

Each line is one PR.

| #    | Slice                                                                                                                         | Done when                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| R17b | Columns on today's Extraction (unchanged priority; the corpus links to it later)                                              | as in PAPER_MODEL.md                                                                   |
| C1a  | `paperlab-corpus` schema v1 generated from Zod, example, drift test, bank copy; Dexie store                                   | schema and example committed and vendored                                              |
| C1b  | Intake from Library, papers and DOI lists; identifiers, merge with alias records, title-year confirmation                     | the same paper added by DOI and then by PDF is one member                              |
| C1c  | Corpus screen: member table with status, protocol versions, releases with canonical digest, manifest export                   | a release digest does not change when nothing changed and does change when a role does |
| C2a  | PDF acquisition through the Paper Fetch Hub queue; persistent storage requested; space check; blobs evicted after upload      | 30 members fetched; refusals listed                                                    |
| C2b  | Corpus queue: parse and model each member, checkpoint per member, resumes after reload                                        | a 30-member build survives a reload                                                    |
| C3a  | Topic: corpus holds searches and screening; promote a project; one-way link to `project.papers`; `decideCandidate` fix        | an existing project opens unchanged; its promoted corpus shows the same inclusions     |
| C3b  | Two-stage screening log, reason list, PRISMA 2020 counts, search records with request URLs, RIS/CSV import                    | PRISMA numbers add up on a test corpus                                                 |
| C3c  | Snowballing, update searches, exports (RIS, CSV, PRISMA, logs)                                                                |                                                                                        |
| C3d  | Quality appraisal                                                                                                             |                                                                                        |
| C4a  | Journal and control harvest from OpenAlex by source id; strata; version of record; exclusions; seed                           | the same seed draws the same sample                                                    |
| C4b  | Corpus labelling runs (rhetoric, stance) with cost estimate and coverage; human label check sample                            | precision per corpus reported                                                          |
| C5a  | Feature registry v1 and corpus profile v1 (structure, length, citation, stance, rhetoric prevalence), statistics of section 4 | profile for one journal and its control validates                                      |
| C5b  | Held-out test and `holdout_verified`                                                                                          | AUC with CI on frozen features                                                         |
| C6   | Bank: vendor registry and profile; map to Journal Signature v2.1                                                              | one journal has a non-empty fingerprint                                                |
| C7   | After R17c: moves, sequences, paragraph patterns                                                                              | only after the R17c gate passes                                                        |

Order: R17b, then C1a–C1c and C2a–C2b. After that the topic line (C3) and the journal line (C4–C6) are independent.
C7 waits for R17c.

## 7. Limits accepted

- Runs need an open tab; nothing runs unattended until a server exists (ADR 0005 is still proposed).
- Publisher PDFs are reached only through open copies and the Paper Fetch Hub; paywalled papers may be missing,
  and `retrieval: not_retrieved` counts them.
- Corpora move between browsers as files unless decision 3 adds sharing; the export package must carry
  `paperContext` and corpora for that.

## 8. Owner decisions

1. The first journal, its control journals (at least three), and whether the default size of 150 + 150 papers holds.
2. Who labels the 5–10 papers for the AZ-II gate, and who checks the sample of machine labels.
3. Whether corpora are shared in the lab (a worker route on R2 and sign-in roles, which also enables dual screening)
   or stay in one browser and move as files.
4. Which appraisal tools the lab uses for reviews (C3d).
5. Phrase signals put phrases from real papers into the bank. Recommendation: at most five words, in at least 5% of
   target papers and at least five papers.
6. Evidence excerpts in the signature (at most 300 characters each, `display_safe_excerpt`): allowed, or pointers
   only. This sets `corpus_rights_policy`.

## 9. What the critique changed

| Finding                                                                                                                            | Severity        | Decision                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Member keys "first available, never changed" split one paper into two members; keys can be empty; `/` breaks the bank's id pattern | blocker         | Accepted: opaque `memberId`, growing identifiers, alias records, `exportId` slug                                                                 |
| Manifest digest changes on every rebuild (`generatedAt`) and ignores roles, seed, strata, versions                                 | blocker         | Accepted: canonical digest over inputs and design, frozen releases                                                                               |
| No sample size or power                                                                                                            | blocker         | Accepted: default minimums, `exploratory` below them; the numbers are an owner decision                                                          |
| Open copies are often preprints, not the journal's text                                                                            | blocker         | Accepted: `version` per member, version of record measured                                                                                       |
| Control as a role in the target corpus; no topic matching                                                                          | blocker         | Accepted: separate control corpus, topic matching, three journals, leave-one-out                                                                 |
| No method for distinctiveness                                                                                                      | blocker         | Accepted: section 4                                                                                                                              |
| The plan moved `project.papers`, but screening lives in deep research; moving it breaks cells and packages                         | blocker + major | Accepted in part: the corpus takes over search and screening; `project.papers` stays authoritative with a one-way link; no destructive migration |
| Dedup and search provenance already exist                                                                                          | major           | Accepted: reuse `mergeCandidates` and the plan approval gate                                                                                     |
| PRISMA cannot be counted from one screening value; OpenAlex totals not stored                                                      | major           | Accepted: decision log, retrieval state, search records                                                                                          |
| AI reasons stored as human reasons                                                                                                 | major           | Accepted: fixed in C3a                                                                                                                           |
| No dual screening                                                                                                                  | major           | Tied to decision 3; otherwise declared out of scope                                                                                              |
| Searches not reproducible; only OpenAlex                                                                                           | major           | Accepted: request URLs, totals, truncation, RIS/CSV import                                                                                       |
| Snowballing, appraisal, living review missing                                                                                      | major / minor   | Accepted as C3c, C3d                                                                                                                             |
| Held-out test undefined                                                                                                            | major           | Accepted: frozen features, AUC, author split                                                                                                     |
| PDF layout and boilerplate read as style                                                                                           | major           | Accepted: body blocks, boilerplate rules, one parser                                                                                             |
| Sampling frame misses strata                                                                                                       | major           | Accepted                                                                                                                                         |
| Machine labels unvalidated                                                                                                         | major           | Accepted: prevalence only before R17c, human check sample                                                                                        |
| Machine share has no field in the signature                                                                                        | major           | Accepted: `extractor`, `review_status`, `uncertainty_notes`                                                                                      |
| No author ids or countries                                                                                                         | major           | Accepted: OpenAlex ids and countries per member                                                                                                  |
| Store models or recipes                                                                                                            | major           | Accepted: recipes                                                                                                                                |
| R2 holds PDFs only                                                                                                                 | major           | Accepted: corrected                                                                                                                              |
| IndexedDB budget; export lacks `paperContext`                                                                                      | major           | Accepted                                                                                                                                         |
| Batch runner is per paper and needs the screen                                                                                     | major           | Accepted: corpus queue, "tab open, resumes"                                                                                                      |
| Registry ownership would reverse the rule                                                                                          | major           | Accepted: PaperLab owns the registry and profile; the bank maps only                                                                             |
| R17b should not wait                                                                                                               | major           | Accepted                                                                                                                                         |
| Slices too big                                                                                                                     | major           | Accepted: split                                                                                                                                  |
| Access and screening names collide                                                                                                 | minor           | Accepted: `textRead` vs Library `access`; `candidate` absent from the project view                                                               |
| Phrase threshold should scale with N                                                                                               | minor           | Accepted                                                                                                                                         |
| Section mapping and missing provenance fields                                                                                      | minor           | Accepted: section 5                                                                                                                              |
