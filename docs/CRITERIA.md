# The four criteria: definitions and routing

Status: **decided**. Date: 2026-11-12.

Every finding and mark on the paper page carries one of four letters: **C** Claims, **E** Evidence, **W** Writing,
**S** Sources. Until now the letter came from a table keyed by check id, with no written definition and a silent
fallback to Evidence. The owner found findings marked E that are not about evidence ("Fig. 4" not mentioned in the
text). This document defines the four criteria from external sources and decides every route from them.

## 1. Definitions

The definitions follow two models of argument that the lab's Writing Bank already holds
(`data/banks/argument-elements/elements.json`): Toulmin's layout of arguments (Toulmin, _The Uses of Argument_, 1958) and Booth, Colomb, Williams, Bizup and FitzGerald, _The Craft of Research_ (4th ed., 2016, ch. 7–10). The
wording below is ours.

| Letter | Criterion | Reader's question (Booth)                          | Toulmin parts                                | Belongs here                                                                                                                                                                                                                                                        | Does not belong here                                                                                   |
| ------ | --------- | -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| C      | Claims    | "What is your point, and why should I believe it?" | claim, qualifier, warrant, rebuttal          | a claim with no grounds; a claim stronger than its grounds or its qualifier (overclaiming, drift in strength between abstract and body); conclusions, significance and novelty as asserted; limitations and exceptions (rebuttals) that are missing or not answered | the data themselves; how a figure is referenced                                                        |
| E      | Evidence  | "How do you know?"                                 | grounds (data), backing                      | the reported data the claims rest on: whether a reported result can be found and checked in the paper, whether measurements, protocols and units are defined, whether the work can be reproduced                                                                    | whether a conclusion follows from the data (that is C); presentation of figures and tables (that is W) |
| W      | Writing   | "Can I follow it?"                                 | none (presentation)                          | acronyms, references to figures and tables in the text, flow between paragraphs, sentence clarity                                                                                                                                                                   | anything about what is claimed or what the data show                                                   |
| S      | Sources   | "Where does this come from, and is it sound?"      | backing from others' work; background claims | citations and the reference list, retracted or unresolved works, claims attributed to others                                                                                                                                                                        | the paper's own data                                                                                   |

Two boundaries are easy to blur:

- **Data versus claim about the data.** "Accuracy was 52.9 %" is grounds (E). "Our method is better" is a claim (C).
  The Writing Bank's Toulmin claim entry states the same test: a restatement of the data is not yet a claim about
  what the data mean.
- **Own versus background claims.** A claim the paper makes about its own work is C. A claim about others' work,
  backed by a citation, is S (Lauscher et al., 2018, label the same split as OWN CLAIM and BACKGROUND CLAIM).

## 2. Routing, decided from the definitions

Every route is in one typed, exhaustive table in `src/core/paperFindings`. There is no default: a new check without
a route is a type error, not a silent E.

| Source                        | Item                                                                                                | Letter           | Why                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| check                         | `numbers_consistency`: a number in the abstract is not found in the results, discussion or captions | E                | the reported data behind the number cannot be found in the paper: a question of "how do you know?"                                                                           |
| check                         | `unsupported_claims`                                                                                | C                | a claim without grounds                                                                                                                                                      |
| check                         | `figures_tables`: a figure or table is never mentioned in the text                                  | **W** (was E)    | presentation: the reader cannot follow which figure supports which passage; nothing is said about the data                                                                   |
| check                         | `acronyms`                                                                                          | W                | presentation                                                                                                                                                                 |
| check                         | `claim_strength_drift`                                                                              | C                | the qualifier changes between abstract and body                                                                                                                              |
| check                         | `citations_references`                                                                              | S                | sources                                                                                                                                                                      |
| review                        | `soundness`, `significance`, `originality`, `limitations_ethics`                                    | C                | they judge what the paper asks the reader to accept and its rebuttals                                                                                                        |
| review                        | `reproducibility`                                                                                   | E                | whether the grounds can be checked                                                                                                                                           |
| review                        | `clarity`                                                                                           | W                | presentation                                                                                                                                                                 |
| review                        | `citations`                                                                                         | S                | sources                                                                                                                                                                      |
| measurement                   | definition, units, protocol, aggregation, comparability                                             | E                | how the data were measured                                                                                                                                                   |
| measurement                   | `claim_evidence_gap`                                                                                | **C** (was E)    | the claim goes beyond what was measured: an overclaim                                                                                                                        |
| writing analyses, transitions | all                                                                                                 | W                | presentation                                                                                                                                                                 |
| mark                          | argument claim                                                                                      | C                | claim                                                                                                                                                                        |
| mark                          | argument data                                                                                       | E                | grounds                                                                                                                                                                      |
| mark                          | key facts (`snapshot`)                                                                              | **none** (was E) | key facts describe the paper (task, dataset, method); they are neither grounds nor an issue. They stay in the Key facts strip and are no longer drawn on the PDF as evidence |

Changing a letter does not change a finding's id, so decisions already stored still apply.

## 3. How accuracy is measured

Routing is a definition, checked by tests. Whether the AI finds the right claims and data is a measurement, done in
a development script against public gold labels:

- **Corpus.** Dr. Inventor argument corpus (Lauscher, Glavaš and Ponzetto, 2018): 40 computer-graphics papers with
  OWN CLAIM, BACKGROUND CLAIM and DATA spans. Its licence is not stated, so the corpus is read from a local folder
  and never committed; only the script, the label mapping and aggregate numbers are.
- **Mapping.** OWN CLAIM to C, BACKGROUND CLAIM to S, DATA to E (section 1).
- **Unit.** PaperLab's argument run returns sparse quotes, not a label for every sentence, so the score is the
  **precision** of returned spans (does a returned claim overlap a gold claim span?) and a per-label confusion table,
  with a majority baseline. Recall is reported but not used as the gate, because the run is not meant to return
  every span.
- **Protocol.** A fixed split before the first run (5 development papers, the rest held out), the threshold fixed
  before looking at held-out numbers, and no prompt changes in the same slice as the measurement.

Run `npm run bench:arguments -- --corpus <local-directory> --dry-run` to plan the development split A01–A05;
omit `--dry-run` to use the running development proxy. `--papers A06,A07` selects other papers, `--model` and
`--base-url` select the model and proxy, and `--out` changes the output directory (default `.bench/`). The script
does not load credentials. Completed papers are checkpointed; changed input, model, endpoint or prompt version
requires a new output directory. Keep corpus files and per-paper output local.

Offsets count Unicode code points in the raw XML, including tags. Each prediction is assigned to the single gold
span with the greatest positive character overlap (ties go to the first annotation); no overlap is `none`. Recall
counts a gold span if any prediction of its corresponding kind overlaps it. The majority baseline chooses the most
frequent gold label and reports its share among all predictions, including unmatched predictions in the denominator.
Alongside data precision, **data contains gold data** reports the share of predicted data spans that overlap at
least half the length of any gold data span, even when a different label has the largest overlap.
Empty denominators are reported as not assessable. Planned calls exclude client retries and JSON repair.

## 4. First results (development split, 2026-11-12)

Papers A01–A05 of the Dr. Inventor corpus, model `cx/gpt-6-luna`, prompt `argument-1`, 18 planned calls.

| Predicted | own_claim (C) | background_claim (S) | data (E) | none |
| --------- | ------------: | -------------------: | -------: | ---: |
| claim     |            63 |                    3 |        1 |   10 |
| data      |            96 |                   15 |        8 |   40 |

| Measure                       | Value |
| ----------------------------- | ----: |
| Claim precision               | 81.8% |
| Data precision                |  5.0% |
| Own claim recall              |  9.8% |
| Data recall                   | 10.9% |
| Majority baseline (own_claim) | 67.4% |

### Checks on these numbers

- **Alignment.** The raw text at every gold offset equals the annotation text (1,623 of 1,623 spans in A01–A05), so
  the harness compares the right passages.
- **Chance level.** Random spans of the same lengths in the same papers land on an own claim 41 % of the time, on
  data 7 %, on nothing 30–35 %.
- **Claims.** About 80 % of returned claims overlap an annotated own claim, against 41 % by chance: a real signal on
  own versus background claims.
- **Data: no signal, and the mapping is wrong.** Data precision (5–7 %) equals chance (7 %). Reading 40 returned data
  spans next to the gold labels shows why. In this scheme a reported result ("the compute time is insignificant
  compared to …", "both algorithms produce similar results") is annotated **OWN CLAIM**. DATA marks short premises
  inside a sentence ("Figure 7 to Figure 10", "the linear system is solved"). Tables, captions, equations and bare
  numbers are not annotated at all. Section 1 of this document calls a reported result E, so **DATA → E is the
  wrong mapping**, and this corpus cannot measure E.
- **A failed attempt.** Prompt `argument-2` redefined data as observations, measurements and pointers. On the
  development split it gave claim precision 80.2 %, data precision 7.4 % (15.7 % when a predicted span only has to
  contain gold data). It did not pass the gate fixed before the run (data ≥ 40 %), was not run on held-out papers
  and is not merged; `argument-1` stays. The held-out papers A06–A40 are still unseen.

So: the Dr. Inventor corpus is kept for **own versus background claims** (C versus S). Measuring E needs gold labels
that follow section 1, made in the lab on a few papers.

## 5. The form of a claim

Neither Toulmin nor Booth constrain a claim's length or wording: a claim is defined by what it does. The gold
annotations give its usual form (all 40 papers, aggregate counts only):

| Label            | Spans | Words, median (10–90 %) | Starts a sentence | Common cue just before                         |
| ---------------- | ----: | ----------------------- | ----------------: | ---------------------------------------------- |
| own claim        | 6,004 | 12 (5–22)               |             ~40 % | that, however, because, since, therefore, thus |
| background claim | 3,291 | 10 (4–20)               |             ~42 % | however, that, because                         |
| data             | 4,297 | 3 (1–10)                |              ~9 % | because, since, that                           |

So a claim is usually **one clause**, not a whole sentence, of about 5 to 22 words, often after "that",
"however", "because" or "therefore". Data are short and often a pointer ("Figure 4", "Section 3"). These are soft
expectations used as warnings, not filters; cue words are hints, present in under 10 % of claims.

## 6. Claim types

Writing Bank claim-types defines twelve types: descriptive, comparative, correlational, causal, mechanistic,
predictive, methodological, generalisation, novelty, null, theoretical and recommendation. The type is the
model's reading, shown as a label that the reader can reject like any other.

Prompt `argument-3` adds the type and leaves the claim and data definitions as they were. On the development split
(A01–A05, 2026-11-12) claim precision was 79.5 % (81.8 % with `argument-1`; the difference is within run-to-run
variation on five papers), data precision 7.9 %. The types returned for these computer-graphics papers were mostly
methodological (39 of 88), descriptive (18) and comparative (16), then generalisation (7), theoretical (4), novelty
(2), mechanistic and recommendation (1 each). There is no gold standard for types, so these counts describe the
output and do not measure it.
