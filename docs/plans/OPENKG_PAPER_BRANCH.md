# Paper analysis branch: contributions as an OpenKG-style knowledge graph

Owner, 2026-11-18: in paper analysis, split off a branch that extracts contributions and presents them in the style of OpenKG SciAtlas (sciatlas.openkg.cn). The owner handed over the brainstorm, the build and the hand-off.

Status: K1 and K2 implemented. K3 is planned. K4 waits on the owner.

## What SciAtlas is (what we mirror)

Source: Qiao et al. (2026), _SciAtlas: A Large-Scale Knowledge Graph for Automated Scientific Research_, arXiv:2605.22878 (ZJU NLP, OpenKG). Repo github.com/zjunlp/SciAtlas (MIT code; data licence not stated).

- **Scale:** more than 43M papers in 26 disciplines, built mainly from OpenAlex, with about 3B triples.
- **Five layers under one schema:**
  1. **evidential:** papers, citations, publication in sources;
  2. **conceptual:** normalised keywords, paper–keyword links weighted by salience, keyword co-occurrence;
  3. **disciplinary:** domain > field > subfield > topic;
  4. **expertise:** authors, institutions, communities;
  5. **normative:** review and evaluation signals.
- **No explicit contribution nodes.** Contributions are approximated by keywords.
- **Workflows:** search-papers (keyword anchors at high/middle/low salience), literature review, idea grounding / evaluation / generation, trend report, researcher review.
- **Outputs:** saved runs with a Markdown report.
- **Access:** an HTTP API (`POST /v1/search`, personal token, daily quota) at plain `http://`.

## What PaperLab adds

PaperLab already holds the parts:

- the paper model (sections, sentences, references);
- OpenAlex metadata, keywords and topic ids;
- SCG contributions and prerequisites (PR 212–215);
- arguments with evidence level E0–E5 (P7);
- corpus keywords and co-occurrence.

This branch puts them into one SciAtlas-shaped graph per paper and per corpus. It adds the layer SciAtlas lacks: **explicit contributions**, linked to the evidence sentences in the paper.

| Layer        | Nodes                                                          | Edges                                             | Source in PaperLab                                                             |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Evidential   | Paper, cited Work, Source (venue)                              | cites, publishedIn                                | paper model references, OpenAlex `referenced_works`, `primary_location.source` |
| Conceptual   | Keyword (salience high/middle/low), Contribution, Prerequisite | hasKeyword, contributes, buildsOn, relatedKeyword | OpenAlex keywords (score → salience), SCG run, corpus co-occurrence            |
| Disciplinary | Domain, Field, Subfield, Topic                                 | inTopic, broader                                  | OpenAlex primary topic (`domains/…`, `fields/…`, `subfields/…`, `topics/…`)    |
| Expertise    | Author (ORCID), Institution (ROR)                              | authoredBy, affiliatedWith                        | OpenAlex `authorships`                                                         |
| Normative    | Claim with evidence level                                      | supportedBy, evidenceLevel                        | argument run (P7), SCG review state                                            |

**Provenance on every triple:** `openalex`, `paper_text` (with sentence keys) or `llm_candidate` / `accepted`. Machine labels stay marked as such, following PaperLab's rules.

## Slices

- **K1 Core graph and export.**
  - `src/core/openkg/`: build a typed paper KG (nodes, edges, layer, provenance) from the existing data.
  - Keep OpenAlex `authorships` and `referenced_works` on lookup.
  - Salience levels follow SciAtlas's high/middle/low.
  - Export as Turtle (RDF) and JSON-LD with a small vocabulary: schema.org plus a `pl:` namespace documented in `docs/contracts/openkg-paper.md`, and a stable IRI scheme.
  - Size M.
- **K2 Paper view "Đồ thị tri thức (OpenKG)".**
  - A new tab in paper analysis.
  - Layer toggles and a radial graph centred on the paper.
  - A side panel shows a node's triples, provenance and evidence sentence.
  - Export buttons: Turtle, JSON-LD, Markdown report in the SciAtlas run style.
  - Size M.
- **K3 Corpus KG.**
  - Merge the paper KGs of a corpus: shared keywords, disciplines, authors, and contribution buildsOn links across papers.
  - A corpus tab with the same graph and layer toggles.
  - Counts per layer, and a "trend" strip of keywords by year.
  - Export the whole corpus as one Turtle / JSON-LD file.
  - Size M.
- **K4 (owner action first) SciAtlas grounding.**
  - A worker proxy `POST /v1/sciatlas/search` that calls SciAtlas with the lab's token, stored as a worker secret. The proxy is needed because the browser cannot call plain `http://` from https.
  - A "Bài liên quan theo SciAtlas" panel on the paper and corpus graphs, using the paper's high-salience keywords and title as anchors.
  - Needs: the owner registers a SciAtlas token (email verification) and sets `SCIATLAS_API_KEY` as a worker secret. The data licence is not stated, so show results without storing them.

## Not chosen

- **Running SciAtlas's own CLI or Agent Skills inside PaperLab:** these are Python workflows built around the hosted API. K4 gives the useful part, related-work grounding, without them.
- **A graph database (Neo4j):** lab-sized graphs fit in the browser. Turtle / JSON-LD export lets anyone load them into a triple store.
