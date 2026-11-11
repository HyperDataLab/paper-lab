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
