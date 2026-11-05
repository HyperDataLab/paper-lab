# PRD — Scientific Writing & Scientific Writing Evaluation (Paragraph-first)

**Version:** 1.1  
**Status:** Draft for implementation  
**Input unit:** One scientific paragraph (English)  
**Modules:** (1) Scientific Writing, (2) Scientific Writing Evaluation  
**Theoretical basis:** Joshua Schimel, _Writing Science_ (2012), Chapter 11 (Paragraphs), Chapters 12–16 (Sentences; Flow; Energizing Writing; Words; Condensing).  
**Important distinction:** Schimel provides qualitative writing principles; thresholds, scores, algorithms and issue-severity levels below are **product-design proposals requiring empirical calibration**, not metrics claimed by the book.

## 1. Goal and user journey

The user pastes **one paragraph**. The system analyzes each sentence and relations between adjacent sentences, returns an **overall score and dimension scores**, and displays issues highlighted directly in the original text. Every issue explains _what is wrong, where, why and how to fix it_. The user can select an issue or accept a proposed revision; the Writing module creates a revised version while preserving claim, evidence and epistemic certainty. Both versions can be re-evaluated.

**Core workflows**

- **EVALUATE:** Paragraph → sentence segmentation → linguistic annotation → quantitative signals → context-aware assessment → highlights + rubric + evidence.
- **REVISE:** Paragraph + selected issues / user constraints → revised paragraph + change log → evaluation comparison.
- **GENERATE:** Research claim + supplied evidence + intended rhetorical function → paragraph draft → evaluation.

**Scope:** English-language scientific prose. Retain a small amount of user-supplied surrounding context if available, but do not require full paper. Indicate `context_limited` whenever insufficient context prevents reliable conclusions about old/new information, jargon or paragraph fit.

## 2. Module A — Scientific Writing

**Responsibility:** Compose, rewrite and refine a paragraph; do not assign authoritative evaluation scores.

| ID    | Requirement                                                                                                                            | Priority |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| WR-01 | Generate one scientific paragraph from main claim, supplied facts/evidence, target audience, optional structure TS-D / LD / LDR / OCAR | P1       |
| WR-02 | Rewrite an existing paragraph according to a subset of selected evaluation issue IDs                                                   | P0       |
| WR-03 | Improve Topic–Action–Stress positions and subject–main-verb proximity without damaging meaning                                         | P0       |
| WR-04 | Improve transitions, thematic unity and stress→topic information flow across sentences                                                 | P0       |
| WR-05 | Review fuzzy verbs, active/passive choice, nominalizations, jargon, redundant words and unnecessary modifiers                          | P0       |
| WR-06 | Preserve data, references, quantitative results, negation, hedging, modality and claim strength                                        | P0       |
| WR-07 | Return revised paragraph, aligned changes (`before`/`after` spans), applied issue IDs and rationale                                    | P0       |
| WR-08 | Never insert missing scientific evidence or fabricate quantitative values; use `needs_evidence` instead                                | P0       |

**Input:** `paragraph_text`, `mode: generate|revise`, optional `main_claim`, `evidence[]`, `audience`, `paragraph_structure`, `selected_issue_ids[]`, `preserve_terms[]`.

**Output:** `revised_text`, `changes[]`, `unresolved_issues[]`, `meaning_preservation_checks`, `needs_evidence[]`. Changes should be minimal and reversible; user approval is required before replacing the original paragraph.

## 3. Module B — Scientific Writing Evaluation

**Responsibility:** Annotate, measure, assess and explain the quality of the paragraph and its sentences; **do not alter the source text**.

| ID    | Requirement                                                                                                              | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| EV-01 | Segment paragraph into sentences; tokenize, POS-tag, lemmatize, dependency-parse; preserve exact source offsets          | P0       |
| EV-02 | Identify candidate Topic, Action (main predicate), Stress/information focus with evidence and confidence                 | P0       |
| EV-03 | Detect subject–main-verb separation, lengthy pre-subject front matter, clause nesting and overloaded sentences           | P0       |
| EV-04 | Analyze active/passive voice, fuzzy verbs, nominalizations and contextual action clarity                                 | P0       |
| EV-05 | Analyze adjective/adverb function: redundant intensifiers vs meaningful qualifiers; flag only context-supported problems | P0       |
| EV-06 | Analyze terminology, excessive jargon, ambiguous wording, redundant phrases and metadiscourse                            | P1       |
| EV-07 | Infer paragraph structure (TS-D / LD / LDR / OCAR / UNKNOWN), central point, sentence roles and unity                    | P0       |
| EV-08 | Analyze thematic continuity and topic-topic, stress-topic links between adjacent sentences                               | P0       |
| EV-09 | Produce quantitative metrics, dimension scores, uncertainty, coverage and evidence-linked issue spans                    | P0       |
| EV-10 | Highlight problem locations directly in paragraph; click reveals metrics, explanation and suggested revision             | P0       |
| EV-11 | Accept reviewer feedback: confirm / dismiss / edit span, label, severity; keep audit log                                 | P0       |
| EV-12 | Export JSON and human-readable evaluation report; allow re-evaluation and version comparison                             | P1       |

## 4. Analysis dimensions & proposed metrics

All normalized scores should be expressed on **0–100 (higher = better)**. Raw signals remain separately available and must **not** be treated as errors without contextual judgment.

| Dimension               | Raw metric / signal                | Operational definition (proposal)                                                                                                                                                                        | What can be highlighted                         |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Sentence structure**  | `subject_verb_distance_tokens`     | Number of intervening surface tokens between the **end of the main-clause subject span** and **start of its governing main verb**. Record negative/NA for atypical order and do not penalize by default. | Intervening phrase and/or detached subject+verb |
|                         | `dependency_path_subject_verb`     | Number of dependency edges, optionally computed as syntactic complexity signal, not equivalent to linear word distance.                                                                                  | Subject / verb anchors                          |
|                         | `pre_topic_tokens`                 | Tokens before inferred Topic head or span; inspect long introductory material, not every adverbial                                                                                                       | Preposed introductory span                      |
|                         | `clause_count`, `max_clause_depth` | Count of finite clauses, maximum subordinate nesting based on parser                                                                                                                                     | Dense subordinate clause                        |
|                         | `topic_position_ratio`             | Topic start character offset / total sentence length                                                                                                                                                     | Topic span                                      |
|                         | `stress_end_distance`              | Tokens from end of putative stressed content to sentence end; candidate-only, verified semantically                                                                                                      | Trailing low-value text                         |
| **Verb quality**        | `passive_clause_ratio`             | Passive clauses / all analyzable finite clauses. Descriptive only: passive is not an automatic violation                                                                                                 | Passive construction only when problematic      |
|                         | `fuzzy_verb_occurrences`           | Context-reviewed vague verb expressions from customizable lexicon + semantic assessment                                                                                                                  | Specific predicate                              |
|                         | `nominalization_candidates`        | Nominalized action nouns with a plausible verb rewrite; review for terminological necessity                                                                                                              | Noun phrase                                     |
| **Word choice**         | `weak_modifier_candidates`         | Adjectives/adverbs whose removal leaves intended proposition materially unchanged, subject to contextual check                                                                                           | Individual modifier                             |
|                         | `unsupported_intensifier_count`    | Intensifiers suggesting magnitude without quantification _when a quantitative claim is intended_                                                                                                         | Modifier / assertion                            |
|                         | `jargon_unexplained_candidates`    | Unexplained terms inappropriate for provided audience; cannot determine solely from word frequency                                                                                                       | Term span                                       |
|                         | `redundant_phrase_count`           | Semantically duplicative phrases identified with source evidence                                                                                                                                         | Duplicated words                                |
| **Paragraph structure** | `paragraph_structure_type`         | TS-D, LD, LDR, OCAR, UNKNOWN; probabilistic classification, not forced                                                                                                                                   | Sentence role badges                            |
|                         | `central_point_identifiability`    | Rater/LLM rubric 0–4 with evidence of paragraph's principal point                                                                                                                                        | Claim or missing/weak location                  |
|                         | `sentence_role_coverage`           | Fraction of sentences assigned a justified functional role                                                                                                                                               | Whole sentence when unsupported                 |
|                         | `off_topic_sentence_count`         | Sentences not serving central point after context-aware review                                                                                                                                           | Whole sentence                                  |
| **Flow & coherence**    | `adjacent_topic_similarity`        | Semantic similarity of adjacent inferred topics; descriptive, not a quality score by itself                                                                                                              | Topic pair                                      |
|                         | `stress_to_next_topic_alignment`   | Contextual semantic overlap between preceding Stress and next Topic, with coreference/synonym matching                                                                                                   | Linked spans across sentences                   |
|                         | `topic_continuity_pattern`         | Pattern of repeated, derived or shifted topics; allow meaningful lists and parallel structures                                                                                                           | Topic pairs                                     |
|                         | `unexplained_topic_shift_count`    | Discontinuities without motivated rhetorical or discourse relation                                                                                                                                       | Transition between sentences                    |
|                         | `discourse_relation_coverage`      | Proportion of adjacent pairs with defensible relation, e.g. elaboration, cause, contrast, example                                                                                                        | Adjacent sentence pair                          |

**Distance specifics:** Count punctuation separately only if parser treats it as tokens; for `subject_verb_distance_tokens` explicitly **exclude punctuation** and preserve `tokenizer_version`. Also store `subject_head_token_index`, `subject_span`, `verb_head_token_index`, `verb_span` and `intervening_span`. Non-contiguous or parser-ambiguous spans return `null` with confidence rather than a fabricated distance.

**Examples of candidate rules requiring calibration, not fixed universal limits:**

- Subject–verb gap: `>= 8` intervening nonpunctuation tokens → _review candidate_; `>= 15` → _high-priority review candidate_. These are UI triage heuristics, not a Schimel threshold or automatic violation.
- Clause complexity: `max_clause_depth >= 3` → _review candidate_, not an automatic error.
- Unsupported intensifier (`dramatically`, `very`, `highly`, etc.) → highlight only if rhetorical function is weak and removing it preserves the intended claim. Necessary qualifiers such as `preliminary`, `statistically significant` and carefully justified hedges must be preserved.

## 5. Scoring framework (proposal; validation required)

| Dimension                            |   Weight | Sources        |
| ------------------------------------ | -------: | -------------- |
| Sentence structure                   |      25% | Schimel Ch. 12 |
| Verb & word choice                   |      20% | Ch. 14–15      |
| Conciseness & modifier effectiveness |      15% | Ch. 16         |
| Paragraph organization               |      20% | Ch. 11         |
| Flow & coherence                     |      20% | Ch. 13         |
| **Total**                            | **100%** |                |

**Evaluation rubric** for each dimension: `0` not supported / major structural breakdown, `1` substantial problems, `2` mixed, `3` good, `4` highly effective. Scores require a rubric descriptor, supporting evidence and confidence; numeric score = `raw_rubric / 4 * 100` (or a later calibrated mapping). Overall score is a weighted mean of **applicable** dimensions, weights renormalized if a dimension is explicitly `not_assessable`. Always display `assessment_coverage`, `confidence` and `context_limited` alongside scores; do not compute a precise total if too many dimensions are unassessable (initial configuration: 2 or more).

Do **not** use counts alone as direct score deductions (e.g. penalizing all passive verbs or long sentences). Prioritize recurring, consequential issues over incidental stylistic differences. Human judgments should be used to calibrate thresholds and establish reliability; inter-rater agreement should be monitored.

### Suggested issue severity

- `critical`: Distorts scientific meaning, evidence or claim strength (usually requires human review).
- `major`: Substantially obstructs comprehensibility or paragraph coherence.
- `moderate`: Noticeable readability problem with clear evidence.
- `minor`: Optional improvement; do not present as a proven violation.
- `info`: Structural annotation / observation only.

**Status distinction:** `candidate` → `confirmed_by_model` → `confirmed_by_human` / `dismissed_by_human`. `confirmed_by_model` never means externally verified scientific truth.

## 6. Highlight and annotation UX

**Layout:** (A) editable paragraph editor with precise text spans, (B) sentence/paragraph metric panel, (C) selected finding inspector, (D) before/after diff.

- Color code by **issue category**; use underline/outline or markers as well, not color only. Example: orange = grammar/structure, purple = flow, blue = word choice; red reserved for severe meaning issues.
- Highlight the **smallest causal span** possible: weak adverb, fuzzy verb, intervening subject–verb phrase, dangling phrase; if the defect is a relationship, highlight both endpoint spans and draw a connection (Stress of sentence N → Topic of N+1).
- Selecting an issue scrolls to and highlights the exact source span, displays `metric_name`, `observed_value`, `reference_rule`, `severity`, `confidence`, `why`, `suggested_fix` and `source_principle` (book chapter/section).
- Show a tiny subtext or badge under each sentence for **Topic / Action / Stress** and sentence role (Topic Sentence / Development / Lead / Resolution etc.), with uncertain spans visibly marked.
- Offer filters `All | Confirmed | Candidates | Sentence | Flow | Word Choice`; users can hide low-confidence suggestions.
- Handle overlapping highlights using stacked annotations or click-to-cycle; never rewrite, trim or normalize original text offsets silently.
- Track whether a finding is a **confirmed rule violation**, **review candidate**, or **stylistic suggestion**; default to the latter when evidence is inconclusive.

### Example of highlighted paragraph (illustrative, not copied from Schimel)

Original:

> The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant. Several experiments were conducted to evaluate the system.

Illustrative highlights:

| Span                                               | Finding                        | Metric                                 | Review rationale                                                                                           |
| -------------------------------------------------- | ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `after extensive testing across multiple datasets` | `SUBJECT_VERB_GAP`             | Measured gap between subject and `was` | Interrupts subject–predicate continuity; inspect whether moving phrase improves reading                    |
| `dramatically`                                     | `UNSUPPORTED_INTENSIFIER`      | 1 candidate                            | Suggest magnitude without a concrete effect size; request supporting result, do not invent it              |
| `very`                                             | `WEAK_MODIFIER`                | 1 candidate                            | Adds emphasis without specificity                                                                          |
| `were conducted`                                   | `FUZZY_VERB_OR_NOMINALIZATION` | Context-review                         | The action may be weakly communicated; may be appropriate in Methods depending on context                  |
| Sentence 2 → Sentence 3                            | `FLOW_BREAK_CANDIDATE`         | Semantic/discourse linkage assessment  | Abrupt transition from general claim to experimental procedure; may need evidence from surrounding context |

_Note:_ The first example can involve substantial subject-span ambiguity (`The performance of the proposed model`) and the parser should retain exact offsets and a confidence estimate. The issue is about communication and placement, not an absolute grammatical prohibition.

## 7. Minimal API and JSON contracts

### `POST /api/writing/evaluate`

Request:

```json
{
  "paragraph_text": "The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant.",
  "language": "en",
  "target_audience": "specialist",
  "context_before": null,
  "context_after": null,
  "rubric_version": "schimel-paragraph-v1"
}
```

Response (example with offsets aligned to the full input paragraph; production must compute them deterministically):

```json
{
  "analysis_id": "analysis_001",
  "source_text": "The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant.",
  "source_hash": "sha256:...",
  "offset_unit": "unicode_codepoint",
  "context_limited": true,
  "sentence_annotations": [
    {
      "id": "s1",
      "start": 0,
      "end": 115,
      "topic_span": { "start": 0, "end": 37 },
      "action_span": null,
      "stress_span": null,
      "subject_verb_distance_tokens": 6,
      "parse_confidence": 0.86
    }
  ],
  "paragraph_structure": { "type": "UNKNOWN", "confidence": 0.45 },
  "metrics": {
    "avg_subject_verb_distance_tokens": 6,
    "passive_clause_ratio": 1.0,
    "unexplained_topic_shift_count": null
  },
  "dimension_scores": [{ "id": "sentence_structure", "score": 62.5, "confidence": 0.7, "applicable": true }],
  "overall_score": null,
  "assessment_coverage": 0.2,
  "issues": [
    {
      "id": "issue_001",
      "type": "SUBJECT_VERB_GAP",
      "status": "candidate",
      "severity": "moderate",
      "spans": [{ "start": 39, "end": 87, "role": "intervening_phrase" }],
      "sentence_ids": ["s1"],
      "metric": { "name": "subject_verb_distance_tokens", "value": 6, "unit": "tokens" },
      "why": "Long inserted phrase separates the main-clause subject from its predicate.",
      "suggested_fix": "Move the inserted detail after the main predication if that preserves meaning.",
      "source_principle": "Schimel Ch. 12, §12.4",
      "confidence": 0.78
    }
  ]
}
```

**Strict production invariant:** All `start`/`end` values MUST be calculated (not LLM-guessed) and validated against `source_text`, with exclusive `end`. The example source spans match the example source text; scoring, parse confidence and any inferred syntactic or rhetorical labels remain illustrative pending model execution. Store string offsets in a declared unit and convert consistently for browser DOM rendering (UTF-16 conversions may be required).

### `POST /api/writing/revise`

Request: `{ "analysis_id": "analysis_001", "selected_issue_ids": ["issue_001"], "constraints": { "preserve_claims": true, "preserve_hedging": true, "no_new_facts": true } }`.

Response: `{ "revised_text": "...", "changes": [{ "issue_id": "issue_001", "original_span": {"start": 0, "end": 0}, "new_span": {"start": 0, "end": 0}, "reason": "..." }], "needs_evidence": [], "requires_user_approval": true }`.

### `POST /api/writing/generate`

Request: claim, evidence supplied by user, audience, paragraph_structure; response follows Revision output, with generated paragraph and provenance of input facts.

## 8. Suggested processing pipeline

1. **Input validation:** retain exact paragraph text; enforce length and language constraints; assign source hash.
2. **NLP parsing:** split into sentences; POS/dependency parse; identify subject, governing predicate, modifier and clause spans.
3. **Rhetorical annotation:** detect Topic, Action, Stress and paragraph structure using context-aware model; attach confidence and evidential spans.
4. **Metric calculation:** deterministic token counts, character spans, subject–verb distance; semantic similarity/discourse metrics with model version.
5. **Candidate generation:** threshold/rule detectors create review candidates, not automatic violations.
6. **Contextual evaluation:** LLM/rubric judges intended scientific meaning, proper use of passive/hedging and whether candidate is actually problematic.
7. **Scoring and evidence:** issue-linked criteria, dimension-level scores, uncertainty and assessment coverage.
8. **Highlight rendering:** map issue spans to immutable original, show per-sentence subtext and issue inspector.
9. **Human adjudication:** confirm / dismiss / revise annotation; log annotation version.
10. **Revision loop:** selected issues → Writing skill → diff → meaning-preservation checks → reevaluation.

## 9. Non-functional requirements

- **Traceability:** Every finding references exact source offsets and the source principle or product rubric rule.
- **Quantification:** Report counts, ratios, positional metrics, scores and uncertainties with denominators and calculation versions.
- **Precision:** Never highlight an ungrounded or invalid offset; invalid spans must be suppressed and logged.
- **Meaning safety:** Preserve references, numbers, claims, uncertainty/hedging, negation and scientific qualifiers.
- **Explainability:** Distinguish observed metrics, contextual inferences and revision suggestions.
- **Human control:** Original text unchanged until user approves rewrite; reversible decisions and audit log.
- **Accessibility:** Highlights must have labels/tooltips and non-color visual markers.
- **Versioning:** Rule set, tokenizer, parser, model, prompts, scoring calibration and source hash captured for reproducibility.
- **Privacy:** Follow deployment policy for submitted unpublished manuscripts; do not send text to external services without configured authorization.

## 10. MVP acceptance criteria

1. A user can paste one paragraph and receive sentence boundaries and exact source-aligned annotations.
2. Subject–verb distances are computed reproducibly for parsable main clauses; uncertain cases return `null`.
3. The system can detect and highlight candidate issues involving subject–verb gaps, fuzzy verbs, unnecessary modifiers and wordiness.
4. Each issue has `type`, `spans`, `severity`, `status`, `metric`, `rationale`, `confidence` and literature/rubric provenance.
5. Flow issues can refer to **two linked sentence spans**; they are not forced into a single-token highlight.
6. The user can click a highlight to see the exact measured value and rule, and confirm or dismiss it.
7. The user can request revision of selected issues; no new numerical evidence or sources are invented.
8. Source and revised texts remain separate, with an aligned diff and optional re-evaluation.
9. Passive voice, adjectives, adverbs and long sentences are **not** automatically classified as violations.
10. Scores are only shown when assessment coverage is sufficient, with uncertainty and rubric version visible.
11. Unit tests confirm exact offset alignment for Unicode characters, multiple spaces, citations, abbreviations and punctuation.
12. Human evaluators can override model judgments; disagreement cases are retained for rubric calibration.

## 11. Out of scope (MVP)

- Verifying scientific truth, citations or novelty.
- Manuscript-level OCAR–IMRaD assessment (handled by PSSU).
- Detecting plagiarism or publication acceptance probability.
- Treating word-distance thresholds as universally valid language rules.
- Automatic unreviewed replacement of the user's paragraph.

## 12. References and operational caveat

- Schimel, J. (2012). _Writing Science_. Ch. 11 (Paragraphs), 12 (Sentences), 13 (Flow), 14 (Energizing Writing), 15 (Words), 16 (Condensing).
- Section anchors: §12.4 Subject–Verb Connection; §14.1 Active vs Passive; §14.2 Fuzzy Verbs; §16.4 Modifiers (Adverbs & Adjectives), §16.4.1 Good Modifiers.

**This PRD deliberately separates qualitative principles derived from Schimel from quantitative operationalizations invented for software engineering. Before using evaluation scores for consequential decisions, construct a domain-diverse human-annotated benchmark, assess inter-rater agreement, tune thresholds and calibration, and document limitations.**
