# Lab knowledge graph (L1–L4)

The PaperLab PDF worker builds the lab graph from OpenAlex works. It stores graph data and full-text indexes in D1 and one title + abstract embedding per paper in Vectorize. The corpus detail and Library actions send identifiers only. Abstracts are stored for internal search. The ingest routes expose counts and job logs. The search and read routes (L3) answer from this graph only.

## HTTP contract

Every `/v1/kg/*` route requires `Authorization: Bearer <Firebase ID token>` from an accepted project and a verified lab account. Missing or invalid credentials return `401`, and an account outside the lab returns `403`. An authenticated request gets `503` with `error: "kg_not_configured"` when a required binding is absent. The SQL route uses `KG` alone. The other routes require `KG`, `KG_VECTORS` and `AI`. Errors use the worker's usual `{ error, message }` JSON shape.

### `POST /v1/kg/sql`

Send `{ "sql": "SELECT title FROM paper ORDER BY id", "limit": 10 }`. `limit` is optional and accepts integers
from 1 to 1,000 (default 100). `200` returns `{ sql, columns, rows, truncated, concepts }` with positional rows
and registry concept IDs. The worker binds `limit + 1` to an outer `LIMIT` to detect truncation. The route uses
`Cache-Control: no-store`.

The validator accepts one `SELECT` or non-recursive `WITH … SELECT` with an optional trailing semicolon.
Sources must be unqualified registry tables, previously declared CTEs or SELECT subqueries. Joins can group
those sources with parentheses. Comments, write
and administrative keywords, `RETURNING`, `load_extension`, bind placeholders, table-valued functions,
SQLite internals, FTS tables and `doc` tables are rejected. SQLite's implicit `IN table` form is rejected.
Malformed or rejected statements return `400` with an `sql_*` code. Invalid request bodies return
`bad_request`. The Worker stops waiting after five seconds (`sql_timeout`). D1 enforces the database execution
ceiling and resource limits. [Cloudflare D1 limits and cancellation support](https://developers.cloudflare.com/d1/observability/debug-d1/)

### `POST /v1/kg/ingest`

```json
{ "ids": ["W123", "10.1000/synthetic"], "depth": 1, "source": "seed" }
```

- `ids` contains 1–50 OpenAlex work IDs or DOIs. OpenAlex and DOI URLs are accepted. Malformed requests return `400` without queueing anything.
- `depth` is `0`, `1` (default) or `2`. `source` is `seed` (default), `expansion` or `sciatlas_pointer`. A SciAtlas pointer supplies only an ID. Metadata always comes from OpenAlex.
- The worker records the IDs, then attempts one due submitted job and returns `202`.

```json
{ "queued": 2, "processed": 1, "skipped": 0, "errors": [] }
```

`queued` counts new queue entries and entries whose requested depth increased. `skipped` counts submitted entries that leave the queue unchanged, including duplicates. `processed` counts jobs completed during the request. `errors` contains `{ id, code }` for unsuccessful immediate attempts, including attempts scheduled to retry. Expansion results are counted separately in the queue.

### `GET /v1/kg/ingest/status`

```json
{
  "counts": { "pending": 1, "processing": 0, "done": 1, "failed": 0 },
  "logs": [{ "id": "W123", "code": "ingested", "attempts": 1, "at": "2026-06-01T00:00:00.000Z" }]
}
```

Logs contain the latest 20 attempt outcomes, newest first, with UTC timestamps. A queue row is keyed by the normalized submitted identifier. A DOI and an OpenAlex ID can have distinct queue rows and converge on the same graph paper and vector. Completed rows keep the resolved OpenAlex paper ID so alternate DOIs can be linked to the paper.

### `POST /v1/kg/search` (L3)

The request and response have the same shape as [`POST /v1/sciatlas/search`](sciatlas-proxy.md): `query`, `keywords` and `titles` with `high` / `middle` / `low` levels, `references`, `after` / `before`, `topK` (capped at 20), `mode` (`keyword` | `semantic` | `title` | `hybrid`, default `hybrid`) and `ranking` (`precision` | `balanced` | `discovery` | `impact`, default `balanced`). At least one keyword or title is required. The body is limited to 64 KB (`413`). A `400` names only the failing fields. Every answer carries `Cache-Control: no-store`, and the query text is never logged.

```json
{
  "papers": [
    {
      "rank": 1,
      "title": "A related synthetic paper",
      "year": 2021,
      "score": 0.6312,
      "citations": 14,
      "venue": "Synthetic Journal",
      "authors": ["A. Author"],
      "id": "W123",
      "doi": "10.1000/example",
      "openalexId": "W123",
      "abstract": "…"
    }
  ],
  "elapsedMs": 41
}
```

`id` and `openalexId` are the OpenAlex short ID. `doi` and `abstract` (cut at 4000 characters) are omitted when unknown. When the KG holds no paper, the answer is `{ "papers": [], "hint": "kg_empty", "elapsedMs": … }` and nothing is embedded. A failed D1 query, or a failed embedding in `semantic` mode, returns `502` with `error: "kg_error"`. In `hybrid` mode a failed embedding only drops the vector channel.

Retrieval gathers up to 100 candidates per channel:

- **FTS:** `paper_fts` (title + abstract) matched against the query text. An empty query means the titles and keywords joined with `; `. Text is normalised, and each token is quoted and joined with `OR`, so FTS5 operators in user text are inert. `bm25` ranks are scaled to [0, 1] with the best match at 1.
- **Keyword:** each anchor keyword resolves to KG keywords by exact `text_normalized` or a `keyword_fts` phrase match. Papers come through `has_keyword`. The signal is Σ w(level) · (0.5 + 0.5 · relevance_score) over the anchors a paper matches, divided by Σ w(level) over all anchors. The weights are the SciAtlas keyword scores divided by the high score: high 1, middle 7/9, low 4/9.
- **Title:** `title`-column FTS for each title anchor, then the best token Dice similarity to an anchor title times its SciAtlas confidence (high 0.95, middle 0.85, low 0.65).
- **Vector:** used in `semantic` and `hybrid` only. The query text is embedded with `@cf/baai/bge-base-en-v1.5`, as at ingest. The 50 nearest Vectorize matches give cosine similarity clamped to [0, 1]. Matches missing from D1 are dropped.
- **Graph:**
  - `sharedHigh` is the share of high-level anchor keywords the paper carries.
  - `citation` is min(1, links / 2), where links counts `cites` rows to or from an anchor paper. Anchor papers are the KG papers whose normalised title equals a title or reference anchor.
  - `cooccur` is the best Jaccard among the 20 strongest `cooccur` neighbours of the matched high-level keywords, or of all matched keywords when none is high.

Scoring lives in `src/core/labKg/search.ts`:

```
text      = Σ mode weight · channel signal
            keyword {fts 0.4, keyword 0.6} · semantic {vector 1} · title {title 1}
            hybrid {fts 0.2, keyword 0.3, title 0.15, vector 0.35}
graph     = 0.5 · sharedHigh + 0.3 · citation + 0.2 · cooccur
relevance = 0.8 · text + 0.2 · graph
impact    = min(1, ln(1 + citations) / ln(1001))
recency   = clamp(1 − (this year − year) / 10, 0, 1), 0 when the year is unknown
novelty   = 0.6 · recency + 0.4 · (1 − impact)
score     = r · relevance + i · impact + n · novelty
            precision (0.9, 0.05, 0.05) · balanced (0.7, 0.15, 0.15)
            discovery (0.6, 0.05, 0.35) · impact (0.55, 0.4, 0.05)
```

- Outside `hybrid`, a paper needs a non-zero text signal in its mode's own channels. In `hybrid`, graph links alone can admit a paper.
- `after` and `before` filter on `publication_year`, the only date D1 holds, so they work by year. A paper with no year is left out when a range is set.
- Papers matched by a title anchor are left out, because a title anchor is the paper being searched from.
- Ties go to more citations, then the smaller ID. `score` is rounded to four decimals.

### `GET /v1/kg/papers/:id`, `GET /v1/kg/keywords/:id`, `GET /v1/kg/stats`, `GET /v1/kg/overview` (L3)

Each answers `200` JSON with a weak `ETag` and `Cache-Control: private, no-cache`. A matching `If-None-Match` gets `304`. Other methods get `405`. Shapes are `KgPaperDetailSchema`, `KgKeywordDetailSchema` and `KgStatsSchema` in `src/core/schemas/labKg.ts`.

- **`papers/:id`** takes an OpenAlex work ID or a DOI, URL-encoded when it contains a slash. A malformed ID gets `400`, and a paper outside the KG gets `404`. The answer contains:
  - `paper`: ID, DOI, title, abstract, year, citations, type and venue;
  - `keywords`: ordered by relevance;
  - `topics`: each with its subfield, field and domain chain;
  - `authors`: in position order, each with the institutions recorded for this paper;
  - `cites` and `citedBy`: limited to papers inside the KG;
  - `contributions`: SCG contributions whose `paper_doi` equals the paper's DOI.
- **`keywords/:id`** takes the keyword ID either raw (`/v1/kg/keywords/keywords/graph-theory`) or encoded (`keywords%2Fgraph-theory`). An unknown ID gets `404`. The answer contains `keyword` (ID, text and frequency), the 30 strongest `cooccurring` keywords with count and Jaccard, and `papersPerYear`.
- **`stats`** returns row counts for every node table (`paper`, `keyword`, `author`, `institution`, `source`, `topic`, `subfield`, `field`, `domain` and `contribution`), every edge table, and the ingest queue counts by state. The counts are one row of scalar subqueries: D1 rejects a compound `SELECT` of more than five terms, so a `UNION ALL` over the tables fails there (the test database enforces the same limit).
- **`overview`** (L4) returns starting points for the explorer (`KgOverviewSchema`): the 8 most cited `papers` (ID, title, year, citations) and the 12 most frequent `keywords` (ID, text, frequency). An empty KG answers two empty lists.

### `GET /v1/kg/graph`, `GET /v1/kg/trend` (L4)

Both are reads like the L3 routes: weak `ETag`, `Cache-Control: private, no-cache`, `304` on a matching `If-None-Match`, `405` for other methods. Shapes are `KgGraphSchema` and `KgTrendSchema` in `src/core/schemas/labKg.ts`.

- **`graph?center=…&depth=1|2&layers=…&limit=…`** answers the neighbourhood of one node.
  - `center` (or `centre`) is an OpenAlex work ID or DOI, an author (`A…`) or institution (`I…`) ID, or a prefixed ID (`keywords/…`, `topics/…`, `subfields/…`, `fields/…`, `domains/…`). A malformed centre gets `400`, and one outside the KG gets `404`.
  - `layers` is a comma list of `papers`, `keywords`, `authors`, `institutions` and `topics` (topics include subfields, fields and domains). Without the parameter every layer is on. An empty value keeps the centre alone. An unknown layer gets `400`.
  - `limit` is the node cap including the centre: default 80, at most 150 (larger values are clamped). `depth` defaults to 1.
  - Edges are `has_keyword`, `cites`, `cooccur` (weight = Jaccard), `authored`, `affiliated` (author → institution), `coauthor`, `has_topic`, `hierarchy` (topic → subfield → field → domain) and `builds_on` (paper → paper through an SCG contribution, with its `review`). `cites` and `builds_on` join `paper`, so they stay inside the KG. `cooccur` and `coauthor` are read in both stored directions.
  - Each relation of an expanded node returns at most 40 rows. Edge weights lie in [0, 1]: keyword relevance, Jaccard, `0.5 + 0.5 · impact` for citations, `max(0.4, 1 − 0.1 · (position − 1))` for authorship, `count / 3` for coauthors (capped at 1), the topic score (0.5 when unknown), 0.6 for affiliations, and 1 for the hierarchy and `builds_on`.
  - A first-hop node weighs its strongest edge. Depth 2 expands the 8 strongest first-hop nodes, institutions excepted; a second-hop node weighs `0.5 · parent weight · edge weight` and keeps depth 1 when it was already reached at depth 1.
  - Nodes are ranked centre first, then by weight, depth, kind and ID. The top `limit` are kept, and `truncated` says whether any were cut. Edges whose ends were cut are dropped.
  - For a paper centre, `outside` lists up to 50 cited works that have no paper row yet, so a client can queue them.
- **`trend?keywords=…`** takes 1–10 comma-separated keywords: IDs (`keywords/…`) or texts matched on `text_normalized`. The answer has a contiguous `years` axis from the first to the last counted year, each found keyword with `total` (its frequency, papers without a year included) and `counts` per year, and the requested values the KG does not hold in `missing`.

Turtle and JSON-LD export happens in the browser. `src/core/labKg/graphKg.ts` maps the graph answer onto the OpenKG model with the OpenKG IRI segments keyed by OpenAlex IDs (`kg/work/W…`, `kg/keyword/…`, `kg/discipline/…`, `kg/author/A…`, `kg/institution/I…`), and the OpenKG exporters serialise it. Per-paper OpenKG graphs key authors by ORCID and institutions by ROR when known, so those IRIs can differ. The worker has no export route.

## Lab KG explorer page (L4)

"KG của lab" (`/lab-kg`, after Corpus in the sidebar) shows the `stats` counts and the queued jobs, a search box that picks a centre through `POST /v1/kg/search` (or takes an ID or DOI directly), layer chips, a depth control and the shared OpenKG graph with the centre in the middle. The side panel loads `papers/:id` or `keywords/:id` for the selected node. A paper shows its year, venue, keywords, references and citing papers inside the KG and its contributions, plus "Mở bài trong PaperLab" when a local paper has the same DOI. A keyword shows co-occurring keywords with Jaccard and its papers per year. Authors, institutions and topics list their neighbours from the loaded graph only. "Đưa n bài được dẫn vào KG" queues `outside` at depth 0 (`source: "expansion"`). A text list of the nodes, a keyword trend table for the five strongest keywords and the `.ttl` / `.jsonld` exports complete the page.

- Layer chips show how many nodes of each layer the loaded graph holds. While a new graph loads, the old one is replaced by a loading state.
- With no centre chosen, chips from `overview` (most cited papers, frequent keywords) open a centre. Without that route (an older worker) the page simply leaves them out.
- A paper centre that gets `404` shows "Bài này chưa có trong KG của lab" and "Đưa bài này vào KG". That sends the ID or DOI to `POST /v1/kg/ingest` (seed, depth 1). The page then reads `papers/:id` every 4 s, for up to 2 minutes, and centres on the paper once it is there. It stops early when `ingest/status` logs `openalex_not_found` for the ID. Otherwise it says the paper is still queued.
- A keyword or other centre that is not in the KG offers a text search for its words instead.
- An empty KG (`stats.nodes.paper = 0`) shows the steps and "Chọn corpus để đưa vào KG". This lists the corpora in the browser with member counts and sends one corpus's IDs to `ingest` in batches of 50, showing what was sent, queued and processed. The search box stays available, so a single DOI can be ingested.
- While the queue has work, the counts refresh every 20 s.
- Failures name the HTTP status, and "Chi tiết kỹ thuật" holds the status and server code: `kg_not_configured`, 5xx, 429, a network error.
- A bodiless `304` that reaches the client is fetched again with `cache: "reload"`.

## SciAtlas as an ID source

The related-papers panel ("Bài liên quan (KG của lab)", `src/shared/openkg/RelatedPapersPanel.tsx`) searches the lab KG. Its "Tìm thêm id từ SciAtlas" action sends the same anchors to `POST /v1/sciatlas/search` and reduces the answer to DOIs and OpenAlex IDs at once. It queues them with `POST /v1/kg/ingest` (`source: "sciatlas_pointer"`, `depth: 0`, so only the work itself is fetched from OpenAlex) and shows only counts. SciAtlas titles, abstracts, scores and venues are never shown or stored. The panel's status line shows the KG's paper and keyword counts and the queued jobs (`pending` + `processing`) from `GET /v1/kg/stats`.

## Ingest and storage

- The five-minute cron attempts up to three due jobs. It skips work unless all three bindings are present. A job at depth zero fetches only the work. A job with remaining depth adds its references and the ten works returned by the citing search ordered by citation count, each at one lower depth. [OpenAlex work endpoints](https://help.openalex.org/data/works/)
- OpenAlex `429` pauses further claims until the later of exponential backoff and `Retry-After`. Retriable errors start at a one-minute delay and a job gets at most five attempts. Missing works fail immediately. An expired claim can be recovered by the cron.
- Paper and edge upserts use OpenAlex short IDs. Citation and related-work targets can point beyond the ingested graph. `authored.position` is one-based. `affiliated` records an author–institution pair per paper. `subfield_of`, `field_of` and `domain_of` point from a topic, subfield and field to their parent, respectively. Keyword frequency counts papers. Co-occurrence stores shared-paper count and Jaccard similarity, and coauthor edges store shared-paper count. Paper and keyword writes maintain their FTS5 indexes. [D1 platform limits](https://developers.cloudflare.com/d1/platform/limits/)
- The `@cf/baai/bge-base-en-v1.5` embedding is keyed by the paper's OpenAlex ID. Vector metadata includes `year` and `subfieldId` when known. A record with no title or abstract is stored without a vector. [Workers AI embedding model](https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/)
- A successful `PUT /v1/papers/:id/scg` also projects the published contributions and `builds_on` edges and enqueues the DOI when D1 is bound. Contribution rows retain the publication ID and DOI for linking to the OpenAlex paper. If a D1 write fails after R2 publication, retrying the same PUT retries the D1 projection. SCG publication works with D1 alone and uses R2 alone when D1 is absent.

## Owner setup

Run these on the HyperDataLab account from `worker/` when provisioning the KG.

1. Run `wrangler d1 create paperlab-kg`.
2. Replace `TO_BE_CREATED_ON_DEPLOY` in `wrangler.toml` with the assigned database ID.
3. Run `wrangler d1 migrations apply paperlab-kg --remote`.
4. Run `wrangler vectorize create paperlab-kg-papers --dimensions=768 --metric=cosine`.

The Wrangler 4.161.0 config parser accepts the placeholder as a string. Cloudflare needs the real resources to bind them. To deploy the existing worker before provisioning the KG, comment out the `[[d1_databases]]`, `[[vectorize]]` and `[ai]` blocks in `worker/wrangler.toml` as a unit. The cron is safe to leave enabled.

`OPENALEX_MAILTO` is an optional Worker variable, unset by default. Set it to a lab contact for OpenAlex if one is available. Keep `OPENALEX_API_KEY` in Worker secrets. OpenAlex requests include either or both parameters when configured.
