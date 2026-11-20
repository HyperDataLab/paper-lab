# 0007 Central lab store replaces browser-local storage

Status: Accepted (owner, 2026-11-19). Supersedes ADR-0002 (local-first storage). Slices C0–C4 are done: since C4 the browser keeps no lab data.

## Context

Owner decision (2026-11-19): "database của lab là tập trung, không dùng IndexedDB của trình duyệt. chỉ dùng cơ chế phân quyền để đảm bảo privacy (làm sau)". The owner also said existing data is sample data and does not need to be migrated: "phần dữ liệu bài báo cũ không cần thiết phải đưa lên, tất cả chỉ là sample".

Until now every record lived in the user's browser (Dexie, 31 tables). The exceptions already on the server were:

- corpora (R2, synced with ETags);
- PDFs and GROBID TEI (R2);
- published paper models, SCG graphs and plans (R2);
- the lab KG (D1).

Agents, the lab KG and other members could not see each other's work.

## Decision

1. **The server is the only store for lab data.**
   - **D1 database `paperlab-data`** holds one `doc` row per record: collection, id, version, R2 key, size, sha256, created/updated by and at, deleted_at, project/corpus/paper ids, doi, title, kind, status, small summary JSON. These rows replace Dexie's indexes. D1 also holds small append-only rows (audit events, library items, review n-grams, topic names).
   - **R2 (`paper-fetch`, prefix `paperlab/data/`)** holds the record bodies, one immutable object per version: `{collection}/{id}/v{n}.json`. PDFs stay at `paperlab/pdfs/`.
2. **Writes are conditional.**
   - Each write sends its expected version (`If-Match` / `If-None-Match: *`). A mismatch returns 409 with the server version and surfaces in the UI as a storage conflict.
   - Changes that touch several records go through one commit endpoint, applied as one atomic D1 batch.
3. **Same interface for the app.** The app keeps one `Repositories` interface backed by a `DocStore` port. The remote implementation keeps data in memory only, with no IndexedDB. Tests use an in-memory implementation and the worker's D1/R2 test fakes, with D1's real limits enforced (≤ 100 bound parameters, ≤ 5 compound SELECT terms).
4. **Permissions come later.**
   - Every row is stamped with `created_by`, `updated_by`, `project_id` / `corpus_id`, `lab_id` and `visibility` (default `lab`), so permissions can be added without migrating data.
   - Until then, any signed-in lab account can read and write all lab data. Since the Writing Bank site is also accepted, that includes accounts signing in through Writing Bank.
5. **What stays in the browser:** the 9router key, model settings, AI consent and UI preferences (localStorage). LLM calls stay browser-side on the user's own key.
6. **No migration of existing local data.** Dexie is removed (C4), with its tables, migration tests and dependency. The app no longer opens the old paragraph-lab IndexedDB database, and does not delete it either. PDFs are read from R2 and held in memory for the session only. Signed out, data screens ask for the lab sign-in; an unconfigured store (503 data_not_configured) is an error shown to the user, not a fallback.

## Consequences

- No offline mode. An LLM run loses progress since its last flush if the tab dies, so hot checkpoints are coalesced (at most one write every ~2 s, flushed at stage end), and large runs split their checkpoint state into small records.
- List pages read D1 summary rows instead of whole documents. Per-paper pages need batch reads.
- Extraction matrices, papers and per-paper records become conflict-visible for the first time.
- Bandwidth grows with multi-MB documents. Splitting corpora and runs into smaller documents may follow.
