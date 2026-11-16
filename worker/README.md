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
