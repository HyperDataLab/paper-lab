# AutoResearch: a multi-agent research branch inside PaperLab, using PaperLab and Writing Bank

Owner, 2026-11-19:

- split AutoResearch off as its own branch;
- use the team's openai-scientist repos for reference only;
- keep the multi-agent mechanism;
- brainstorm the design with the advisor.

This plan replaces slices R2–R5 of `RESEARCH_PIPELINE.md`. R1, screening at scale, becomes the screening stage here.

Status: AR1–AR3 implemented. S1–S12 run in the browser with human approval. AR4 remains planned.

## Ground rules

1. **References only.** We borrow ideas and field-level contracts from openai-scientist:
   - `idea2hypothesis` (MIT, derived from AutoResearchClaw);
   - `principal-investigator`, `docs` and the frontend (these have no licence file).
     We write our own schemas and prompts. We copy no code, prompts or document text, push nothing to that org, and do not depend on their services at runtime.
2. **PaperLab rules still apply:**
   - AI output is a candidate until a person accepts it.
   - A model never invents a number; values that are not known stay `null`.
   - Academic terms stay in English.
   - PaperLab executes no experiment code. SRD runs experiments, and results come back as a log.
3. **Where the loop runs: in the browser.** One stage runs per click, with a checkpoint after every LLM call (Dexie), on the user's 9router key. Gates need a person anyway. Running on the worker would need a server-side LLM key with no spending cap, so that waits for an explicit owner decision.

## Two layers (the "multi-agent" part)

**Stage engines.** Each stage takes typed inputs and produces a typed artifact record with:

- a schema version;
- a content hash;
- a pass condition checked by code;
- one named error code.

An edit upstream marks every later artifact `stale`. Resuming is allowed only while the hashes still match. Each piece of evidence carries an `evidence_scope` (`abstract` or `full_text`). References must resolve along the whole chain: sub-question → query → paper → screening decision → card → gap → hypothesis → argument.

**Supervisors.**

- **PI.**
  - Runs at each stage outcome.
  - Picks one action from the allowed list: `accept` (all or part), `send_back` (to a named earlier stage, with a note), `rerun`, `stop`, or `escalate`.
  - Gives a rationale, a confidence, the options it considered, and a handoff of at most 5 lines for the next stage.
  - Uses read tools: artifacts, notebook, lab KG search, OpenAlex, the Writing Bank snapshot.
  - Code guards every decision:
    - the action must be allowed and the ids must be known;
    - `send_back` must give a target and a note;
    - every serious Critic point gets an answer, and every researcher directive is cited;
    - `send_back`, `rerun` and `stop` need a fixable problem;
    - before rejecting everything, the PI must consider accepting part of it.
  - A decision that fails a guard returns to the PI as an observation, and the PI tries again.
- **Critic.**
  - Uses a different model from the PI and has read tools only.
  - Reports at most 8 points. Each point has:
    - a lens: `charter`, `risk`, `directive` or `integrity` (the integrity tags are post-hoc criteria, spin, suppressed result, fabrication and leakage);
    - a reference that must resolve;
    - a severity and a fix class (`fix`, `needs_evidence` or `later`).
  - The verdict (`sound`, `concerns` or `serious`) is computed from the points.
  - On a repeat review, each earlier serious point must be marked resolved or maintained.
- **In PaperLab the PI only recommends.** The person decides at every gate. If the PI rejects a serious Critic point, the decision always goes to the person.

**Shared run state.**

- **Charter.** Written before any work, as a pre-registration:
  - the question;
  - 2–4 objectives;
  - what is in scope and out of scope;
  - success criteria (a well-tested negative result counts as success);
  - kill criteria;
  - constraints;
  - a risk posture: exploratory or confirmatory.
    Changing the charter after results exist needs an escalation.
- **Notebook.** Entries from the user (directives) and from the PI (lessons, risks, observations, questions).
- **Obligations ledger.** Accepted risks are carried forward until a later stage controls them. The close report must name every obligation still open.
- **Ending.** A run always ends: `complete`, `with_gaps`, `failed` or `cancelled`. It never stays stuck waiting.

**Pinned actions.** These are always the person's call:

- the charter;
- choosing the hypotheses and the primary one;
- locking the plan;
- deviating from the locked plan;
- export.

## Stages, mapped onto PaperLab

| #   | Stage                          | Artifact (key fields)                                                                                                                                                                                                                         | Pass condition                                 | Uses in PaperLab / Writing Bank                            | Gate                               |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| S1  | Charter and topic              | charter; goal (problem, objective, scope, success criteria)                                                                                                                                                                                   | researchable, or rejected with a reason        | topic check (lab MCP), Project                             | **charter (pinned)**               |
| S2  | Problem decomposition          | ≥ 3 sub-questions; topic scores (novelty, specificity, feasibility, overall computed by code)                                                                                                                                                 | above a minimum score                          | –                                                          | optional                           |
| S3  | Search strategy                | ≥ 2 strategies, queries linked to sub-question ids, year filter                                                                                                                                                                               | ids resolve                                    | corpus protocol                                            | –                                  |
| S4  | Literature collection          | candidates with id (DOI, arXiv or normalised title), source records, citation key                                                                                                                                                             | at least 1 paper                               | corpus harvest (OpenAlex), lab KG, library                 | –                                  |
| S5  | Screening (R1)                 | decision and reason for every candidate; relevance and quality scores, or null; thresholds                                                                                                                                                    | every candidate decided; shortlist non-empty   | Sàng lọc, PRISMA                                           | **yes**                            |
| S6  | Knowledge cards                | problem, method, data, metrics, findings, limitations (each text or null) and `evidence_scope`                                                                                                                                                | no template text                               | paper model, extraction matrix, SCG                        | –                                  |
| S7  | Synthesis                      | clusters (each card in exactly one, or set aside with a reason); ≥ 2 gaps linked to sub-questions and cards                                                                                                                                   | coverage; numbers must appear in a card        | corpus keywords, OpenKG                                    | –                                  |
| S8  | Hypotheses                     | ≥ 2 hypotheses, each with gap, sub-questions, evidence refs, outcome, estimand, prediction (> 0, < 0, ≠ 0), falsification criterion with a threshold, novelty and risk; perspectives and debate rounds; novelty assessment against the lab KG | refs resolve; no near-duplicates               | Research questions và hypotheses                           | **choose hypotheses (pinned)**     |
| S9  | Argument map                   | evidence → claim → hypothesis links with relation and status (`stated`, `derived` or `unreviewed`)                                                                                                                                            | ≥ 1 claim per hypothesis                       | AKU / Argument / Toulmin                                   | –                                  |
| S10 | Experiment design              | datasets, baselines, methods, ablations, metrics, risks, compute                                                                                                                                                                              | hypothesis coverage and pinned Bank references | Research design sections and Writing Bank                  | **yes**                            |
| S11 | Freeze and hand to SRD         | linked frozen plan version and ETag                                                                                                                                                                                                           | freeze gate and plan validation                | Gói kế hoạch and `/v1/projects` plans                      | **lock or deviation (pinned)**     |
| S12 | Results and analysis           | results log imported from SRD; analysis that only uses logged numbers; decision: proceed, refine or pivot                                                                                                                                     | every number traceable to the log              | –                                                          | **yes**                            |
| S13 | Writing (PaperOrchestra style) | outline → Intro and Related Work from screened papers only → sections → review rounds that keep only improvements → citation checks                                                                                                           | ≥ 90% of the pool cited; references verified   | journal profile, blueprint, `/v1/measure`, reference audit | **outline, final (pinned export)** |

## Slices

- **AR1** (now) builds the stage-contract framework and the supervisors:
  - the run record: charter, notebook, obligations, artifact store with versions, hashes and stale marking, plus the run state machine;
  - PI and Critic, with code guards and retry by observation;
  - stages S1–S3 and S5–S8 on top of the existing corpus and screening code, with S5 reusing R1;
  - an "AutoResearch" area inside a Project, with a stage track, artifact viewer, gate sheet, PI advice and Critic report panels, and a decision inbox.
- **AR2** (implemented): S4 searches the lab KG and OpenAlex before adding Project corpus records. S6 uses DOI-matched full text with sentence anchors when available. S9 builds an Argument map and exports the approved map as JSON.
- **AR3 (implemented):** S10–S12 (design into the Research design sections, freeze, import results).
- **AR4:** S13, writing with Writing Bank. First, ask Writing Bank (`_coord`) to serve blueprints, moves and paragraph types through the API.

## AR1 implementation

- Open AutoResearch in a multi-paper Project. The selected stage is linked through `?ar=S1` through `?ar=S8`.
- S4 uses existing corpus members, harvested results and project papers. A harvested query link is recorded only when it matches a stored search. Otherwise the paper is attributed to the existing pool. Missing abstracts can be looked up by DOI. AR1 knowledge cards use abstracts.
- S5 adapts the shared screening suggestions and previous human decisions. Relevance, quality and thresholds are null until a screening provider supplies them. S8 compares hypotheses with the existing pool and available OpenAlex results using a heuristic.
- S10 pins the Writing Bank release and validates references against the snapshot supplied to the model. Applying the approved design creates individual draft candidates in Research design, Measurement, Statistical analysis and Ma trận chạy.
- S11 records the linked frozen version independently of publishing. Draft changes after a lock create a pinned deviation in the decision inbox. Approving a deviation requires a note and freezes a new version. A new lock invalidates the existing S12 analysis.
- S12 imports a JSON or CSV log exported from SRD or supplied as a file. CSV accepts one column per metric or a quoted `metrics` JSON column. Planned IDs, MLflow metric keys and unambiguous names are accepted. Replacing a log invalidates its analysis.
- S12 computes sample means and standard deviations by dataset and condition. It implements two-sided Welch and seed-paired t-tests and exact or tie-corrected asymptotic Mann–Whitney tests. Correction families group planned tests by correction method across datasets and metrics. Unsupported tests have unavailable p-values. Free-form criteria that cannot be mapped to the locked contrast remain inconclusive for human review.
- The lead model and Critic use the configured endpoint. A shared model is shown in the workspace and recorded with the stage. Stage estimates use call counts and the configured call ceiling. Monetary estimates are null when router pricing is unavailable.
- Dexie version 26 stores runs and checkpoints. Backups include the runs. Interrupted stages can continue while hashes and model and prompt versions match.
- An edited artifact keeps its previous version and marks subsequent artifacts stale. The edited draft returns to the reviewers and the human gate. The charter has its own approval, and retrieved paper records keep their original provenance.
- Researchers approve the charter and its amendments, select the primary hypothesis, and act on PI and Critic advice. AutoResearch selections copy to Research design as candidates for confirmation there.

## AR2 implementation

- S4 runs the S3 queries against the lab KG and OpenAlex, then adds existing corpus, harvest and Project records. Candidates deduplicate by DOI, OpenAlex work ID and normalized title. Each candidate retains the source records, and the artifact keeps retrieval status and errors for each provider. An unconfigured or empty lab KG falls back to OpenAlex. When no papers are found, the gate records `NO_LITERATURE`. The researcher can queue papers with a DOI or OpenAlex ID for the lab KG.
- S6 uses the local Paper model when its DOI matches an included paper and the model contains body sentences. Full-text cards preserve the cited sentence keys, quotes and locations. Other cards use the Abstract when available. The resolved inputs are hashed in the stage checkpoint.
- S9 judges each clustered card once and requires at least one claim rationale per accepted hypothesis. The graph keeps directed, typed relationships and identifies their review status. Both PI and Critic can read it through the artifact tool. The Project has no candidate intake for AKU or Argument items, so approval enables JSON export of the map.
- S9 is the last stage of a new run. Existing AR1 records and backups keep their artifact hashes and completion status. AR2 uses the same Dexie version.
