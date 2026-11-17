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

## Update 2026-11-18 (P6): spaCy service built

The owner chose a real parser for passive voice and tense. The service runs as a second container
(`NlpContainer`, `topics-worker/nlp`) of the topics worker, behind that worker's Firebase sign-in, not on a VM:

- `POST /nlp/parse` takes `{ sentences: [{ key, text }] }` (1–200 sentences, 100 KB at most). For each sentence it
  returns spaCy tokens (`i, text, start, end, lemma, pos, tag, dep, head, morph`; offsets in code points of the sent
  text) and derived main-clause `voice` and `tense` (`past | present | future | none`, plus `modal`). The rules are in
  `topics-worker/nlp/syntax.py`. The response also carries `model`, `modelVersion`, `spacyVersion` and `version`.
- The model is `en_core_web_sm` 3.8.0 on spaCy 3.8.7. It is installed when the image is built and never downloaded
  at runtime.
- `src/shared/nlp`: `createSpacySyntaxProvider` (this interface, `reproducible: true`), with the client reading its
  URL from `VITE_NLP_URL`. If that is unset there is no provider, and callers keep the LLM provider or skip.
- `src/core/syntaxParse`: re-alignment to S2 tokens, and `measureSectionSyntax`, which gives the passive share and
  past/present/future split per signature section.

The service is a separate image so that a parse never wakes the torch/BERTopic container, which allows one instance
and handles long jobs.

## Consequences

The MVP works with no extra server. Adding spaCy later changes no module code, only the provider setting.
Every analysis records `syntax_provider` and its version.
