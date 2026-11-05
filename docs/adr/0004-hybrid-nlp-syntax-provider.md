# 0004 Hybrid NLP behind a SyntaxProvider interface

- Status: Accepted (2026-11-05)

## Context

PRD EV-01..EV-03 and AC-02 need sentence boundaries, tokens, POS, dependency relations and reproducible
subject–verb distances with exact offsets. spaCy's parser does this well, but it is Python-only: it is not in
Pyodide and cannot run in the browser. `spacy-llm` adds nothing we need (string-matched LLM output, experimental API).
Pure-LLM parsing is not reproducible.

## Decision

1. **Deterministic text core in the browser** (`core/text`, slice S2): source hash, sentence segmentation,
   tokenisation with code-point and UTF-16 offsets. Always runs, no network. Its token list is the coordinate
   system for everything else.
2. **`SyntaxProvider` interface** (slice S5) returning per-token POS, lemma, dependency head/label and
   subject/main-verb heads, keyed by the S2 token indexes:
   - `llmSyntaxProvider` (default): the LLM receives the numbered token list and returns head indexes only;
     code validates them and computes spans and distances. Invalid or ambiguous → `null` + confidence.
   - `spacySyntaxProvider` (optional): calls a small FastAPI + spaCy service (`/api/nlp/parse`), re-aligns its
     tokens to ours by character offsets, and is marked `reproducible: true`.
3. The LLM keeps the contextual work: Topic/Stress, sentence roles, paragraph structure, flow, issue judgement,
   revision.

## Consequences

The MVP works with no extra server. Adding spaCy later changes no module code, only the provider setting.
Every analysis records `syntax_provider` and its version.
