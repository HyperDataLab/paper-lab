# S7 acceptance — defects to fix

Found by Claude in the browser (1440 px, 900 px, 375 px, light and dark). Same rules as `docs/briefs/S7.md`.
What works and must keep working: 3-column grid, card ↔ highlight selection, confirm / dismiss / undo, audit
events in order (`create_analysis` → `confirm` → `dismiss`), reopen restores statuses, tablet drawer after load.

## E1 — candidate highlights fade the text

`mark` gets `opacity: 0.6`, so the analysed words themselves turn grey and lose contrast (fails DESIGN §4,
contrast ≥ 4.5:1). Grammarly keeps the text at full contrast and only colours the underline. Fix: never change
the text colour or opacity of a highlight. Candidate vs confirmed differs only in the underline: candidate uses
the category colour at 60 % (`color-mix(in srgb, var(--hl-word) 60%, transparent)`), confirmed 100 %.
Underline: `text-decoration-thickness` by severity (info 1px dotted outline style, minor 2px, moderate 3px,
major 3px + light background tint), `text-underline-offset: 3px`, `text-decoration-skip-ink: none`. Hover:
light category-tinted background. Selected: tinted background + 1px outline. Same rules in dark mode.

## E2 — toolbar and tabs

- The `context_limited` notice sits beside the judge button and wraps it onto a new line. Put the buttons in one
  row (wrap only when needed, consistent gap 8 px) and the notice as a muted line **below** the toolbar.
- The `Văn bản | Câu & số liệu` switch looks like unstyled native buttons. Use the shared `Tabs` component (or
  extend it): text tabs with an accent underline on the active tab, `role="tablist"`/`tab`/`tabpanel`,
  `aria-selected`.
- The tablet "Gợi ý (N)" button belongs in the toolbar (brief §1), not inside the workspace body.

## E3 — suggestion panel closer to Grammarly

- Filters take four rows. Make them compact: one row of category chips (with counts) + a segmented control
  `Tất cả | Đã xác nhận | Ứng viên`, and "Ẩn độ tin cậy thấp" as a small switch/checkbox on the same row as
  the tabs or below in muted size. The `Cần xem | Đã xử lý` pair is a tab control (accent underline), not two
  bordered buttons.
- Collapsed card: first line small muted "● Từ ngữ" (category dot + label), second line the span in bold
  followed by "· <type label>" in muted text; no truncation of the type label on a 380 px panel when it fits;
  whole card is the button; a 1px separator between cards.
- Expanded card: raised surface (border + subtle shadow, radius 10 px), 3px left accent bar in the category
  colour, comfortable padding 16 px; the replacement line `~~in order to~~ → to` styled like Grammarly (struck
  original muted, suggestion bold in accent colour, on its own line); primary `Xác nhận` button filled,
  `Bỏ qua` as text button, `Sao chép gợi ý` as an icon button with tooltip; severity select compact.

## E4 — labels

- The details line shows the raw metric key (`redundant_phrase_candidates: 1 ứng viên`). Show a human label:
  lexical → "1 ứng viên", gap → "Khoảng cách chủ–vị: 9 token (ngưỡng thử nghiệm ≥ 8)", clause depth → "Độ sâu
  mệnh đề: 3 (ngưỡng ≥ 3)". Keep the raw key available in a `title` attribute for traceability.
- Highlight `aria-label` uses the category ("Từ ngữ, Nhỏ, …"); brief §2 asks for the type label ("Cụm từ dài,
  Nhỏ, Ứng viên cần xem lại").

## E5 — overlap rendering

Overlapping segments must show a second stacked underline (e.g. `box-shadow: inset 0 -2px` in the second
category colour, or a `::after` line) and, when more than two issues cover a segment, a small `+n` badge after
it that cycles on click. Click-to-cycle already works; keep it.

## E6 — tests still missing (brief §6)

Add: UI test that confirm / dismiss / undo / severity edit on a **saved** analysis call `reviewIssue` and write
audit events; unsaved decisions are audited on save (order after `create_analysis`); decisions made after the
first save of a new analysis are written immediately; missing-API-key message with the `/settings` link; a
non-BMP character before a span (code point vs UTF-16) renders the right text; dismissed issues are not
highlighted; `+n` overlap badge. Do not weaken existing assertions.

Definition of done: typecheck, lint, format:check, test:cov, build pass; report per item what changed.
