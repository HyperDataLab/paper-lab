# paperlab-pdf-worker

Keeps PaperLab's original PDFs in the lab's R2 bucket (`paper-fetch`, under `paperlab/pdfs/<sha256>`).

- `GET`/`HEAD`/`PUT /pdfs/<64 hex sha256>`. Every request needs `Authorization: Bearer <Firebase ID token>`
  from the `hyperdatalab-paragraph-lab` project, for a verified Google account on `@hyperdatalab.org`.
  Otherwise 401 (no or bad token) or 403 (another domain).
- `PUT` accepts only `application/pdf`, at most 25 MiB, a body starting with `%PDF-` and whose SHA-256
  equals the path. A file already stored returns 200; a new one 201.
- CORS answers only the origins in `ALLOWED_ORIGINS` (`wrangler.toml`).
- The bucket is reached through the R2 binding, so the Worker holds no keys or secrets.

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
