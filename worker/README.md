# paperlab-pdf-worker

Keeps PaperLab's original PDFs in the lab's R2 bucket (`paper-fetch`, under `paperlab/pdfs/<sha256>`).

- `GET`/`HEAD`/`PUT /pdfs/<64 hex sha256>`. Every request needs `Authorization: Bearer <Firebase ID token>`
  from the `hyperdatalab-paragraph-lab` project, for a verified Google account on `@hyperdatalab.org`.
  Otherwise 401 (no or bad token) or 403 (another domain).
- `PUT` accepts only `application/pdf`, at most 25 MiB, a body starting with `%PDF-` and whose SHA-256
  equals the path. A file already stored returns 200; a new one 201.
- CORS answers only the origins in `ALLOWED_ORIGINS` (`wrangler.toml`).
- The bucket is reached through the R2 binding. Worker secrets can include `SCIATLAS_API_KEY` and
  `OPENALEX_API_KEY`.

## Published paper models

All `/v1` routes require the same verified Google account and domain as the PDF routes. The optional
`ACCEPTED_PROJECT_IDS` variable is a comma-separated list of accepted Firebase project IDs; when absent,
only `FIREBASE_PROJECT_ID` is accepted. Errors are JSON with `error` and `message` fields.

- `PUT /v1/papers/:paperId/model` publishes JSON up to 10 MiB. For example, put
  `{"format":"paperlab-paper-model","schemaVersion":1,"generatedAt":"2026-01-01T00:00:00Z","document":{"metadata":{"title":"Synthetic study"},"source":{"sha256":null}},"sentences":[]}`
  to `/v1/papers/00000000-0000-4000-8000-000000000001/model`. The response includes `paperId`,
  `etag`, `updatedAt`, and `unchanged`. A SHA-based ID must match the model's source hash.
- `GET /v1/papers?doi=10.1234%2Fexample` lists up to 100 objects from an R2 page with `items` and
  `nextCursor`. Optional filters are `doi` (case-insensitive), `sourceSha256`, and `updatedSince`;
  pass `cursor` to read the next page. Filters apply to each page after it is retrieved.
- `GET /v1/papers/00000000-0000-4000-8000-000000000001/model` returns the stored model and its
  `ETag`. Send that value in `If-None-Match` to receive 304 when it is unchanged.

The ETag is the SHA-256 of the JSON model with `generatedAt` removed. Republishing only a new
`generatedAt` preserves the stored model and publication timestamp.

`PUT /v1/papers/:paperId/experiment-facts` publishes facts for an existing model. For example, after
publishing the synthetic model above, use its returned ETag in this invented body:
`{"format":"paperlab-experiment-facts","schemaVersion":1,"paperId":"00000000-0000-4000-8000-000000000001","modelEtag":"<64-character model etag>","generatedAt":"2026-01-01T00:00:00Z","facts":[{"status":"candidate","value":"Synthetic result"}]}`.
The model ETag must match the current published model, otherwise the response is 409; a missing model
returns 404. The response has `paperId`, `etag`, `updatedAt`, and `unchanged`. The facts ETag hashes the
JSON without `generatedAt`. The model list marks facts as `reviewed` when all are accepted, or `candidate`
otherwise. Republishing a changed model preserves the old facts and their status so readers can identify
the older model via `modelEtag`. `GET /v1/papers/:paperId/experiment-facts` returns the stored JSON and
quoted ETag; `If-None-Match` returns 304 for unchanged content.

## Experiment fact requests

`GET /v1/me` returns the authenticated email and `admin` boolean. Admins are configured in the
comma-separated `ADMIN_EMAILS` Worker variable; every admin route enforces this role. All examples below
are invented. After publishing the synthetic model above, a lab account can POST
`{"note":"Please measure the synthetic experiment"}` to
`/v1/papers/00000000-0000-4000-8000-000000000001/experiment-facts/requests`. It receives 202 with
`requestId` and `state`. A requested or approved request is returned unchanged on a repeated POST;
declined or done requests can be replaced. A missing paper returns 404, and published facts return 409.
Notes are optional and limited to 1000 characters. GET the same path for the request and its ETag;
`If-None-Match` supports 304. The paper list adds `factsRequest` when a request exists.

Admins can GET `/v1/admin/fact-requests?state=requested` (optional state and cursor) for paginated
requests with paper title and DOI. POST `{"decision":"approve","note":"Please proceed"}` or
`{"decision":"decline"}` to `/v1/admin/fact-requests/00000000-0000-4000-8000-000000000001/decision`.
Only requested entries can be decided. Publishing facts changes requested or approved entries to done;
approval does not start any measurement automatically.

## Frozen experiment plans

All signed-in lab accounts may read and publish any project; PaperLab projects have no member list.
These routes use the same Firebase token verification and `ACCEPTED_PROJECT_IDS` as the paper routes.
Project IDs are lowercase UUIDs, and versions are positive integers. The plan's `title` supplies the
project title. Plan JSON is limited to 5 MiB; its schema and freeze gate are checked before publication.
Validation failures return `422 plan_invalid` with `issues`. A version is immutable: an identical body
returns 200 with `unchanged: true`, and a different body returns 409.

- `PUT /v1/projects/00000000-0000-4000-8000-000000000001/plans/1` publishes the complete invented
  plan in `schemas/experiment-plan-v1.example.json`; success returns 201 with `projectId`, `version`, and `etag`.
- `GET /v1/projects?cursor=example-cursor` returns `{ items, nextCursor }`; omit the cursor for the first
  page. Each item includes `projectId`, `title`, `updatedAt`, `publishedBy`, and `latestVersion`.
- `GET /v1/projects/00000000-0000-4000-8000-000000000001/plans` returns `versions` in ascending order,
  each with `version`, `frozenAt`, `frozenBy`, and `etag`.
- `GET /v1/projects/00000000-0000-4000-8000-000000000001/plans/1` returns the original JSON and quoted
  ETag; send it in `If-None-Match` to receive 304.
- `GET /v1/projects/00000000-0000-4000-8000-000000000001/plans/1/package` returns a ZIP containing
  `manifest.json`, `plan.json`, and `plan.md`, with the same ETag and files as PaperLab's download.

Missing projects and versions return 404. Pagination follows the paper list: an R2 page is selected before
filtering for project records, so a page may be empty even when `nextCursor` is present.

## Draft measures

`POST /v1/measure` measures a writer's draft against feature registry v2 for Writing Bank (slice B4). The
body is `{ "format": "markdown" | "text", "text": "...", "title"?: "..." }`, at most 200 KB; it returns 200
with a `paperlab-draft-measure` v1 document (`schemas/draft-measure-v1.schema.json`). Bad JSON or shape,
or a method other than POST, returns 400; a body over 200 KB returns 413. Nothing is stored: the draft is
never written to R2 and never logged, and the response is `Cache-Control: no-store`.

Passive voice and tense need the spaCy parse. Set the optional `NLP_URL` variable (unset by default) to
the topics worker's base URL and the route sends the draft's body sentences to its `POST /nlp/parse` with
the caller's token; without it, or when that call fails, those features are `unavailable`. The contract,
with an example, is `docs/contracts/draft-measure.md`.

## SciAtlas related papers

`POST /v1/sciatlas/search` asks SciAtlas (OpenKG, `http://sciatlas.openkg.cn/v1/search`) for papers related
to a set of anchors: keywords and titles with a high/middle/low level, reference titles, an optional date
range, `topK` (at most 20) and a ranking profile. SciAtlas is plain HTTP, so the browser cannot call it from
the https app; the Worker calls it with the lab's token and returns `{ papers, requestId?, elapsedMs }`,
always with `Cache-Control: no-store`. Results are never stored in R2 and the query is never logged, because
the SciAtlas data licence is not stated. The contract is `docs/contracts/sciatlas-proxy.md`.

The token is the Worker secret `SCIATLAS_API_KEY`. It is never a `[vars]` entry, never committed and never
returned in a response. The owner sets it once (it asks for the value; paste the SciAtlas token there):

```bash
cd worker
npx wrangler secret put SCIATLAS_API_KEY
```

Without it the route answers `503 sciatlas_not_configured`. SciAtlas 401/403 (a bad or disabled token) become
`502 sciatlas_auth`, 429 (the daily quota is used up) stays `429 sciatlas_quota`, no answer within 60 seconds
is `504 sciatlas_timeout`, and any other failure is `502 sciatlas_error`.

## GROBID full text

`POST /grobid/fulltext` accepts a PDF (up to 25 MiB); `POST /grobid/fulltext/<sha256>` reads an
existing PDF from R2. Both require the same sign-in and return TEI XML, with `X-Grobid-Cache` and
`X-Grobid-Ms` headers. TEI is cached in R2 by PDF hash and GROBID version. The first request after
idle may take 30–60 seconds to start; after 120 seconds it returns 503 with a retry hint.
The container is billed while running, including idle time, and stops after 10 minutes of inactivity;
R2 and Worker usage have their own charges. The CRF image is pulled from a registry without Docker.
`npx wrangler deploy` requires the Workers Paid plan for Containers.

## Lab knowledge graph

Signed-in lab accounts can `POST /v1/kg/ingest` with up to 50 OpenAlex work IDs or DOIs and can read queue
counts and recent attempts from `GET /v1/kg/ingest/status`. `POST /v1/kg/search` finds related papers in the KG
(hybrid FTS5, keyword, title, Vectorize and graph signals, in the `/v1/sciatlas/search` shape), and
`GET /v1/kg/papers/:id`, `GET /v1/kg/keywords/:id`, `GET /v1/kg/stats` and `GET /v1/kg/overview` read it. Every KG route returns
`503 kg_not_configured` when any KG binding is missing. The five-minute cron drains the queue. Publishing an SCG also projects its
contributions and enqueues its DOI when D1 is bound. See the [Lab KG contract](../docs/contracts/lab-kg.md).

For first-time provisioning, run these steps on the HyperDataLab account from `worker/`.

1. Run `wrangler d1 create paperlab-kg`.
2. Put the returned ID in `wrangler.toml` in place of `TO_BE_CREATED_ON_DEPLOY`.
3. Run `wrangler d1 migrations apply paperlab-kg --remote`.
4. Run `wrangler vectorize create paperlab-kg-papers --dimensions=768 --metric=cosine`.

Wrangler 4.161.0 accepts the placeholder during config parsing. For a deployment without the KG resources,
comment out the `[[d1_databases]]`, `[[vectorize]]` and `[ai]` blocks. The cron can stay enabled. The worker
uses the existing `OPENALEX_API_KEY` secret if set. `OPENALEX_MAILTO` is unset by default and can be set to a
lab contact for OpenAlex.

## Central lab store

The lab's records (ADR-0007) live in the D1 database `paperlab-data` (binding `DATA`), one `doc` row per
record, with bodies in R2 at `paperlab/data/{collection}/{id}/v{n}.json` (one immutable object per version;
small inline collections keep their body in the row). Collections, their Zod schemas, index columns and size
caps are in `src/core/storage/collections.ts`. Every route returns `503 data_not_configured` without `DATA`.

- `GET /v1/data/:collection/:id` returns the body with `ETag: "v<n>"`; `If-None-Match` gives 304.
- `PUT` needs `If-Match: "v<n>"` or `If-None-Match: *` (otherwise 428). The body is validated on the server.
  A stale version returns `409 version_conflict` with `serverVersion`. `DELETE` with `If-Match` soft-deletes.
- `POST /v1/data/query` filters on index columns (`projectId`, `corpusId`, `paperId`, `refId`, `doi`, `title`,
  `kind`, `status`, `sourceSha256`) and returns summary rows, or bodies with `include: "body"`.
- `POST /v1/data/batch-get` reads up to 100 ids. `POST /v1/data/commit` applies up to 100 puts and deletes,
  100 read guards and 200 inline appends in one D1 batch: all of them land, or none (409 lists the conflicts).

Writes are stamped with the caller's email. The cron removes bodies that are no longer current after a day,
or at once when three versions behind. To provision on the HyperDataLab account, from `worker/`:

1. Run `wrangler d1 create paperlab-data`.
2. Put the returned ID in the `DATA` block of `wrangler.toml` in place of `TO_BE_CREATED_ON_DEPLOY`.
3. Run `wrangler d1 migrations apply paperlab-data --remote` (migrations in `migrations-data/`).

## Deploy

```bash
cd worker
npm ci
npx wrangler deploy
```

The app uses `https://paperlab-pdf-worker.hyperdatalab.workers.dev`; set `VITE_PDF_WORKER_URL` to use another URL.

Google sign-in must be enabled once in Firebase Console: Authentication → Sign-in method → Google
(project `hyperdatalab-paragraph-lab`). The app's hosting domains are authorised there by default.

## Test

```bash
npm run typecheck:worker
npm run test:worker
```
