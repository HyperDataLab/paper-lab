# S8 — Codex review findings to fix (PR #9)

Codex reviewed branch `feat/s8-paragraph-structure-flow` against `main`; Claude checked each finding against the
code and confirmed all five. Same rules as `docs/briefs/S8.md` (no commit/push, no dependencies, UTF-8 without BOM
and LF line endings, never read `.env.development.local`, shared UI components only, do not edit `docs/briefs`).

## R1 (P1) — saving fails when a reviewed paragraph issue disappears after a re-run

`src/modules/evaluate/Page.tsx` (save, ~L162–175): `decisions` keeps reviews of issues that a structure re-run no
longer returns; `save()` then calls `reviewIssue` for a nonexistent id, which throws after `create` — the save fails
and leaves a partial history record. Fix: when issues are replaced (structure re-run, syntax re-run, judge
re-run), drop decisions whose `issueId` is no longer in the current issue list; in `save()` also replay only
decisions whose issue exists. Test: review a flow issue, re-run structure with output that no longer contains it,
save → succeeds, one `create_analysis`, no audit event for the vanished issue.

## R2 (P2) — the structure analysis model is not saved

`versions.model` comes from syntax or the judge; the paragraph analyzer's `model` is dropped. Add
`versions.structureModel` (`z.string().nullable().default(null)`), save it with `structurePrompt`, restore it on
reopen (`useParagraphAnalysis.load`). Test: save → `versions.structureModel === 'fake'`.

## R3 (P2) — placeholder pairs (no model output) are counted as measured flow problems

`src/core/paragraph/metrics.ts`: a pair the model omitted becomes a confidence-0 `shift`/`none` placeholder but is
counted in `unexplained_topic_shift_count`, `topic_continuity_pattern`, `discourse_relation_coverage` and (with
spans) `stress_to_next_topic_alignment`. Fix: mark placeholders explicitly (e.g. `FlowLink.measured: boolean`,
default `true` so old records parse; validation sets `false` for missing pairs) and exclude unmeasured pairs from
every pair numerator and denominator (null when none are measurable). `paragraphIssues` should skip unmeasured
pairs via the same flag instead of `confidence <= 0`. Show "Không có đánh giá của AI" for such pairs in the
`Cấu trúc đoạn` tab. Tests: one measured + one missing pair → denominators 1; all missing → values null; no issue.

## R4 (P2) — structure confidence belongs to another type

`validateParagraphStructure.ts` (~L22–26): `confidence` is the maximum score even when the model's `type` is a
different type (e.g. `TS-D` 0.1, `LD` 0.9 → shown as TS-D 90 %). Fix: `confidence = typeScores[type]`; if the
chosen type's score is < 0.4 or more than 0.2 below the top score, use `UNKNOWN` with `confidence =
typeScores.UNKNOWN ?? top`. Tests for both cases.

## R5 (P2) — AI analysis after saving is never stored

After a new analysis is saved, `Phân tích cấu trúc đoạn (AI)` (and likewise `Phân tích câu (AI)` / `Đánh giá theo
ngữ cảnh (AI)`) stay enabled while `Lưu vào lịch sử` is disabled, so new results are shown but lost on reopen. Fix:
once saved, disable the three AI buttons with the hint "Đã lưu — chọn Chỉnh sửa văn bản để phân tích lại" (human
review decisions after saving keep working through `reviewIssue`). Test: after save the three buttons are disabled.

Definition of done: run one at a time `npm run typecheck`, `npm run lint`, `npm run format:check`,
`npm run test:cov`, `npm run build`; all pass; report per item.
