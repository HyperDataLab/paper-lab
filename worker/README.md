# paperlab-pdf-worker

Stores ResearchHub project workspaces in the lab's R2 bucket (`paper-fetch`). PDF originals live in ResearchHub's
Files store; R2 keeps project/SHA-to-file-ID links and the derived GROBID cache. Legacy PDF copies remain only during
their on-demand migration to ResearchHub.

- `GET`/`HEAD`/`PUT /pdfs/<64 hex sha256>`. Every request needs `Authorization: Bearer <HyperDataLab SSO access token>`
  for a verified account on `@hyperdatalab.org` and `X-Project-Id` for the active ResearchHub project. The Worker
  verifies project access, uploads new bytes to ResearchHub's `POST /api/files`, and stores only the returned file ID
  in an R2 link record. Downloads and GROBID read the bytes back through ResearchHub's `GET /api/files/{id}`.
  PDFs left in the old PaperLab R2 path are copied to ResearchHub the first time their project opens them; the old
  R2 copy is retained as a migration backup.
  Otherwise 401 (no or bad token) or 403 (another domain).
- `PUT` accepts only `application/pdf`, at most 25 MiB, a body starting with `%PDF-` and whose SHA-256
  equals the path. A file already stored returns 200; a new one 201.
- CORS answers only the origins in `ALLOWED_ORIGINS` (`wrangler.toml`).
- The bucket is reached through the R2 binding, so the Worker holds no keys or secrets.

## ResearchHub project workspaces

`GET` and `PUT /v1/workspaces/<projectId>` store PaperLab data for one ResearchHub project in a single R2 JSON
object at `paperlab/workspaces/<projectId>.json`. The browser sends its SSO access token. The Worker validates it
through `SSO_BASE_URL`, then calls the ResearchHub Files API through the `RESEARCH_HUB` service binding and accepts
only a matching owned project. ResearchHub currently exposes owner projects through `GET /api/projects`; project
membership for collaborators is not available yet. The service binding avoids calling another Cloudflare Worker
through its public `workers.dev` URL, which Cloudflare restricts for Worker-to-Worker fetches.

Set `RESEARCH_HUB_API_URL` in this Worker to the deployed ResearchHub Files API base URL. Use the same URL
configured as ResearchHub's `NEXT_PUBLIC_FILE_API_URL`; if unset, workspace requests return 503. The SPA needs a
registered OIDC client ID and callback in `VITE_HYPERDATALAB_SSO_BASE_URL`,
`VITE_HYPERDATALAB_SSO_CLIENT_ID`, and `VITE_HYPERDATALAB_SSO_CALLBACK_URL`. Register the callback and allow the
PaperLab origins in the SSO provider. `projectId` is preserved through OIDC state and is never sent in the token URL.

`PUT` requires `If-None-Match: *` when creating a workspace or `If-Match: <ETag>` when updating it. A stale
version returns 412 and the app asks the user to reload. Payloads are capped at 25 MiB. The snapshot contains
papers, extraction projects, corpora, and paper-level analysis; standalone paragraph-writing records are omitted.
Legacy local data is copied once into the first linked ResearchHub project on this browser if the project has no
server workspace.

## OpenAlex PDF acquisition

`POST /v1/pdfs/openalex` accepts `{ "doi": "10.../...", "pdfUrl": "https://..." }` from an authenticated lab account.
The browser obtains the URL from OpenAlex's Open Access metadata and sends that URL to the Worker, avoiding a
second OpenAlex lookup from Cloudflare. The Worker accepts only public HTTPS URLs, validates every redirect,
requires a `%PDF-` signature and limits the file to 25 MiB. The PDF is validated in memory and is not stored in
R2. Add local dev origins to `ALLOWED_ORIGINS` before using the route from Vite.

## Published paper models

All `/v1` routes require a valid HyperDataLab SSO access token for the configured organization domain. Errors are
JSON with `error` and `message` fields.

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

All signed-in lab accounts may read and publish any frozen experiment plan; these routes are separate from
ResearchHub workspace authorization and use the same SSO token verification as the paper routes.
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

## GROBID full text

`POST /grobid/fulltext` accepts a PDF (up to 25 MiB); `POST /grobid/fulltext/<sha256>` fetches the
existing PDF from ResearchHub using the project/SHA-to-file-ID link. PaperLab sends `X-Project-Id` so the Worker verifies the active project.
Both require the same sign-in and return TEI XML, with `X-Grobid-Cache` and `X-Grobid-Ms` headers. TEI is cached
in R2 by PDF hash and GROBID version. The first request after
idle may take 30–60 seconds to start; after 120 seconds it returns 503 with a retry hint.
The container is billed while running, including idle time, and stops after 10 minutes of inactivity;
R2 and Worker usage have their own charges. The CRF image is pulled from a registry without Docker.
`npx wrangler deploy` requires the Workers Paid plan for Containers.

## Deploy

```bash
cd worker
npm ci
npx wrangler deploy
```

The app uses `https://paperlab-pdf-worker.hyperdatalab.workers.dev`; set `VITE_PDF_WORKER_URL` to use another URL.

Configure the PaperLab OIDC public client in HyperDataLab SSO before using sign-in. Firebase is used for static
Hosting deployment only; it does not authenticate PaperLab users.

## Test

```bash
npm run typecheck:worker
npm run test:worker
```
