# Prompts for paper-level AI Review

Source of the starting point: the AI reviewer prompt in Baumann et al. 2026 (arXiv 2605.03202, App. B.1), itself based
on the Agents4Science 2025 prompt. Below: what we keep, what we change and why, and the adapted prompts. Every prompt
is versioned in `src/core/prompts` and its output is validated with Zod; quotes are anchored by code.

## 1. Review of the reference reviewer prompt

| Original instruction                                                                                    | Keep / change                                                                                                      | Reason (from the paper's findings or our invariants)                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "You are the best reviewer in the world … only the best of the best papers get accepted"                | **Remove**                                                                                                         | Persona inflation pushes toward generic severity; adds no information                                                                                                        |
| "If a paper is bad and you are unsure, reject it; if good and unsure, accept it"                        | **Remove**                                                                                                         | Decision rule; we never decide. Uncertainty must be stated, not resolved by the model                                                                                        |
| "You might have access only to the first part of the paper"                                             | **Replace**                                                                                                        | We send known sections; the prompt states exactly which sections are present and which are not                                                                               |
| Dimensions: Quality, Clarity, Significance, Originality, Reproducibility, Ethics/Limitations, Citations | **Keep, split**                                                                                                    | Useful coverage list. Clarity is assessed by our pipeline (S5–S9); Originality and Significance need field knowledge the model may lack → marked "low confidence by default" |
| `<summary> <strengths> <weaknesses> <questions>` XML                                                    | **Replace with JSON**                                                                                              | Validated with Zod; each point carries quotes and IDs                                                                                                                        |
| `<rating>1.0–10.0</rating>`                                                                             | **Remove**                                                                                                         | Ratings are inflated, gameable by laundering, and less informative than human ratings (§3.5, §4)                                                                             |
| "Be constructive … reward authors for being upfront about limitations"                                  | **Keep**                                                                                                           | Matches our tone rules                                                                                                                                                       |
| — (missing)                                                                                             | **Add**: cite a verbatim quote per point; no templated phrasing; separate writing from science; say "cannot judge" | Hivemind / template reuse (App. D); invariants on separate fields and candidates                                                                                             |

## 2. Reviewer panel prompt — `paper-review-1`

One call per lens (run sequentially or in parallel within the rate limit). Lenses (each a short paragraph added to
the system prompt): `methods_skeptic`, `clarity_editor` (Schimel), `reproducibility_auditor`, `newcomer_reader`
(an informed reader outside the subfield), `limitations_ethics`. Optionally a different model per lens when the user
configures more than one.

System (English):

```
You are one reviewer in a panel that helps authors improve a manuscript before submission.
Your lens: {lens_description}. Other reviewers cover other lenses; do not try to cover everything.

Rules:
- You advise the authors. You do not decide acceptance and you do not give an overall rating.
- Every point must quote the manuscript verbatim (5–40 words) in "quote" and name the paragraph id it comes from.
  If you cannot quote supporting text, put the point in "unanchored" and say why.
- Be specific to this manuscript. Do not use stock phrases that would fit any paper
  (for example "honest discussion of limitations", "it is not fully clear whether", "there is no comparison to")
  unless you immediately say exactly what is missing and where.
- Keep separate: writing clarity, scientific soundness, reproducibility, and ethics/limitations.
- Do not invent results, numbers, citations, experiments or proofs, and do not suggest that the authors add
  results they have not reported. You may ask for evidence ("needs_evidence").
- Prefer fewer, consequential points over many minor ones. Say "cannot judge" when the provided sections or your
  knowledge are insufficient (for example novelty without the related-work landscape).
- Write "point" and "rationale" in Vietnamese; keep quotes in the manuscript's language.

Sections provided: {section_list}. Sections not provided: {missing_sections}.
Deterministic check results (already verified by code): {verifiable_check_summary}.
```

User: the paper map (`id | section role | heading`) followed by the text of the provided paragraphs as
`secN_pM | "paragraph text"`.

Output (Zod):

```
{ lens, summary: string,                       // 2–3 sentences, Vietnamese
  points: [{ kind: 'strength'|'weakness'|'question'|'needs_evidence',
             dimension: 'soundness'|'clarity'|'reproducibility'|'significance'|'originality'|'limitations_ethics'|'citations',
             paragraphId, quote, point, rationale, severity: 'minor'|'moderate'|'major', confidence: 0..1 }],
  unanchored: [{ point, reason }],
  cannotJudge: [{ dimension, reason }] }
```

Code then: anchors each `quote` inside the named paragraph (exact, then whitespace-normalised); a quote that
cannot be found → moved to `unanchored`; computes panel similarity and template flags (§4); merges duplicate points
across lenses (same anchor ± overlapping quote) while keeping which lenses raised them.

## 3. Section-aware variants of the paragraph prompts

- `cand-judge-paper-1`: adds `Section role: {role}. Conventions: {conventions}` where conventions are short,
  per-role notes (Methods: passive voice and procedure verbs such as "were conducted" are normal; Results: report
  values with units and statistics, avoid interpretation words; Abstract: compact, no citations; Discussion:
  hedging is expected).
- `para-struct-paper-1`: adds `Previous paragraph ends with: "…"` and `Next paragraph starts with: "…"`, plus the
  section role; Schimel structures stay the same; `context_limited` is false when both neighbours exist.
- `sent-syntax-paper-batch-1`: identical rules, batched by section (≤ 40 sentences), heading included. Paragraphs sharing a request get unique sentence ids and token numbers, which code restores before validation.

## 4. Diversity and template metrics (code, no extra model call)

- **Panel similarity (IntraSim-like)**: TF-IDF cosine between the lenses' weakness/question texts (computed
  locally; no embedding endpoint is assumed). Show the mean and flag pairs above 0.8 as "trùng ý".
- **Template phrases**: extract 6–12-word n-grams from review points; keep a local store across papers the user has
  reviewed; a phrase seen in ≥ 3 different papers is flagged "cụm khuôn mẫu".
- **Anchoring rate**: anchored points / all points; shown with every review.

## 5. Style-only rewrite for the robustness probe — `style-probe-1` (P6)

Purpose: test whether **our scorer** rewards style rather than content. Never offered as "improve my score".

```
Rewrite the paragraph changing only surface style: word order, sentence boundaries, connectives and word choice.
Keep every claim, number, unit, citation, hedge, negation and technical term exactly. Do not add or remove
information, do not make claims more confident, do not add sections, results or answers.
Return the rewritten paragraph only.
```

Code runs the S10 meaning-preservation checks on the result; a probe whose checks fail is discarded. The report
shows the score change per paragraph; a mean change above a threshold (default ±5 points) marks the scorer as
style-sensitive for that paper and the score view shows a warning.

## 6. What we deliberately do not build

- The paper's laundering prompts (App. B.2) or anything that rewrites a paper to maximise a reviewer score.
- An overall rating, acceptance prediction or ranking of papers.
