# Passage index

Owner decision 2026-11-25: build a passage index on Cloudflare instead of adopting RAGFlow. It retrieves paragraphs
from the full text of a ResearchHub project's papers, with citation anchors, for idea2hypothesis (hpl-autoresearch)
and the AutoResearch PI / Critic. A typical question: "which papers measure staleness and how, with what result".

Everything stays in the PaperLab worker: HyperDataLab SSO, the project scope of the central store (ADR-0007,
`X-Project-Id` / `?projectId=`, physical ids `@rh/<projectId>/…`), one D1 database (`paperlab-data`) and one
Vectorize index.

## Design

| Part     | Where                                                      | What                                                                                                                                           |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows     | `passage` (migration `0004_passages.sql`)                  | One row per indexed paragraph: `project_id`, `paper_id`, `paragraph_id`, `section_role`, `ord`, `text`, `text_hash`, `vector_id`, `indexed_at` |
| Keywords | `passage_fts` (FTS5, external content, `porter unicode61`) | Kept in step with `passage` by triggers; BM25 ranking                                                                                          |
| Vectors  | Vectorize `paperlab-passages` (binding `PASSAGE_VECTORS`)  | 768 dimensions, cosine, `@cf/baai/bge-base-en-v1.5` (the KG's model); metadata `projectId`, `paperId`, `paragraphId`, `sectionRole`            |
| Queue    | `passage_queue`                                            | One row per project paper; `generation` grows on every enqueue                                                                                 |
| Code     | `worker/src/passages/*`, `src/core/schemas/passages.ts`    | Indexer, search, routes; request and response schemas shared with the app                                                                      |
| App      | `src/shared/passages/client.ts`, `CorpusPassages.tsx`      | "Tìm đoạn văn" panel on the corpus detail page                                                                                                 |

**Enqueue.** Two triggers on `doc` queue a paper whenever its `papers` record is inserted or its `version` changes,
which covers PUT, commit and soft delete, in the same D1 transaction as the write. The data store code is
unchanged. `POST /v1/passages/reindex` queues the project's live papers (all, a paper list or a corpus's member
papers) plus papers that still have passages but no live record, so they are cleaned up.

**Indexing.** The cron (every 5 minutes) and the reindex request drain the queue. A job is leased by moving
`next_at` 10 minutes ahead. For each paper the indexer:

1. reads the `papers` row and its body (R2 or inline) and validates it with `PaperSchema`;
2. splits paragraphs: drops `reference`, `heading_like`, `footnote`, `equation` and `table` paragraphs, the
   References section and paragraphs under 60 characters; keeps at most 400 per paper, text capped at 8000
   characters;
3. hashes each text (SHA-256). A paragraph whose hash and section role are unchanged is not embedded again; a changed
   order only updates the row;
4. embeds the new or changed paragraphs (first 2000 characters) in batches of 50 and upserts them to Vectorize;
5. deletes the vectors and rows of removed paragraphs, then upserts the D1 rows (the FTS triggers follow).

Vectors are written before rows, so a crash in between re-embeds on retry instead of leaving a row that claims a
vector. A deleted paper loses all its vectors and rows. A job finishes only if its `generation` is unchanged; a paper
saved again during the run stays pending. Failures retry with backoff (1, 2, 4, 8 minutes) up to 5 attempts; an
invalid paper body fails at once. `last_error` keeps the code.

**Vector ids.** `p:<projectId>:<paperId>:<paragraphId>`, or `p#` + base64url(SHA-256) when that exceeds Vectorize's
64-byte limit, which is always the case for two UUIDs. The row stores the id, so a match maps back through D1.

**Search.** `POST /v1/passages/search {query, corpusId?, paperIds?, sectionRoles?, limit ≤ 50}`:

- A `corpusId` resolves to its members' `identifiers.paperIds` in the project's central store (all members,
  whatever their screening decision); with `paperIds` too, the intersection. An unknown corpus is 404
  `corpus_not_found`, never a project-wide search; a corpus without papers returns no passages.
- Vector channel: the query embedding, `topK` 50, filter `projectId $eq` plus `paperId $in` for a paper list. A
  filter holds about 40 UUIDs (2 KB), so longer lists are split over parallel queries (up to 25, i.e. 1000 papers);
  beyond that the filter is the project only and D1 drops other papers. A failed embedding drops this channel.
- Keyword channel: FTS5 `MATCH` of the query tokens (OR), BM25, 100 rows.
- Both channels are read back from D1 with `project_id = ?` and the paper and section role filters, so a vector of
  another project can never be returned even if a metadata filter were missing.
- Reciprocal rank fusion, `k = 60`. The response is
  `{passages: [{paperId, paperTitle, paragraphId, sectionRole, text, score, sources}], truncated}`; `truncated` means
  more passages matched than `limit`. `paperTitle` is the detected title of the paper record, else its title.
- The citation anchor is `paperId` + `paragraphId`; the app opens it at `/papers/:paperId?p=:paragraphId`.

`GET /v1/passages/status` returns the project's queue counts and the number of passages and papers. Every route needs
a lab sign-in and an owned ResearchHub project; without `DATA`, `AI` or `PASSAGE_VECTORS` it answers 503
`passages_not_configured`.

## Limits

- D1: at most 100 binds per statement (lists go through `json_each(?)`) and 5 compound SELECT terms (none used); a row
  upsert statement carries at most about 512 KB of JSON.
- One cron run indexes at most 10 papers or 1500 embeddings; a reindex request indexes one paper and leaves the rest
  to the cron. A 400-paragraph paper costs about 8 Workers AI calls and 4 Vectorize calls.
- Vectorize: `topK` 50 without metadata in the result; filters only on indexed metadata (`projectId`, `paperId`),
  and only for vectors written after the metadata index exists.
- `sectionRoles` filters in D1 after the vector top 50, so a rare role can leave the vector channel nearly empty
  (keyword matches still answer). A third metadata index on `sectionRole` would move the filter into Vectorize.
- The embedding model is English; Vietnamese text is indexed but matches mostly through FTS5.

## Deploy

Run from `worker/` on the HyperDataLab account (phuong@hyperdatalab.org), in this order. Create both metadata
indexes before the first upsert: vectors written earlier cannot be filtered.

```bash
npx wrangler vectorize create paperlab-passages --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index paperlab-passages --property-name=projectId --type=string
npx wrangler vectorize create-metadata-index paperlab-passages --property-name=paperId --type=string
npx wrangler d1 migrations apply paperlab-data --remote     # 0004_passages.sql
npx wrangler deploy
```

Then backfill each project once (papers saved after the migration are queued by the triggers):

```bash
curl -X POST "$WORKER/v1/passages/reindex" -H "Authorization: Bearer $SSO_TOKEN" \
  -H "X-Project-Id: $PROJECT" -H 'Content-Type: application/json' -d '{}'
```

or press "Lập chỉ mục lại" on each corpus. The cron indexes about 10 papers every 5 minutes;
`GET /v1/passages/status` shows progress. Deploy the worker before Firebase Hosting so the panel finds its routes.

## Planned MCP tool: `search_passages`

The lab-research-mcp server gets a read-only tool after that repository accepts SSO tokens (`_coord` 013):

| Tool              | Input                                                               | Output                                        |
| ----------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `search_passages` | `{ projectId, query, corpusId?, paperIds?, sectionRoles?, limit? }` | the `POST /v1/passages/search` response as is |

The tool forwards the caller's SSO token and project id to the worker, so the worker keeps enforcing project scope;
it never holds its own credentials for PaperLab data. Answers cite `paperId` + `paragraphId`.
