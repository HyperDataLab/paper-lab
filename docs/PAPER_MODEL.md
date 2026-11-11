# Paper model: one paper in, four standard exports out (R17)

Status: **decided after critique** (sections 3–8 are the design; section 9 records what the critique changed; section 10 is the exchange contract). Date: 2026-11-11.

How it was made: three research agents (JATS + NCG, CoreSC + AZ-II, a code inventory) reported; Claude drafted the
design; a fourth agent attacked the draft; Claude checked its claims against the code and decided each point.

Goal (owner): the input is one paper; the output is a **paper model** that can be exported under JATS, CoreSC,
AZ-II and NLPContributionGraph. Analyst and critic passes ("agents") do the classification. The Data table space
(SciSpace Extract Data, 50 columns) sits on the same model.

## 1. The four targets

| Scheme                                             | What it describes                                                    | Unit                                      | Labels                                                                                                                                                                                                                                    | Export                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **JATS 1.4** (NISO Z39.96-2024), Archiving flavour | The document: metadata, section tree, paragraphs, floats, references | element                                   | `sec-type` (cases, conclusions, discussion, intro, materials, methods, results, subjects, supplementary-material; open list)                                                                                                              | XML; `mixed-citation` for references; sentence labels as nested `<named-content>` elements, one per scheme |
| **CoreSC** (Liakata et al.)                        | The content of the investigation                                     | sentence, one label                       | 11: Hypothesis, Motivation, Background, Goal, Object, Method, Experiment, Model, Observation, Result, Conclusion; novelty New/Old on Method and New on Object, Advantage/Disadvantage on both; `conceptID` links sentences of one concept | SciXML-style `<s sid><annotationART type conceptID novelty advantage/>`, plus CSV/JSONL                    |
| **AZ-II** (Teufel et al. 2009)                     | Who owns each knowledge claim and how it relates to other work       | sentence, one label                       | 15: AIM, NOV_ADV, CO_GRO, OTHR, PREV_OWN, OWN_MTHD, OWN_FAIL, OWN_RES, OWN_CONC, CODI, GAP_WEAK, ANTISUPP, SUPPORT, USE, FUT                                                                                                              | CSV/JSONL, and SciXML-style `<S AZ=…>`                                                                     |
| **NLPContributionGraph** (SemEval-2021 Task 11)    | The contribution as a graph                                          | contribution sentence → phrases → triples | 12 information units: ResearchProblem, Approach, Model, Code, Dataset, ExperimentalSetup, Hyperparameters, Baselines, Results, Tasks, Experiments, AblationAnalysis                                                                       | folder: `sentences.txt`, `entities.txt`, `triples/<unit>.txt`, `info-units/<unit>.json`                    |

Facts that shape the design (from the research, sources at the end):

- CoreSC and AZ-II are **complementary, not derivable from each other** (Cramér's V 0.335, λ ≈ 0.35–0.38 on 36 shared
  papers). Each sentence needs two independent labels.
- Human agreement is modest: CoreSC κ ≈ 0.55, AZ-II κ ≈ 0.65–0.71. Published classifiers reached ≈ 51 % accuracy on
  CoreSC. Labels are estimates, never facts about the paper.
- Both sentence schemes were validated on chemistry (AZ-II also on computational linguistics). NCG was built on NLP
  papers only; Hyperparameters, Baselines and AblationAnalysis are ML-specific.
- JATS has no sentence element; `named-content` with `vocab`/`vocab-term` carries a label, and its `id` can be our
  sentence id.

## 2. What PaperLab already has

Reusable as is: sections (role, level, page), paragraphs (kind, table structure, textHash), a sentence splitter
(`segmentSentences`, code-point offsets), OpenAlex metadata, the reference list, in-text citation detection, rhetoric
moves, arguments, measurement (atomic sentences, experiments, results), key facts, the 50 Extraction columns with
cell evidence, the LLM job pattern (prompt version, quote verification, chunk checkpoints).

Missing: a paper-wide sentence index with stable ids; structured authors and affiliations; stored references and
citation links; a label for **every** sentence (today's labels are sparse quotes); a triple schema; any exporter for
the four schemes.

## 3. The model

One neutral model, pure exporters. Nothing scheme-specific is stored in the document layer.

```
PaperModel
├─ L0 document      metadata (title, authors as written, affiliations?, doi?, dates, venue?, keywords, abstract),
│                   editable by the reader, filled from OpenAlex/Crossref when a DOI is known
│                   sections (id, parentId derived from level, title, role, secType?)
│                   blocks (paragraph | list | equation | table | caption | footnote), page, textHash
│                   references (id, raw text, parsed fields? ) · citation links (sentence key, start, end, targets[])
├─ L1 sentences     key = hash(normalised text) + occurrence ordinal; display id <paragraphId>_s<n>
│                   indexed for body, abstract and caption blocks; not for references, tables or equations
├─ L2 annotations   { key: sentence key, scheme, label, attrs, origin: rule | ai | human, state, runId,
│                     second?: label from the independent second pass }
│                   schemes: coresc, az2, ncg-unit
└─ L3 knowledge     phrases (sentence key, start, end, text) · triples (unit, subject phrase, predicate phrase,
                    object phrase, sentence key). NCG unit JSON is derived from the triples at export time.
```

Rules:

- **Annotations are keyed by content, not position.** Paragraph ids are positional and every import gets a new paper
  id, so a label is attached to the sentence's text hash and occurrence. Importing the same file again (same
  `source.sha256`) re-anchors labels by key; only sentences that no longer exist are dropped, and the screen says how
  many. Export ids (`sid`) are generated at export time.
- **Two labels per sentence, never mapped.** `coresc` and `az2` are separate annotations; no table converts one into
  the other.
- **State is honest.** On screen a label counts as accepted unless the reader rejects it, as everywhere on the paper
  page. In the data and in every export its state is `machine` (nobody looked), `confirmed` (the reader changed or
  kept it on purpose) or `rejected`. Export files carry the state of every label, the share of sentences covered, and
  "machine-labelled" in the file name when any label is `machine`.
- **Provenance in every export**: model, prompt version, date, and the agreement measured between the two passes.

## 4. The passes ("agents")

| Pass            | Kind                           | Does                                                                                                                                                                                                                                                             | Cost                      |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| P1 Structure    | code                           | sentence index and keys, citation links, reference split, section parents                                                                                                                                                                                        | none                      |
| P2 Metadata     | lookup + form                  | OpenAlex/Crossref by DOI (only the DOI is sent); the reader can edit every field, and must when there is no DOI                                                                                                                                                  | 1 request                 |
| P3 Analyst      | LLM, chunks of 25–30 sentences | for each sentence: CoreSC type (+novelty, advantage) and AZ-II category. Gets the section heading and two read-only sentences of context on each side; answers compact rows `[sid, coresc, az]`                                                                  | ≈ 1 call per 28 sentences |
| P4 Critic       | LLM, on request                | an **independent second labelling** with another prompt order (or model). Where the two passes disagree, the sentence is flagged and both labels are kept; the agreement rate is reported. It replaces "low confidence": a model's own confidence is not trusted | same as P3                |
| P5 Contribution | LLM, ML/NLP papers             | marks contribution sentences, assigns units, extracts phrases and triples                                                                                                                                                                                        | ≈ 3–6 calls               |

Every chunk is checkpointed. The answer's ids are checked against the request; only missing sentences are asked again,
and sentences left without a label are shown as uncovered on screen and in exports. For a 440-sentence paper: about
16 analyst calls, 16 more with the critic, 5 for the contribution graph.

**Gate before the labels ship.** The analyst prompt is evaluated against the public ART corpus (CoreSC gold labels)
with a threshold fixed before the run, in a development script (the corpus is CC BY-NC and is not bundled). AZ-II has
no open gold set we know of, so 5–10 papers are labelled in the lab. The critic stays off by default unless the
evaluation shows that it raises agreement.

## 5. Exports

- `paper-model.json`: the whole model; the only format that can be imported again.
- `article.xml`: **JATS 1.4 Archiving** (Publishing requires `journal-meta` with a journal id and ISSN, which a
  preprint does not have). Authors as `<string-name>` unless surname and given names are known; `sec-type` only where
  the role maps to a suggested value; raw `mixed-citation`; `xref` only for citations that resolve, with several
  targets when the text says `[3–5]`. Optional sentence wrapping: two nested `named-content` elements, one per scheme.
  Well-formedness is checked in the browser; validity against the DTD is checked in CI on fixture papers, including a
  preprint with no DOI.
- `coresc.xml` (SciXML-style; never marked as gold standard) and `coresc.csv`.
- `az2.csv` / `az2.jsonl` and SciXML-style `<S AZ=…>`.
- `ncg.zip`: the SemEval layout. The exporter writes its own tokenised sentence file and maps phrase offsets onto it;
  triples are `(A||predicate||B)` rooted at `Contribution`. Only the units that apply are written, with a note when
  the paper is outside ML/NLP.

## 6. Where it shows

The **Data table** space has three views over the same model:

- **Columns**: the 50 suggested columns and custom ones, capped at 50, as in SciSpace Extract Data. It is the existing
  Extraction engine run on a one-paper project, so nothing is built twice; "So sánh với bài khác" turns it into a
  normal project. Exports CSV, Excel, BibTeX, RIS.
- **Sentences**: every sentence with its CoreSC and AZ-II labels, filters by label and by "two passes disagree",
  reject and change.
- **Contribution graph**: units and triples.

A "Xuất" menu offers the export files.

## 7. Slices

1. **R17a** (done) sentence index with content keys, a fix to the splitter (an unmatched bracket no longer stops
   splitting; `pl-seg-3`), `paper-model.json` with today's PaperLab rhetoric and stance labels, the editable
   metadata form, the agreement metrics for the evaluation gate, and the Writing Bank contract (section 10). No AI.
   Deferred from it: citation links move to R17d, and the ART corpus loader for the evaluation script to R17c.
2. **R17b** Data table → Columns (the owner's first priority; reuses Extraction).
3. **R17c** analyst pass and Sentences view, behind the evaluation gate; critic pass on request; CoreSC and AZ-II
   exports.
4. **R17d** JATS Archiving export with raw `mixed-citation`. Parsed references are deferred.
5. **R17e** contribution pass, graph view, NCG export, for ML/NLP papers.

Deferred: CoreSC `conceptID` linking across sentences (one concept per sentence for now); PREV_OWN by self-citation
(needs parsed author names on both sides); table header structure and MathML.

## 8. Decisions on the open questions

1. NCG outside ML: export only the units that apply and say that the scheme is out of domain. A neutral graph, if
   wanted later, lives in `paper-model.json`, not in the NCG export.
2. JATS validation: no WASM validator in the app; well-formedness in the browser, DTD validation in CI.
3. Critic: on request, as an independent second pass.

## 9. What the critique changed

| Finding                                                                                                    | Severity | Decision                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Positional ids and a new paper id per import lose every label                                              | blocker  | Accepted: content keys and re-anchoring                                                                                                                                  |
| "Accepted unless rejected" for ~880 unreviewed labels per paper                                            | blocker  | Kept on screen (owner's rule), but the data and exports record `machine` / `confirmed` / `rejected`, coverage and "machine-labelled"; an evaluation gate before shipping |
| Critic built on self-reported confidence and a chemistry-only co-occurrence table                          | major    | Accepted: independent second pass; disagreement is the flag                                                                                                              |
| JATS Publishing cannot validate a preprint; no surname/given split; no metadata without a DOI              | major    | Accepted: Archiving, `string-name`, an editable metadata form                                                                                                            |
| One `named-content` cannot carry two schemes; a citation may have several targets                          | major    | Accepted                                                                                                                                                                 |
| NCG files are token-based, triples reference phrases, unit JSON is derivable                               | major    | Accepted                                                                                                                                                                 |
| Call estimate too low; failed chunks leave holes                                                           | major    | Accepted: smaller chunks, compact rows, re-ask missing ids, visible coverage                                                                                             |
| The sentence splitter stops splitting after an unmatched bracket                                           | major    | Accepted: fix and fixture tests in R17a                                                                                                                                  |
| JATS first is the wrong order; the Columns view duplicates Extraction                                      | major    | Reordered. Columns is not cut (the owner asked for it) but is built as a view over the Extraction engine                                                                 |
| CoreSC has no Object-Old; do not emit gold-standard markers; AZ has a SciXML form; no section tree in code | minor    | Accepted                                                                                                                                                                 |

## 10. Exchange with Writing Bank

`paper-model.json` is the exchange file between PaperLab and the lab's Writing Bank.

- **PaperLab is the standard; Writing Bank only conforms.** The JSON Schema `schemas/paper-model-v1.schema.json` is
  generated from PaperLab's code (`PaperModelSchema`, `npm run schema:paper-model`) and published only from PaperLab.
  Writing Bank keeps a read-only copy of the versioned schema and validates every file against it. A change the bank
  needs is requested from PaperLab and released as a new schema version, never edited in the bank's copy.
- The contract is `schemaVersion: 1`. Consumers must reject a file with any other `schemaVersion`. A breaking change
  ships as version 2 under a new file name (`paper-model-v2.schema.json`); version 1 stays published as it is.
- `examples/paper-model.example.json` is generated by the same script from synthetic text; a test fails when either
  file differs from what the code produces.
- How labels line up. Annotations with scheme `paperlab-rhetoric` use PaperLab's rhetoric categories; `territory`,
  `niche` and `occupy` correspond to Swales CARS Move 1, 2 and 3, which the bank's move entries name in `alignedTo`.
  Scheme `paperlab-stance` uses PaperLab's stance and engagement names, which the bank copies unchanged. CoreSC and
  AZ-II labels (`coresc`, `az2`) arrive with R17c. Every label carries its review state (`machine`, `confirmed`,
  `rejected`) and its run (model, prompt version), and `annotationRuns` says how many items of each run fell outside
  the sentence index.

## Sources

- JATS 1.4: https://jats.nlm.nih.gov/ · `sec-type`: https://jats.nlm.nih.gov/archiving/tag-library/1.4/attribute/sec-type.html · `named-content`: https://jats.nlm.nih.gov/archiving/tag-library/1.4/element/named-content.html
- CoreSC and its comparison with AZ-II: https://aclanthology.org/L10-1440.pdf · classifier: https://pmc.ncbi.nlm.nih.gov/articles/PMC3315721 · ART corpus: https://aber.ac.uk/en/cs/research/cb/projects/art/art-corpus
- AZ-II: https://aclanthology.org/D09-1155.pdf
- NLPContributionGraph: https://arxiv.org/abs/2106.07385 · data: https://github.com/ncg-task/training-data
