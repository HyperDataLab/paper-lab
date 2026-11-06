# S8 acceptance — defects to fix

Found by Claude in a live run with 9router (`cx/gpt-6-luna`) on the PRD §6 paragraph. Same rules as
`docs/briefs/S8.md`. What works: button gating ("Cần phân tích câu trước"), consent, TS-D 62 % with type scores,
central point 3/4, roles (Câu chủ đề / Phát triển / Phát triển) as badges with aria-labels, the flow chain and
metrics with numerator/denominator.

## G1 — the PRD flow break is missed when the model says `other`

Live output for S2 → S3: `continuity: shift`, `discourseRelation: other`, `linked: false` → no issue, although
this is exactly the PRD §6 `FLOW_BREAK_CANDIDATE`. `other` without a named relation is not evidence of a motivated
shift.

- Rule: `FLOW_BREAK_CANDIDATE` when `linked: false` **and** `continuity: 'shift'` **and** relation is `none` or
  `other`, confidence ≥ 0.5. `UNEXPLAINED_TOPIC_SHIFT` when `continuity: 'shift'` and relation `none` but
  `linked: true` or confidence < 0.5. No issue when the relation is elaboration / cause / contrast / example /
  sequence / restatement.
- Metrics: `discourse_relation_coverage` counts only the named relations (not `none`, not `other`);
  `unexplained_topic_shift_count` counts shifts with `none` or `other`.
- Prompt: bump to `para-struct-2`; say "use `other` only when you can name the relation in `rationale`; if no
  relation is defensible use `none`".
- Test with the live-like output (shift / other / not linked) → one `FLOW_BREAK_CANDIDATE` with the two spans
  "very significant" → "Several experiments".

## G2 — raw English keys in the Cấu trúc đoạn tab

- Metrics show keys (`sentence_role_coverage: 3/3 · 1`). Use Vietnamese labels with the fraction and a
  percentage: "Câu có vai trò rõ: 3/3 (100 %)", "Câu lạc đề: 0/3", "Cặp nối Stress → Topic: 1/2 (50 %)",
  "Chuyển chủ đề chưa giải thích: 0/2", "Cặp có quan hệ diễn ngôn: 2/2 (100 %)", "Mức rõ của ý chính: 3/4 (Khá
  rõ)"; keep the key in a `title` attribute.
- Continuity and relation values show raw English (`stress_to_topic · restatement`, `shift · other`). Labels:
  Stress → Topic, Topic → Topic, Phái sinh, Chuyển chủ đề; Giải thích thêm, Nguyên nhân, Đối lập, Ví dụ, Trình
  tự, Nhắc lại, Khác, Không có.
- The continuity counts (`stress_to_topic: 1/2 cặp`…) use the same labels.

## G3 — generic explanations for structure / flow issues

Give each type a specific Vietnamese `why` and `suggestedFix`:

- `FLOW_BREAK_CANDIDATE`: why "Phần nhấn cuối câu {N} không dẫn sang chủ đề đầu câu {N+1}; người đọc phải tự nối
  hai ý." fix "Cân nhắc mở câu {N+1} bằng thông tin vừa nhấn ở câu {N}, hoặc thêm từ nối nêu rõ quan hệ — không
  thêm dữ kiện mới."
- `UNEXPLAINED_TOPIC_SHIFT`, `OFF_TOPIC_SENTENCE`, `CENTRAL_POINT_WEAK`: similar, specific, no claim of a proven
  error. Append the model `rationale` for that pair/sentence after the template when present.
- Metric for flow issues: `{ name: 'stress_to_next_topic_alignment', value: 0, unit: 'pair' }` → shown as "Không
  nối Stress → Topic".

## G4 — tests still missing from brief §6

Add explicit tests for: top type score < 0.4 → `UNKNOWN`; non-adjacent and duplicate pairs dropped; missing pair →
shift/none with "no model output"; denominator 0 → null metrics (one-sentence paragraph); deterministic issue ids
across two runs; re-run keeps human decisions (`mergeHumanDecisions`) for paragraph issues; `CENTRAL_POINT_WEAK`
when identifiability ≤ 1 (with and without a central sentence); `OFF_TOPIC_SENTENCE`; editing the text or re-running
syntax clears the structure result (UI). Raise `core/paragraph` statement coverage to ≥ 90 %.

Definition of done: typecheck, lint, format:check, test:cov, build pass (run them one at a time); report per item.
