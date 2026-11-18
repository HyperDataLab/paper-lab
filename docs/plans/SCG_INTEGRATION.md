# Scientific Contribution Graph in PaperLab: strategy

Owner, 2026-11-18: integrate the Scientific Contribution Graph (SCG) as its own PaperLab feature. HyperDataLab is small and works only in Computer Science, so a download of more than 80 GB is not justified.

Status: Phase 1 approved. S1 (schema, storage, S2 ids) and S2 (three-stage pass, "Trích đóng góp (SCG)" on the paper's data view) are built, and so are S3 ("Lộ trình đóng góp" card on the corpus page) and S4 (publishing through the worker). Phase 1 slices S1–S4 are all built.

## What SCG is

Source: Jansen, P. A. (2026), _The Scientific Contribution Graph: Automated Literature-based Technological Roadmapping at Scale_, arXiv:2605.15011, Findings of EMNLP 2026. Repo: github.com/cognitiveailab/scientific-contribution-graph.

- **Size (v1.1):** 655k papers, about 6.0M contributions, 36M "prerequisite" edges. An edge means "A was built using B".
- **Contribution node:** a generated name, a description of about 130 tokens, 1 of 17 contribution types (model, benchmark, method and so on), and the paper sections that mention it.
- **Prerequisite edge:** an explanation, a core or peripheral flag, a reference (external paper, a contribution in the same paper, or a tool URL), and a confidence level.
- **Ids:** papers use their Semantic Scholar corpus id; contributions are `<corpusId>.c<n>`.
- **How it was built:** seeded from the ACL Anthology, then grown through S2ORC citations. A 3-stage LLM pipeline (GPT-OSS-120B), more than 40 calls per paper, about $0.10 per paper.
- **Reported quality:**
  - 91% recall of contributions against expert labels on 25 papers;
  - about 94% recall of prerequisites;
  - 3–12% of edges estimated wrong, depending on the judge model.
- **Distribution:** one Hugging Face bucket.
  - v1.1: about 19 GB compressed, about 80 GB extracted (68 GB per-paper JSON plus 12 GB of embeddings).
  - v1.0: about 6.5 GB compressed, about 28 GB extracted. It is mostly AI/NLP, because it was seeded from ACL.
- **Not offered:** no per-field or CS-only subset, and no hosted query API. The Hugging Face Space is a browser only.
- **Licence:** the code is Apache-2.0. **No explicit licence was found for the graph data**; the papers keep their own licences (ACL is CC-BY/CC-BY-SA, S2ORC is open access). This must be settled before any SCG text is redistributed.

## How it differs from what PaperLab has

PaperLab's contribution views (`src/core/contribution`, PR 169) follow the NLP Contribution Graph style. They work at the sentence and phrase level: triples anchored to sentences of one paper, for the "Dòng đóng góp" and "Đồ thị tri thức" views.

SCG works one level up. Its nodes are whole contributions, and its prerequisite edges cross paper boundaries. That is what turns single papers into a roadmap ("what was this built on, and what was built on it"). The two complement each other: an SCG contribution can point to the PaperLab sentences that state it.

## Strategy: build our own graph, borrow SCG's shape, link to SCG only where it pays

### Phase 1: our own SCG-shaped graph from lab papers (no download)

1. **Extraction pass.** Port the 3-stage method to PaperLab's existing LLM path (9router, versioned prompts, candidate-only output):
   1. contributions from the paper model: name, description, type, sections, and anchored source sentences;
   2. candidate prerequisites from the method and related-work text, each with the citing reference;
   3. alignment of each prerequisite to a contribution already in the lab graph, or to a reference.
   - The SCG paper reports more than 40 calls per paper. Batch per section to stay near 10–15 calls per paper.
   - The output stays a candidate until a reader accepts it (PaperLab rule).
2. **Schema.** Mirror SCG's record (contribution, prerequisite, reference, match), and keep SCG's 17 type labels, so a later link to SCG needs no mapping.
   - Paper ids: PaperLab ids plus the DOI.
   - Also store the Semantic Scholar corpus id when the free S2 API resolves the DOI. That id is the join key to SCG.
3. **Corpus graph.** Merge per-paper results for a corpus. The view adds a "Lộ trình đóng góp" tab next to the contribution views:
   - prerequisite chains (ancestors and descendants of a contribution);
   - the most-built-upon contributions in the corpus;
   - the citing paper on each edge.
   - Reuse the graph rendering from the keywords and contribution views.
4. **Cost.** Lab corpora are hundreds of papers, about $0.05–0.10 per paper at 9router rates. No new infrastructure: Dexie stores the graph, and the existing paper-models API can publish it.

### Phase 2 (optional, after Phase 1 shows value): a CS slice of SCG, never on the lab laptop

- **Use v1.0, not v1.1.** v1.0 is ACL-seeded and mostly AI/NLP, which is closest to the lab's CS focus: 6.5 GB to download instead of 19 GB.
- **Build the slice once, as a job off the laptop.** Run it as a one-off cloud job, for example a temporary runner or the topics-worker container, with the owner's permission to download. The job:
  - streams the tarball without extracting it;
  - keeps only papers that lab corpora reference (by S2 corpus id), plus their 1-hop prerequisites and descendants;
  - drops the 12 GB of embeddings, since PaperLab re-embeds only what it keeps if needed;
  - writes compact JSONL, expected well under 1 GB.
- **Storage and serving.** Store the slice in the existing R2 bucket (`paper-fetch`, prefix `paperlab/scg/`). Serve it through the PaperLab worker, for example `GET /v1/scg/papers/:corpusId` and `GET /v1/scg/contributions/:id`. That is the same pattern as the published paper models.
- **What the slice adds in the UI.** A lab paper's contributions get "SCG says this builds on …" links to the wider literature, marked as an outside source.
- **Refresh.** Rebuild only when SCG publishes a new release, or when lab corpora grow a lot.

### Not chosen

- **Full v1.1 download (80 GB):** too big for the lab, and more than half of it is outside CS (medicine, biology, physics).
- **Querying the Hugging Face Space:** there is no API, and scraping it would be brittle.

## Decisions for the owner

1. Approve Phase 1 (own extraction, no download). This is the recommended start.
2. Phase 2 needs explicit permission to download v1.0 (about 6.5 GB) in a cloud job, and an answer on the data licence (ask the author, or keep the slice internal to signed-in lab accounts).
3. Which corpus to try first. Proposal: the ESWA journal-profile corpus, or a lab topic corpus in AI.

## Slices (Phase 1)

- **S1** Schema and Dexie storage for contributions and prerequisites, SCG-compatible, plus DOI → S2 corpus id lookup. Size S.
- **S2** Three-stage extraction pass with versioned prompts and anchoring checks; synthetic tests. Size M.
- **S3** Corpus merge and "Lộ trình đóng góp" view: chains, most-built-upon, edge evidence. Size M. Built: `src/core/scg/roadmap.ts` and `CorpusScgRoadmap` on the corpus page.
- **S4** Publish through the worker API so Writing Bank and SRD can read it. Size S. Built: contract
  `paperlab-scg-paper` v1 and routes in `docs/contracts/scg-paper.md`.
