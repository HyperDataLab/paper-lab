# SCG paper v1 (`/v1/papers/:id/scg`)

SCG slice S4. PaperLab publishes one paper's Scientific Contribution Graph (contributions, their prerequisites and
matches to other lab papers) through the pdf worker, next to the paper's published paper model, so that Writing
Bank and SRD can read it.

- Schema: `schemas/scg-paper-v1.schema.json` (public copy `public/schemas/scg-paper-v1.schema.json`).
- Synthetic example: `schemas/examples/scg-paper-v1.example.json`.
- Code: `src/core/scg/publish.ts` (`ScgPaperPublishSchema`, `projectScgPaper`, `scgBodyEtag`), route
  `worker/src/scg.ts`, client `src/shared/pdfStore/scgPublished.ts`, button "Công bố đồ thị đóng góp" in the
  paper's SCG view (`PublishScg.tsx`).
- Regenerate with `npm run schema:paper-model` (the script writes every contract file).

## What the record holds

- `format: "paperlab-scg-paper"`, `schemaVersion: 1`. Reject any other version.
- `paperId`: the id the paper model is published under (`sha256-<hex>` of the file, or the local UUID for a paper
  without a file hash). `doi`, `s2CorpusId` (Semantic Scholar corpus id, or null).
- `idBase`: the prefix of the contribution ids (`<idBase>.c<n>`, prerequisites `<idBase>.c<n>.p<m>`). It is the
  S2 corpus id when it was known at the paper's first run, else PaperLab's local paper id; it is not `paperId`.
- `promptVersion`, `promptVersions` (contributions, prerequisites, alignment), `requestedModel`, `model`,
  `createdAt` (when the run started).
- `contributions[]`: `id`, `name`, `description`, `types[]` (SCG's 17 type ids, each with an explanation),
  `sections` (section titles), `sourceSentenceKeys`, `review`, `prerequisites[]`.
- `prerequisites[]`: `id`, `name`, `description`, `explanation`, `coreOrPeripheral`, `references[]` (a paper of
  the reference list, another contribution of the same paper, or a tool URL), `matches[]` (a contribution of
  another lab paper, `strong` or `weak`, with `review`), `sourceSentenceKeys`, `review`.

Only items that are not rejected are published, at every level; references to a rejected contribution of the
same paper are dropped too. `review` is `candidate` (machine output nobody has checked yet) or `accepted` (a lab
member accepted it). A reader that wants only reviewed knowledge keeps `accepted`.

Evidence is sentence keys only: no sentence text or quotes. The keys are the content keys of the published paper
model's `sentences` (`GET /v1/papers/:id/model`), where a reader finds the text. Names, descriptions and
explanations are model-written summaries, not paper text. The run's working state (checkpoints, carried reviews,
dropped counts) is not published.

## Routes

All routes need a signed-in lab account (same token check as the other `/v1` routes). Errors use
`{ "error", "message" }`.

### `PUT /v1/papers/:id/scg`

Body: the record, at most 2 MiB. The worker:

1. returns 404 `paper_not_published` when there is no published paper model for `:id`;
2. returns 400 `bad_request` for bad JSON, a body that fails the schema (extra fields, a `rejected` state, another
   version), or a `paperId` that is not `:id`; 413 above 2 MiB;
3. returns 409 `conflict` when a `sourceSentenceKeys` entry is not a sentence of the published model (the model
   and the run disagree: republish the model, or re-run the extraction, then publish the graph);
4. stores the body as is at `paperlab/scg/<id>.json` and answers `{ paperId, etag, updatedAt, unchanged }`.

The ETag is the SHA-256 hex of the exact bytes sent. Policy: **overwrite with a new ETag**. A graph can be
re-reviewed after it is published, so a new body replaces the old one and gets a new ETag and `updatedAt`; the
same body again is `unchanged: true` and keeps `updatedAt`. There is no history: readers that need a fixed
version keep the ETag and body they read. The worker also records the paper model's ETag at publish time
(`modelEtag` in the list), so a reader can tell when the model was republished after the graph.

### `GET /v1/papers/:id/scg`

The stored record with a quoted `ETag`. `If-None-Match` with that ETag (weak or strong) gives 304. 404
`not_found` when the paper model is published but no graph is; 404 `paper_not_published` when there is no
model either.

### `GET /v1/scg?cursor=`

`{ items: [{ paperId, doi, s2CorpusId, idBase, contributions, updatedAt, etag, modelEtag }], nextCursor }`, up to 100
items a page; `contributions` is the number of published contributions. Pass `nextCursor` back as `cursor`
until it is null.

There is no lookup by contribution id. To resolve `<idBase>.c<n>` (for example a match), strip `.c<n>`, find the
list item with that `idBase` and read that paper's graph.

## Who can read it (for `_coord`)

- Any signed-in lab account (`@hyperdatalab.org`, verified Google account) with a token from a Firebase project
  in the worker's `ACCEPTED_PROJECT_IDS`: today PaperLab (`hyperdatalab-paragraph-lab`) and Writing Bank
  (`hyperdatalab-writing-bank`). SRD signs in with the PaperLab project, so its tokens are accepted.
- Browser calls also need the caller's origin in `ALLOWED_ORIGINS`. PaperLab's and Writing Bank's web.app and
  firebaseapp.com origins are listed; SRD's site origin is not, so SRD reads it from a server or script, or the
  owner adds its origin before SRD calls it from a browser.
- Only PaperLab writes graphs. Readers get candidates as well as accepted items and must show the difference.
- Nothing is reachable until the worker is deployed with this slice.
