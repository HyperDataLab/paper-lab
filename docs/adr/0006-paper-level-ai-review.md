# ADR-0006: Paper-level AI Review as an advisory module group

Status: **accepted with defaults** (2026-11-07). The owner asked to continue the pending work and to review and adjust afterwards; the defaults below are Claude's recommendations and can be changed by the owner.

## Context

The owner asked for a new feature group: upload a whole paper and get an AI analysis and review. The PRD (v1.1)
covers one paragraph and lists manuscript-level OCAR–IMRaD assessment as out of scope (§11, "handled by PSSU").
paper-understanding already parses PDFs in the browser. Baumann et al. (ICML 2026, arXiv 2605.03202) show that
current AI reviewers converge on the same feedback (hivemind) and that their scores can be raised by style-only
rewrites (paper laundering), and recommend robustness testing, validated precision and transparency before use.

## Decision (proposed)

1. Add a module group "Phân tích bài báo" to PaperLab (P1–P7 in `docs/plans/AI-REVIEW.md`), reusing the
   paper-understanding PDF parser and segmenter code; add `pdfjs-dist` as a dependency.
2. The AI review is advisory: no rating, no acceptance prediction, no paper-level total score; every point is
   anchored to a verbatim quote; deterministic checks precede LLM judgement; checks are gated by calibration.
3. Reviews come from several lenses and report diversity, template-phrase and anchoring metrics.
4. A robustness probe tests the scorer's sensitivity to style-only rewrites; we do not build score-maximising
   rewriting.
5. Write a PRD v1.2 addendum that moves manuscript-level analysis into scope for this group.

## Consequences

- New dependency and larger local storage (Dexie) for whole papers; the PDF stays in the browser.
- More 9router calls; needs a queue with budget, checkpoints and caching (P2).
- Needs human-labelled data for calibration before checks are shown by default (P7).
- Alternative considered: build in paper-understanding (it already has PDFs and Firebase). Rejected for now because
  the analysis pipeline (S2–S9) lives here; revisit if the two apps merge.
