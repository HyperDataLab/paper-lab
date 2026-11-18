# Lab knowledge graph (L1–L2)

The PaperLab PDF worker builds the lab graph from OpenAlex works. It stores graph data and full-text indexes in D1 and one title + abstract embedding per paper in Vectorize. The corpus detail and Library actions send identifiers only. Abstracts are stored for internal search. The ingest routes expose counts and job logs.

## HTTP contract

Both routes require `Authorization: Bearer <Firebase ID token>` from an accepted project and a verified lab account. Missing or invalid credentials return `401`, and an account outside the lab returns `403`. An authenticated request gets `503` with `error: "kg_not_configured"` when any of `KG`, `KG_VECTORS` or `AI` is absent. Errors use the worker's usual `{ error, message }` JSON shape.

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
