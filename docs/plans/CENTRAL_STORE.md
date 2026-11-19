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

- **C4 Retire Dexie:**
  - the remote store becomes the default;
  - "Đưa dữ liệu lên" is not needed;
  - the Transfer page exports from the server;
  - remove the Dexie tables and keep their migration tests until the code is deleted.
- **C5 Permissions** (later): filter on the `created_by`, `project_id`, `lab_id` and `visibility` columns.

After C4, the semantic layer (steps 1 → 4) builds on the same collection registry.
