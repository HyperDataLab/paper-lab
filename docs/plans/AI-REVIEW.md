# Plan — AI Review at paper level

Status: **accepted with defaults** (2026-11-07; owner to review and adjust). Decision record: `docs/adr/0006-paper-level-ai-review.md`.
Adapted prompts: `docs/prompts/ai-review.md`. First slice brief: `docs/briefs/P1.md`.

## 1. Goal

The user uploads a whole paper; the system splits it, runs the paragraph pipeline (S2–S9) across it, adds
paper-level checks, and produces an **advisory** AI review that the user reads, verifies and edits. The output
helps authors improve a manuscript before submission. It is never an accept/reject decision.

## 2. What the reference paper tells us (Baumann, Pei, Koyejo, Hovy — ICML 2026, arXiv 2605.03202)

| Finding                                                                                      | Evidence in the paper                                                                                                                                                                    | Consequence for this product                                                                                                                         |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hivemind effect**: AI reviews agree far more than humans, within a paper and across papers | IntraSim +8.7 – 9.8 %, InterSim up to +39.8 %; AI reviewers reuse the same phrases in 13–22 % of papers vs < 1 % for humans (App. D)                                                     | Several reviewer _lenses_, not one generic reviewer; measure panel similarity; flag templated phrases; every point must cite the paper               |
| **Paper laundering**: an LLM rewrite raises AI scores without better science                 | +0.45 mean score (p < 0.0001); laundered papers become more alike (d = 1.02); rewrites add confident wording, fabricated ablations, unproved theorems, "answers to reviewers" (App. E.1) | No 1–10 rating. Test our own scorer for style sensitivity. Detect "illusion of thoroughness" (claims without supporting tables, proofs or citations) |
| AI scores are inflated (mean 7.3 GPT, 6.1 Claude) and less informative about decisions       | §3.5                                                                                                                                                                                     | Show distributions and evidence, never a single headline score for the paper                                                                         |
| Error-detection tools have high false-positive rates (up to 35 %)                            | §6.1 Req. 2                                                                                                                                                                              | A check is shown by default only after it passes a calibration threshold; otherwise "thử nghiệm"                                                     |
| Verifiable tasks (formatting, references) suit AI; judgement tasks do not                    | §6.1                                                                                                                                                                                     | Do verifiable checks deterministically first; the LLM explains, it does not decide                                                                   |
| Transparency: publish prompts, model versions, integration                                   | §6.1 Req. 3                                                                                                                                                                              | Every result stores model, prompt version, rubric version; the report includes a transparency section                                                |
| Over-reliance: humans defer to AI suggestions                                                | §6.3                                                                                                                                                                                     | Human-first mode: the user writes their own notes before seeing the AI review; agreement is tracked                                                  |

The paper's reviewer prompt (App. B.1) is a useful dimension list (Quality, Clarity, Significance, Originality,
Reproducibility, Ethics and Limitations, Citations) but several instructions are harmful in our setting — see
`docs/prompts/ai-review.md` §1 for each change and why.

## 3. Pipeline

```
PDF / LaTeX / Markdown (stays in the browser)
  → P1 Import and paper map: pages → sections (IMRaD role) → paragraphs → sentences, stable IDs (sec2_p03_s1)
  → P2 Batch paragraph pipeline: S2 split + S6 detectors on every paragraph (free, local);
       S5 syntax, S6 judge, S8 structure, S9 scoring on selected sections, section-aware prompts,
       queue with checkpoints, budget, pause/resume, cache by paragraph hash
  → P3 Paper-level aggregation: per-section distributions, recurring issues, paragraph-to-paragraph flow
  → P4 Verifiable checks (deterministic): citations ↔ references, numbers across abstract/results,
       figure/table references, acronyms, hedging drift, unsupported-claim detector
  → P5 AI reviewer panel (advisory): several lenses, every point anchored to a quoted span, no rating,
       diversity and template metrics, human-first mode
  → P6 Score robustness probe: style-only rewrite of sample paragraphs → re-score → sensitivity report
  → P7 Calibration and transparency: benchmark, precision / false-positive rate per check, gating, report section
```

## 4. Slices (each one PR, Codex builds, Claude accepts)

| #   | Slice                                                                                  | Depends on | Main risks                                                                                 |
| --- | -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| P1  | Paper import and map (PDF.js in a worker, LaTeX/Markdown, IMRaD roles, Dexie `papers`) | —          | PDF layout noise; needs `pdfjs-dist` (new dependency, already used in paper-understanding) |
| P2  | Batch paragraph pipeline with section-aware prompts                                    | P1, S9     | 9router cost and rate limits; long runs                                                    |
| P3  | Paper-level aggregation and inter-paragraph flow                                       | P2         | Readable summary of hundreds of findings                                                   |
| P4  | Verifiable checks                                                                      | P1         | False positives — gate by P7                                                               |
| P5  | AI reviewer panel + diversity metrics + human-first mode                               | P2, P4     | Hivemind, over-reliance                                                                    |
| P6  | Score robustness probe                                                                 | S9, S10    | Must never become a "boost my score" tool                                                  |
| P7  | Calibration and transparency                                                           | P4, P5     | Needs human-labelled data                                                                  |

## 5. Changes to the existing prompts and processes for paper scale

| Existing                                 | Problem at paper scale                                                       | Change                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sent-syntax-1`, 12 sentences per call   | ~1 500 sentences → ~125 calls                                                | `sent-syntax-paper-1`: batch by token budget (≤ 40 sentences, one section at a time), section heading in the prompt, skip captions/equations/reference list, cache by sentence hash |
| `cand-judge-1`                           | Does not know the section; procedure verbs and passive are normal in Methods | `cand-judge-paper-1`: pass section role (Abstract, Introduction, Methods, Results, Discussion…) and the section's conventions; batch per section                                    |
| `para-struct-2`, `context_limited: true` | The previous and next paragraphs now exist                                   | `para-struct-paper-1`: give the last sentence of the previous paragraph and the first of the next, and the section role; `context_limited` false when both exist                    |
| `score-2` per paragraph                  | A paper needs an overview, not an LLM "overall"                              | Keep per-paragraph scoring; the paper view shows code-computed distributions (median, IQR per section) and coverage; no paper total                                                 |
| `revise-1` (S10)                         | —                                                                            | Reused unchanged for author-requested fixes; the robustness probe (P6) uses a separate, style-only prompt that forbids any content change                                           |
| Consent text                             | Written for one paragraph                                                    | New consent version for whole-manuscript processing (unpublished work), stating what is sent and where                                                                              |

## 6. Product rules (binding for P1–P7)

1. The AI review is **advisory**: no accept/reject, no 1–10 rating, no paper-level total score.
2. Every review point quotes the paper; code anchors the quote to a paragraph/sentence ID. Unanchored points are
   shown separately as "chưa xác định vị trí" and cannot be confirmed.
3. Writing quality, scientific soundness, verifiability and ethics stay separate fields (never one blended score).
4. Deterministic checks first; LLM output is a candidate until a human confirms it.
5. Never generate content that adds data, results, proofs, citations or answers to imagined reviewers.
6. Store and show model, prompt and rubric versions; include them in exports.
7. The paper never leaves the browser except the text chunks sent to the configured LLM after consent.

## 7. Decisions (defaults taken 2026-11-07, owner may change)

1. **Where it lives.** PRD §11 puts manuscript-level OCAR–IMRaD assessment out of scope ("handled by PSSU") and
   paper-understanding already parses PDFs. Recommended: a new module group "Phân tích bài báo" in Paragraph Lab
   that reuses the paper-understanding parser code; record it as ADR-0006 and a PRD v1.2 addendum.
2. **Cost ceiling** per paper for 9router calls (P2 default: local detectors on everything, LLM steps on chosen
   sections).
3. **Calibration data**: who labels the first benchmark set (P7).

Defaults in use until the owner decides otherwise: (1) the group lives in Paragraph Lab and reuses the
parser code; (2) LLM steps run only on sections the user selects, with a visible per-run call estimate and a
configurable ceiling (default 150 calls per paper); (3) P7 starts with an import format for human labels and no
check is shown by default until it has labelled data.
