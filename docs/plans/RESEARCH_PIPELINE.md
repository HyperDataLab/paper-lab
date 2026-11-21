# Multi-stage research pipeline: ideas, experiment design and paper synthesis

Owner, 2026-11-19: screening has far too many papers (one project shows 55 unscreened out of 68). The owner asked to study AutoResearchClaw and Google's PaperOrchestra, and to design a multi-stage mechanism for:

- finding research ideas;
- designing experiments;
- synthesising papers.

Status: plan. R1 comes first.

## What the two references do (read 2026-11-19)

**AutoResearchClaw** (aiming-lab, MIT, arXiv 2605.20025) takes a topic and produces a paper. It runs 23 stages in 8 phases. Files on disk pass work from stage to stage. Three gates can send the run back.

| Phase           | Stages                                                                           |
| --------------- | -------------------------------------------------------------------------------- |
| A, scoping      | TOPIC_INIT, PROBLEM_DECOMPOSE                                                    |
| B, literature   | SEARCH_STRATEGY, LITERATURE_COLLECT, LITERATURE_SCREEN (gate), KNOWLEDGE_EXTRACT |
| C, synthesis    | SYNTHESIS, HYPOTHESIS_GEN                                                        |
| D, design       | EXPERIMENT_DESIGN (gate), CODE_GENERATION, RESOURCE_PLANNING                     |
| E, execution    | EXPERIMENT_RUN, ITERATIVE_REFINE                                                 |
| F, analysis     | RESULT_ANALYSIS, RESEARCH_DECISION (proceed / refine / pivot)                    |
| G, writing      | PAPER_OUTLINE, PAPER_DRAFT, PEER_REVIEW, PAPER_REVISION                          |
| H, finalisation | QUALITY_GATE (gate), KNOWLEDGE_ARCHIVE, EXPORT_PUBLISH, CITATION_VERIFY          |

Ideas worth borrowing:

- **Search strategy:** 3–5 strategies with 3–5 queries each.
- **Literature sources:** OpenAlex first, then Semantic Scholar, then arXiv.
- **Screening:** a strict reviewer gives each paper `relevance_score` and `quality_score` (0–1) and a `keep_reason`, compared against a threshold.
- **Knowledge cards:** `{problem, method, data, metrics, findings, limitations}` per paper.
- **Hypotheses:** at least two falsifiable ones, each with a rationale, a measurable prediction and a failure condition.
- **Experiment design:** `{objectives, datasets, baselines, proposed_methods, ablations, metrics, risks, compute_budget}`.
- **Citation checks** in 4 layers: arXiv id → Crossref/DataCite DOI → title match → LLM relevance.
- **Reviewing:** two reviewers, a score from 1 to 10, and a check that methods agree with evidence.
- **Human-in-the-loop modes:** full-auto, gate-only, co-pilot (pauses at hypotheses, design, outline and draft), and a cost budget.

**PaperOrchestra** (Google Research, Apache-2.0, arXiv 2604.05018) is a writer only. It takes an idea and an experiment log and produces a LaTeX paper. It does not generate ideas or run experiments. Its stages:

1. **Outline.** `outline.json` holds `plotting_plan`, `intro_related_work_plan` and `section_plan`, with citation hints for must-have baselines, datasets and metrics.
2. **Hybrid literature.** Search tasks come from the outline: Intro search directions, Related Work queries that look for limitations, and targeted citation hints. Candidates are checked against Semantic Scholar and dated against a cutoff. Titles are de-duplicated. Each paper gets a citation key (author+year+title words) in `citation_map.json`. Intro and Related Work must cite at least 90% of the collected pool.
3. **Section writing.** One call writes the remaining sections and builds tables from the log, using exact citation keys.
4. **Content refinement.** Up to 3 rounds: an automated reviewer scores the draft, a revision is kept only if the overall score does not fall, and it is reverted otherwise.

## PaperLab already has most of the pieces

These pieces exist:

- corpus protocol and harvest (`src/core/corpus`);
- PRISMA, screening with "Gợi ý sàng lọc (AI)", and appraisal;
- snowballing;
- the extraction matrix and Deep Research;
- Research design sections: Topic and research gaps, Research questions and hypotheses, Research design, Measurement, Statistical analysis, Runs, Bảng so sánh, Gói kế hoạch;
- SCG contributions and the OpenKG graphs;
- the lab KG (in progress);
- Writing Bank journal profiles and blueprints;
- the reference audit.

What is missing is a **pipeline** that links these pieces, keeps state and enforces gates, plus the stages that are weak today.

PaperLab's rules still apply:

- AI output is a candidate until a person accepts it.
- No code is executed in PaperLab. Experiments are planned here; SRD runs them, and the results come back as a results log.
- Academic terms stay in English.

## Pipeline in PaperLab

A **Research run** belongs to a Project. It records stages, artifacts (versioned), gate decisions, LLM calls and cost, and a mode: co-pilot by default, or gate-only. It is resumable.

| #   | Stage                                                                                                                                                  | Builds on                                              | Output                                             | Gate     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------- | -------- |
| A1  | Scoping: topic → problem decomposition (sub-questions, scope, exclusions)                                                                              | Topic check (lab MCP)                                  | scope.json                                         | –        |
| B1  | Search strategy: 3–5 strategies × 3–5 queries                                                                                                          | corpus protocol                                        | strategies → corpus harvest (OpenAlex, lab KG)     | –        |
| B2  | Screening at scale (R1)                                                                                                                                | screening.ts, PRISMA                                   | relevance, quality, reason per paper; auto-buckets | **yes**  |
| B3  | Knowledge cards                                                                                                                                        | extraction matrix, paper model / abstract              | card per included paper                            | –        |
| C1  | Synthesis: theme clusters and research gaps with evidence                                                                                              | cards, corpus keywords, SCG roadmap                    | themes.json, gaps → Topic and research gaps        | –        |
| C2  | Hypotheses: falsifiable, with prediction and failure condition; critique by three reviewers (novelty against the lab KG, feasibility, soundness)       | lab KG search, SCG                                     | ranked ideas → Research questions and hypotheses   | **yes**  |
| D1  | Experiment design: datasets, baselines, methods, ablations, metrics, risks, compute                                                                    | Research design sections, Writing Bank designs/metrics | filled Design / Measurement / Analyses / Runs      | **yes**  |
| D2  | Freeze the plan → SRD                                                                                                                                  | Gói kế hoạch, /v1/projects plans                       | frozen plan                                        | (exists) |
| F1  | Import the results log from SRD or a file; analysis with exact numbers; decision proceed / refine / pivot                                              | –                                                      | analysis.md                                        | **yes**  |
| G1  | Outline in PaperOrchestra form (plotting_plan, intro_related_work_plan, section_plan with citation hints), shaped by the journal profile and blueprint | Writing Bank                                           | outline.json                                       | **yes**  |
| G2  | Literature for Intro and Related Work: only screened and verified papers, citation_map with keys, ≥ 90% coverage                                       | corpus, reference audit                                | intro_related.md, references.bib                   | –        |
| G3  | Section drafting from the plan and the results log                                                                                                     | –                                                      | draft (Markdown + LaTeX)                           | –        |
| G4  | Review and refine: 2 reviewers, scores 1–10, methods vs evidence check; keep only revisions that raise the score; max 3 rounds                         | journal profile, /v1/measure                           | revised draft, review log                          | **yes**  |
| H1  | Citation verification (4 layers) and export (LaTeX/Markdown/ZIP)                                                                                       | reference audit                                        | package                                            | –        |

## Slices

- **R1 Screening at scale** (now). Batched LLM triage of every unscreened paper in a corpus or project.
  - Each paper gets `relevance` and `quality` (0–1), a reason and a matched criterion, graded against the protocol's inclusion and exclusion criteria.
  - Batches hold 15–20 papers, cost is estimated before running, and runs can be stopped and resumed.
  - Thresholds put papers into Chọn / Loại / Chưa chắc. The user reviews the buckets and applies them in bulk. Nothing is applied without the user's confirmation.
  - The list can be sorted and filtered by score.
  - Disagreement sampling: a few borderline papers are flagged for a person to check.
  - The PRISMA counts stay correct.
- **R2 Run model, stages A1/B1/B3.** The Research run record and its stage UI, plus the search strategy and knowledge cards.
- **R3 Synthesis and ideas (C1/C2).** Themes, gaps and hypotheses, with the critique panel and the novelty check against the lab KG.
- **R4 Experiment design (D1)** fills the Research design sections.
- **R5 Writing (G1–G4, H1)** in the PaperOrchestra style, with Writing Bank profiles. F1 (results import) comes before it.
