# The lab's own knowledge graph (SciAtlas-compatible), built from OpenAlex

Owner, 2026-11-18/19: do not use SciAtlas through its API. Deploy and build our own data, with a way to take data from SciAtlas.

Owner decisions:

- **Storage:** Cloudflare D1 plus Vectorize, on the HyperDataLab account.
- **Scope:** grow outward from the lab's corpora and library.
- **SciAtlas:** used only as a source of paper ids. The full records come from OpenAlex.

Status: plan; L1 and L2 are in progress.

## What we know about SciAtlas

- **No published data.** SciAtlas publishes no graph dump (checked 2026-11-18): no download, Hugging Face dataset, OpenKG page or data licence. The repo ships a pip client, the SciAtlasEval benchmark, and a read-only copy of its Neo4j search code (`references/search/.../kg/neo4j_repository.py`).
- **OpenAlex is its main source.** OpenAlex metadata is CC0. Building our own graph from OpenAlex is therefore the legitimate path, and it matches what SciAtlas itself is built from.
- **Graph schema, read from its search queries.**
  - Nodes:
    - `Paper` (id, title, title_normalized, abstract, publication_year, cited_by_count, type, title and abstract embeddings);
    - `Keyword` (id, text, text_normalized, frequency, embedding);
    - `Author` (id, display_name);
    - `Topic`, `Subfield`, `Field`, `Domain`.
  - Edges:
    - `HAS_KEYWORD`, with a `relevance_score`;
    - `CITES` and `RELATED_TO`, between papers;
    - `AUTHORED` and `COAUTHOR`;
    - `COOCCUR`, between keywords;
    - `HAS_TOPIC`, `SUBFIELD_OF`, `FIELD_OF` and `DOMAIN_OF`.
  - Indexes: full-text on paper title, abstract and keyword text; vector indexes on titles, abstracts and keywords.
- **Taking data from SciAtlas.** The terms for bulk use of its hosted API are unclear, and each personal token has a daily quota. So we never copy SciAtlas records. A SciAtlas search result contributes only its OpenAlex id or DOI to our ingest queue, and the record itself is fetched from OpenAlex. This mode is optional and off by default.

## Design

### Storage

- **D1 database `paperlab-kg`**, mirroring SciAtlas's labels and relation names:
  - node tables: `paper`, `keyword`, `author`, `institution`, `source`, `topic`, `subfield`, `field`, `domain`;
  - edge tables: `has_keyword`, `cites`, `related_to`, `authored`, `affiliated`, `coauthor`, `cooccur`, `has_topic` and the hierarchy edges;
  - PaperLab's own layer: `contribution` and `builds_on`, from published SCG graphs;
  - support tables: `ingest_queue` and `ingest_log`.
- **FTS5 tables** for full-text search on paper titles, abstracts and keyword text.
- **Vectorize index `paperlab-kg-papers`.** One vector per paper, made from the title and abstract with a Workers AI embedding model. Keywords may get a vector later.
- **Size.** The graph grows from lab corpora, so it stays small: thousands to tens of thousands of papers, well under D1's limits.
- **Abstracts.** They are reconstructed from OpenAlex's inverted index, stored for internal search only, and served only to signed-in lab accounts.

### Ingest

- **Seeds:**
  - corpus members and library records (OpenAlex ids or DOIs);
  - published SCG graphs;
  - "Đưa vào KG" from any list in PaperLab;
  - optionally, ids from SciAtlas search results.
- **Expansion:** for each seed, its references (`referenced_works`) and its most-cited citing works (top N per paper), to a depth of 1 by default and at most 2.
- **Per paper:** fetch the OpenAlex work (title, abstract, year, cited_by_count, type, primary location, authorships with institutions, keywords with scores, the topic hierarchy, referenced works), then upsert nodes and edges, recompute `cooccur` and `coauthor` for the affected nodes, and write the embedding.
- **Running it:** the PaperLab worker handles batches of up to 50 ids per request.
  - It sends a polite OpenAlex `mailto`, or the lab's `OPENALEX_API_KEY` if one is set.
  - A cron trigger drains `ingest_queue` slowly, staying within OpenAlex's limits.
  - Every write is idempotent: upsert by OpenAlex id.

### Read (replaces calling SciAtlas)

- **`POST /v1/kg/search`:** the same request and response shape as `/v1/sciatlas/search`, so the UI changes very little.
  - Hybrid retrieval: FTS5 keyword and title matches, Vectorize similarity, and graph boosts (keyword association, citations, co-occurrence).
  - Ranking profiles: precision, balanced, discovery, impact.
- **`GET /v1/kg/papers/:id`** returns a paper with its neighbours by layer. **`GET /v1/kg/keywords/:id`** returns a keyword with its co-occurrence and trend. **`GET /v1/kg/stats`** returns counts.
- **In PaperLab,** "Bài liên quan" searches the lab KG by default. SciAtlas becomes an optional "tìm thêm id" mode that only enqueues ids.

## Slices

- **L1, storage and schema** (size M):
  - D1 migrations: tables, indexes and FTS5;
  - the Vectorize index and Workers AI bindings in worker/wrangler.toml;
  - the OpenAlex → node and edge mapper as pure core shared with the browser;
  - tests on synthetic data.
- **L2, ingest** (size M):
  - the queue;
  - `POST /v1/kg/ingest`;
  - the cron drain with citation expansion;
  - the cooccur and coauthor updates;
  - embeddings;
  - a "Đưa vào KG" action on corpus and library;
  - ingest status in PaperLab.
- **L3, search and reads** (size M):
  - `/v1/kg/search` (hybrid);
  - the paper, keyword and stats routes;
  - the "Bài liên quan" panel switches to the lab KG;
  - SciAtlas pointer mode.
- **L4, KG explorer** (size M):
  - a lab-wide graph view (layers, neighbourhoods, keyword trends);
  - export to Turtle and JSON-LD, reusing the OpenKG exporters.

## Owner actions

- Creating the D1 database and the Vectorize index on the HyperDataLab account. These are new cloud resources: they are created with wrangler at the first deploy, after the owner says "Deploy now".
- Optional: ask the SciAtlas authors (ZJU NLP) whether a graph export can be shared. If they share one, a loader can bring it in.
