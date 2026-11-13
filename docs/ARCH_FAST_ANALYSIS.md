# Fast one-paper analysis: libraries, server and call shape

Date: 2026-11-13. Owner request: cut the time to analyse one paper; a server and an architecture change are
acceptable. Inputs: four research agents (PDF parsers, non-LLM NLP, server and LLM orchestration, how similar
products stay fast), the measurements in `UX_EVAL_PAPER_ONE_BUTTON.md`, and a router concurrency test run for this
document. Figures marked (unverified) come from the agents' recall or vendor pages and need a local test.

## Where the time goes today

| Analysis               | Calls | Shape                                                                                                 |
| ---------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Coherence & sentences  | ~359  | syntax batched per section; judge, structure, score **per paragraph** (3 × 106); transitions per pair |
| The other six together | ~36   | per section or one per paper                                                                          |

Calls are ~30 s each in real use and ran strictly one after another until #125. Since #125, run-all runs three
analyses at once, but Coherence still makes its ~359 calls in sequence, so **a full run is still about 2–3 hours**.

## Measured: how many calls the router serves at once

Same prompt (~280 output tokens), sent n at a time through the dev proxy to 9router (`cx/gpt-6-luna`), all HTTP 200:

| In flight | Wall time | Median call | Max call |
| --------- | --------- | ----------- | -------- |
| 1         | 7.4 s     | 7.4 s       | 7.4 s    |
| 2         | 6.3 s     | 6.3 s       | 6.3 s    |
| 4         | 7.0 s     | 6.5 s       | 7.0 s    |
| 8         | 12.0 s    | 6.3 s       | 12.0 s   |
| 16        | 19.1 s    | 12.2 s      | 19.1 s   |

The router serves about **4–6 calls at once**; beyond that, calls queue (no 429s). Throughput tops out at roughly
5× sequential. The response has no cached-token field, so prompt caching through 9router is unconfirmed. Call time
scales with output length (~40 tokens/s), which is why real analysis calls take ~30 s.

## What each idea buys

| Idea                                          | Time saved                     | Quality gained                                                              | Needs a server? |
| --------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- | --------------- |
| Parallel calls inside Coherence (5 in flight) | 2–3 h → ~30–40 min             | none                                                                        | no              |
| Coherence judge/structure/score per section   | ~359 → ~60–80 calls            | none, if an eval shows no loss                                              | no              |
| Deterministic pre-filters (below)             | LLM only on flagged paragraphs | measurable, explainable scores                                              | partly          |
| GROBID for structure                          | seconds, not hours             | **large**: references, metadata, citation links, appendices, de-hyphenation | yes (Java)      |
| Server-side job runner                        | none by itself                 | run survives a closed tab; key off the client                               | yes             |
| A second router or provider key               | lifts the 4–6 ceiling          | none                                                                        | no              |

**Speed comes from call shape and parallelism, not from the server.** A server adds robustness and lets GROBID and
Python NLP run; GROBID fixes quality, not the 2–3 hours.

## Libraries

**GROBID** (Java, Apache-2.0, maintained; release 0.9.x). It extracts the header (title, authors, DOI, year), sections
and paragraphs as TEI, references parsed into fields, in-text citation → reference links, sentence segmentation and
appendices as `annex`. Official benchmarks give about 0.3–0.5 s per PDF with the CRF models on 4 CPUs in batch
([GROBID benchmarks](https://grobid.readthedocs.io/en/latest/benchmarks/Benchmarking-biorxiv/)); a single paper with
CrossRef consolidation is a few seconds. It would fix the merged references and the 18 false Sources cards, the title
from the file name, the missing DOI/authors/year, the hard-to-read appendices, the two sentence counts and quotes cut
at line-break hyphens (to confirm on the test paper). PDF.js stays for rendering and anchoring quotes.

**Saffron** (Insight Centre, Univ. of Galway; [repo](https://github.com/insight-centre/saffron), v4, Java/Maven, ~3 GB
of models). It extracts terms from a **collection** of documents and builds a taxonomy or knowledge graph. On one paper
its statistics are weak and it replaces none of the slow calls. It fits the **Corpus** module (terms and topics across
the 150+150 ESWA corpus), not the one-paper analysis.

**Non-LLM NLP** (all unverified on our papers; each replacement is gated by a comparison with today's LLM output):

| Tool                           | Replaces or pre-filters                                              | Cost                        |
| ------------------------------ | -------------------------------------------------------------------- | --------------------------- |
| spaCy / scispaCy               | sentence length, passive voice, clause depth, nominalisation         | 1–3 s per paper (CPU)       |
| textstat + LanguageTool        | numeric part of the writing score; grammar and style flags           | ~1 s per paragraph (LT)     |
| Hyland metadiscourse lexicon   | candidate hedges, boosters, self-mention for Stance                  | milliseconds                |
| sentence-transformers (MiniLM) | adjacent-paragraph similarity: send only weak transitions to the LLM | 1–3 s per paper             |
| SciBERT move / role taggers    | first pass of rhetorical moves and topic-sentence labels             | seconds, fine-tuning needed |
| Docling (MIT)                  | table structure, if GROBID's tables are not enough                   | ~0.5 s per page             |

Not recommended: CERMINE and Science Parse (unmaintained), Nougat (non-commercial weights, slow), Marker and MinerU
(GPL/AGPL; no reference parsing), TARGER (old models, weak on scientific prose).

## Call shapes, using the measured ceiling (5 in flight)

| Design                                                                                             | Calls  | Wall time (arithmetic)                                                         |
| -------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Today after #125                                                                                   | ~395   | ~2–3 h                                                                         |
| A. Today's calls, 5 in flight across and inside analyses                                           | ~395   | 395 × 30 s / 5 ≈ 40 min                                                        |
| B. A + Coherence judge/structure/score per section (≤ 10 paragraphs per call)                      | ~80    | 80 × 40 s / 5 ≈ 11 min                                                         |
| C. B + deterministic pre-filters (LLM writes feedback only for flagged paragraphs and transitions) | ~40–50 | ≈ 6–8 min                                                                      |
| D. One call per purpose over the whole paper                                                       | ~7     | ≈ 5 min, but outputs of 15k+ tokens risk truncation; one failure costs minutes |

Recommended: **C**, reached through A and B. D is not worth the risk for per-paragraph outputs.

## Target architecture

- **Browser** keeps the PDF viewer, highlighting, review (accept/reject), Dexie storage and export.
- **One small container service** (Cloud Run with min-instances 1, or one small VM) runs:
  - GROBID (CRF image) for structure;
  - a Python worker with spaCy, textstat, LanguageTool and MiniLM for the deterministic pass;
  - the job runner: one job per paper, steps as a DAG (parse → deterministic pass → LLM per purpose), a queue
    capped at the router's ceiling, retries with backoff, idempotent steps keyed by
    (paper, step, unit, prompt version, model), checkpoints after every step;
  - the 9router key, server-side.
- **Results stream to the browser** as each purpose finishes (Firestore onSnapshot, or polling the job), so the Brief
  appears in about a minute while Writing keeps filling.

## Order

1. **U4 in the browser (no server):** a parallel pool inside `runBatch` capped at 5, then judge/structure/score per
   section with paragraph ids and verbatim quotes checked against each paragraph. Gate: an eval on the test paper
   comparing per-section with per-paragraph output.
2. **GROBID spike:** run the CRF image locally on the test paper and compare its TEI with the browser parser
   (references, header, sections, appendices, hyphenation).
3. **Server:** the container service with GROBID and the job runner; the browser path stays behind a flag until the
   server path matches it.
4. **Deterministic pass:** spaCy, textstat, LanguageTool and MiniLM pre-filters, each gated by a comparison with the
   current LLM output.

Saffron goes to the Corpus backlog.

## Decisions for the owner

- Permission to download the GROBID Docker image (~500 MB, CRF) and, later, the spaCy/MiniLM models for the spike.
- Where the server runs: Cloud Run needs billing on the Google project (the free tier likely covers a small lab); a
  small VM (e.g. Fly.io or a lab machine) avoids that. Creating it is a deploy and waits for the owner's word.

## GROBID on Cloudflare Containers: measured (2026-11-13)

Deployed as `paperlab-pdf-worker` + `GrobidContainer` (`grobid/grobid:0.9.0-crf`, `standard-2`) on the HyperDataLab
account; called from the live app with a lab sign-in, on the 32-page test paper (1.36 MB).

| Call                                  | Wall time |
| ------------------------------------- | --------- |
| First call, container cold            | 61.8 s    |
| Same PDF again (R2 cache hit)         | 0.47 s    |
| 32-page PDF, container warm, no cache | 9.0 s     |
| 3-page PDF, container warm, no cache  | 4.5 s     |

What came back, compared with the browser parser:

| Field                         | GROBID                                                                            | Browser parser today           |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| Title                         | correct                                                                           | file name                      |
| Header authors                | 4 names, two of them merged into one entry                                        | none                           |
| arXiv id / date               | found (`2605.03202v2`, 2026-07-05)                                                | none                           |
| DOI                           | none in the header (arXiv DOI must be derived from the id)                        | none                           |
| References                    | 76 entries; 74 with authors, 75 with title, 65 with year, 41 with DOI or arXiv id | entries merged, 18 false cards |
| In-text citations → reference | 71 of 100 linked                                                                  | matched by heuristics          |
| Sentences in the body         | 780                                                                               | 869 / 818 (two definitions)    |
| Line-break hyphens left       | 0                                                                                 | quotes cut at "pa-"            |
| Appendices                    | mostly kept in the body (4 annex heads, 16 appendix-like heads in body)           | appendix sections hard to read |

Conclusion: use GROBID for the header, references and citation links (the parts the browser parser gets wrong),
derive `10.48550/arXiv.<id>` for arXiv papers, and keep PDF.js for rendering and quote anchoring. Appendix detection
still needs our own rule (heading letters A–H after the references). The cold start (~1 min) happens at most once per
10 idle minutes; importing a paper can start the call in the background so it is warm by the time the reader looks.
