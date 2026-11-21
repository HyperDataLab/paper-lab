# Central lab store: plan

Decision: `docs/adr/0007-central-lab-store.md`. Existing local data is sample data, so there is no migration step.

## Facts this plan rests on (survey 2026-11-19)

- **Dexie:** 31 tables (v1–v26). Only `pdfFiles` holds Blobs, and PDFs already live in R2. `researchDesignBanks.bytes` stores binary as a `number[]`.
- **Storage access already goes through `src/shared/storage`.** ESLint bans `dexie` imports elsewhere, and nothing uses `liveQuery`. But there is no interface yet (`Repositories = ReturnType<typeof createRepositories>`), there are about 50 multi-table transactions, and there are 23 `list()` call sites that load whole bodies.
- **Hot paths write whole documents often:** AutoResearch runs after every LLM call (0.5–5 MB), extraction projects after every paper (0.2–3 MB), measurement on every call, and corpora on every triage batch.
- **Limits:**
  - D1: 2 MB per row or value, 100 bound parameters, 100 KB per statement, 10 GB per database, ≤ 5 compound SELECT terms (in practice).
  - R2: metadata ≤ 8 KB, 1 write per second per key, so body keys must be versioned and immutable.
- **Templates already in the code:** corpus sync (R2 + ETag + `CorpusConflict` with "keep mine / take theirs"); `ResearchDesignConflictError` and `AutoResearchConflictError`; the KG D1 test fake (`worker/src/kg/testDb.ts`).

## Slices

- **C0 Interface and port** (no behaviour change):
  - an explicit `Repositories` interface;
  - one `StorageConflictError {collection, id, serverVersion}`, with the existing conflict errors kept as subclasses;
  - repositories rewritten over a `DocStore` port: `get`, `getMany`, `query` (index equality, order, limit), `put` (with expected version), `remove`, `unitOfWork` (a read set plus a batch of writes).
  - Implementations: `MemoryDocStore` for tests, and a temporary `DexieDocStore` so the app keeps working until C2.
- **C1 Server** in the existing PaperLab worker:
  - D1 `paperlab-data` with migrations for `doc` and the inline tables;
  - routes `GET/PUT/DELETE /v1/data/{col}/{id}`, `POST /v1/data/query`, `POST /v1/data/batch-get` and `POST /v1/data/commit` (an atomic D1 batch with version guards and invariant guards);
  - server-side Zod validation for each collection;
  - versioned R2 bodies, with orphan garbage collection by cron;
  - stamps from the token's email;
  - tests on the D1 and R2 fakes with real limits.
- **C2 Spike on extraction projects** (with research designs and AutoResearch runs): `RemoteDocStore` backs these collections, with an in-memory cache and a coalescing write-behind queue (≤ 1 write per 2 s per document, flushed at stage end, warning on `beforeunload`). Measure from Vietnam:
  - p50/p95 for listing, and for reading and writing bodies of 0.1, 1 and 5 MB;
  - commit latency for the freeze;
  - checkpoint cadence during an extraction run of 20 papers;
  - the conflict rate with two tabs open.

  Go if a single 1 MB save has p95 ≤ ~1.5 s and no checkpoint is lost.

- **C3 Remaining collections**, split by group between Codex and Opus:
  - papers and per-paper records;
  - corpora: drop `corpusSync`, so the corpus is just a doc;
  - library and keywords;
  - measurement, paperRuns, SCG, analyses and generations.

  Hot runs split their checkpoint state into small records. Per-paper pages use batch reads.

- **C4 Retire Dexie (done):**
  - RemoteDocStore is the only runtime store; MemoryDocStore stays for tests;
  - signed out, every data route shows a sign-in requirement (LabDataGate) and makes no data call; Settings and the Playground stay available;
  - 503 data_not_configured is shown as an error, with no browser fallback;
  - "Đưa dữ liệu lên" is not needed;
  - PDFs are uploaded to R2 at import and attach time and read from R2, with an in-memory cache for the session;
  - the Transfer page exports every collection from the server (paged queries, getMany for bank bodies) and imports through bounded, idempotent commits, including auditEvents and the project collections;
  - Dexie, ake-indexeddb, the Dexie tables, their migration tests, pdfFiles, corpusSync and LOCAL_KEYS are deleted; ESLint bans dexie and ake-indexeddb imports everywhere.
- **C5 Permissions** (later): filter on the `created_by`, `project_id`, `lab_id` and `visibility` columns.

After C4, the semantic layer (steps 1 → 4) builds on the same collection registry.

## C3 corpus follow-up deployment

1. Ensure the existing `worker/migrations-data` migrations are applied to `paperlab-data`, then deploy the
   PaperLab data worker with the admin import route.
2. Push the merged main commit to `deploy/topics-worker` to deploy the topics worker with its `DATA` binding.
3. Deploy Hosting, then sign in as a lab admin and choose **Cài đặt → Tài khoản lab → Nhập corpus cũ**.
   The importer follows the R2 cursor, adds missing records, and shows counts for imported, skipped and failed
   records.

## C2 verification after deploy

Apply `worker/migrations-data/0002_body_order.sql` to the lab data database, then deploy the updated worker
before deploying the app.
Signed-in sessions use the worker for extraction projects, research designs, bank snapshots and AutoResearch
runs. Before C4, a worker response of `503 data_not_configured` selected browser storage for the session; since C4 it is an error. Extraction audit entries are appended within their owning project commit. Other audit operations,
the 9router key and AI consent keep their existing storage.

Run the latency probe from the network you want to measure. Supply a current PaperLab ID token through
`PAPERLAB_DATA_TOKEN`. Set `PAPERLAB_DATA_URL` to override the deployed worker URL and optionally set
`PAPERLAB_DATA_SAMPLES` to change the default of 20 timed requests per operation.

```sh
node scripts/measure/dataStore.mjs
```

The probe creates temporary extraction projects with 0.1, 1 and 5 MB JSON bodies. It reports p50 and p95
for list summaries, lists with bodies, GET and conditional PUT, followed by a commit with a 1 MB write and
a separate read guard. It soft-deletes its projects on exit. Use the browser Network panel to record PUT
spacing during a 20-paper run, then repeat with two signed-in tabs to measure conflicts. Check that each
stage's final checkpoint reaches the worker and reloads from a new tab.

## C3 PAPERS verification

Deploy the worker before the app so the paper page can batch references from different collections in
one request. The paper group uses the indexes and sort keys from the existing migrations. There is no new
D1 migration or upload of old browser data. Since C4, signed-out sessions see a sign-in requirement and unconfigured ones an error.

Paper run and measurement progress use separate checkpoint documents capped at 1 MiB each. The browser
coalesces each stream and flushes at run completion, pause, or failure. Measurement history is written
when a run or a review is saved. The checkpoint manifest and its changed parts commit together.
