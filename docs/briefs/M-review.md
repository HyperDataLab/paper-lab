# Brief — fixes from the independent review of M1–M5

Developer: Codex. Acceptance: Claude. Branch: `fix/measurement-review` (already checked out).

Rules: work only in this repo; no commit/push; no new dependencies; UTF-8 without BOM and LF, patch tool only (never PowerShell `Set-Content`/`Out-File`/`>`); keep Vietnamese diacritics; never read or print `.env.development.local`; shared UI components only; do not edit `docs/briefs`; `npm.cmd` if PowerShell blocks `npm`; test fixtures stay synthetic.

Read first: `docs/PRD_Measurement.md` §5 and §8, `src/core/measurement/{build,review,export}.ts`, `src/core/schemas/measurement.ts`, `src/shared/llm/llmMeasurement.ts`, `src/modules/paper-import/PaperMeasurement.tsx`.

## 1. Persist the call count before each request

`PaperMeasurement.tsx`: `onRequest` only updates memory, so a request that fails or is cancelled is not counted on resume, and the budget can be exceeded. Create the checkpoint object in `start` and pass it to `llmMeasurement` (it is mutated in place). In `onRequest`, save `{ sectionIds, callsUsed, checkpoint }` with `repo.measurements.savePending` so the count is durable before the request goes out, including for the first classification request.

## 2. Keep resumable state when linking or findings fail

`PaperMeasurement.tsx`: save the pending checkpoint after `saveRun` whenever `result.profile.status === 'partial'`, not only when extraction units failed. `llmMeasurement.ts`: when a new link result is saved, set `checkpoint.findings = null`, because findings depend on the linked profile.

## 3. A human edit must not stay an author statement

- Add `HUMAN_EDITED` to `FieldStatusSchema`. The model must not be able to return it (exclude it from `ModelStatusSchema` as `NOT_CHECKED` is). Rank it in `build.ts`. Label in UI and Markdown: `Người duyệt sửa`.
- `review.ts`, on an `edit` whose value differs from the current one, for a `ProfileField`:
  - If the field was `REPORTED`, the new value is non-null and `containsExact` finds it in the `source_excerpt` of one of its evidence items, keep `REPORTED` and keep the evidence ids that contain it.
  - Otherwise the status becomes `HUMAN_EDITED` and `evidence_ids` becomes empty.
  - `needs_review` becomes false in both cases.
- Same rule for edits to a `ReportedResult` (`value`, `unit`, `uncertainty`): when the new value is not in the evidence, status `HUMAN_EDITED`, `evidence_ids` empty, `source_table_cell` null.
- After applying edits, recompute each metric's `evidence_ids` from its fields (export `fieldEvidence` from `build.ts`) so exports do not cite removed evidence.
- The AI original stays untouched (AC-07).

## 4. Check formulas before merging same-name metrics

`build.ts`: the same-name match must also require `compatibleFields(item.formula_text, usage.formula_text)`, as `canMerge` in `link.ts` does.

## 5. Tests (IDs in names)

Update the existing AC-07 tests in `review.test.ts` to the new rule. Add: a supported edit stays REPORTED with only the supporting evidence; an unsupported edit becomes HUMAN_EDITED with no evidence; a result edit clears the table cell; metric `evidence_ids` are recomputed; `HUMAN_EDITED` is rejected in model output; AC-02 two usages with the same name and different reported formulas stay apart; UI: the call count is saved before a request that then fails, and a partial run with a failed link step offers `Tiếp tục`; `llmMeasurement`: a fresh link result clears stored findings.

## 6. Definition of done

Run one at a time: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:cov -- --maxWorkers=2`, `npm run build`. Report files changed, test counts, command results and anything not done.
