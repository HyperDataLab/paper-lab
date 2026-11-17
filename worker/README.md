# paperlab-pdf-worker

Keeps PaperLab's original PDFs in the lab's R2 bucket (`paper-fetch`, under `paperlab/pdfs/<sha256>`).

- `GET`/`HEAD`/`PUT /pdfs/<64 hex sha256>`. Every request needs `Authorization: Bearer <Firebase ID token>`
  from the `hyperdatalab-paragraph-lab` project, for a verified Google account on `@hyperdatalab.org`.
  Otherwise 401 (no or bad token) or 403 (another domain).
- `PUT` accepts only `application/pdf`, at most 25 MiB, a body starting with `%PDF-` and whose SHA-256
  equals the path. A file already stored returns 200; a new one 201.
- CORS answers only the origins in `ALLOWED_ORIGINS` (`wrangler.toml`).
- The bucket is reached through the R2 binding, so the Worker holds no keys or secrets.

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

## GROBID full text

`POST /grobid/fulltext` accepts a PDF (up to 25 MiB); `POST /grobid/fulltext/<sha256>` reads an
existing PDF from R2. Both require the same sign-in and return TEI XML, with `X-Grobid-Cache` and
`X-Grobid-Ms` headers. TEI is cached in R2 by PDF hash and GROBID version. The first request after
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

Google sign-in must be enabled once in Firebase Console: Authentication → Sign-in method → Google
(project `hyperdatalab-paragraph-lab`). The app's hosting domains are authorised there by default.

## Test

```bash
npm run typecheck:worker
npm run test:worker
```
