# DESIGN.md

UI and interaction rules for Paragraph Lab. Implements PRD §6 (Highlight and annotation UX) and §9 (Accessibility).

## 1. Navigation: collapsible sidebar driven by a module registry

**Decision.** The app uses a **left vertical sidebar** grouped by section, collapsible to an icon rail, and a
slide-in drawer below 768 px. A horizontal top menu was rejected: it runs out of room after 5–6 items, and this
product will keep adding modules (Section/IMRaD, Citation, Figure captions, Batch, Calibration…).

```
┌───────────────┬──────────────────────────────────────────────────────────┐
│ ◧ Paragraph Lab│ Breadcrumb: Đánh giá › Phân tích #12        [⌘K] [⚙]   │
│───────────────│──────────────────────────────────────────────────────────│
│ PHÂN TÍCH     │                                                          │
│  ◉ Đánh giá   │                 module page                              │
│  ✎ Chỉnh sửa  │                                                          │
│  ✚ Soạn đoạn  │                                                          │
│ DỮ LIỆU       │                                                          │
│  ⟲ Lịch sử    │                                                          │
│  ⇅ Xuất/Nhập  │                                                          │
│ SẮP CÓ        │                                                          │
│  ▢ Hiệu chuẩn │  (disabled, "Sắp có" badge)                              │
│───────────────│                                                          │
│ ⚙ Cài đặt     │                                                          │
│ « Thu gọn     │                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
```

- Items come from `src/app/modules.ts`. Each `ModuleDefinition` has `id`, `label` (vi), `icon`, `path`,
  `group: 'analysis' | 'data' | 'labs' | 'system'`, `order`, `status: 'ready' | 'beta' | 'soon'`, `page` (lazy).
- `soon` modules render disabled with a badge; `beta` shows a small "Beta" pill.
- Collapsed state is remembered in `localStorage` (try/catch). Widths: 240 px expanded, 64 px rail.
- Active item: left accent bar + bold label + `aria-current="page"`. Keyboard: Tab order follows the list,
  `Ctrl/⌘+K` opens a command palette listing the same registry entries.
- Inside a module, sub-views use **tabs** (e.g. Evaluate: `Văn bản | Số liệu | Cấu trúc đoạn | JSON`), never a
  second sidebar.

## 2. Evaluate workspace layout (PRD §6 A–D)

The existing sidebar remains the first column. Evaluate uses the full remaining width. At ≥ 1280 px,
the document and sticky inspector use `minmax(0, 1fr) 380px` with a 24 px gap; at 1024–1279 px,
the inspector is 320 px. The reading area is centred and capped at 72ch. At 768–1023 px, the
inspector opens in a right drawer; below 768 px, it appears below the document.

```
┌──────────────── A. Paragraph (immutable source, highlights) ─────────┬── C. Inspector ──────┐
│ [S1] The performance of the proposed model, ‹after extensive …›,     │ SUBJECT_VERB_GAP     │
│      was ‹dramatically› improved.                                    │ moderate · candidate │
│      T: The performance… · A: was improved · S: — · Role: Lead       │ metric: 9 tokens     │
│ [S2] These improvements are ‹very› significant.                      │ rule: ≥8 (heuristic) │
│      ⤷ flow link S2 stress → S3 topic                                │ why / fix / Schimel  │
├──────────────── B. Metrics & scores ─────────────────────────────────┤ [Xác nhận] [Bỏ qua]  │
│ Overall 68 ± (coverage 0.8, conf 0.7, rubric schimel-paragraph-v1)   │                      │
│ Sentence 62 · Verb 70 · Concise 75 · Organization 60 · Flow 72       │                      │
└──────────────────────────────────────────────────────────────────────┴──────────────────────┘
Filter bar: Tất cả | Đã xác nhận | Ứng viên | Câu | Mạch | Từ ngữ   [ẩn độ tin cậy thấp]
D. Diff (Revise module): side-by-side before/after with aligned change spans.
```

## 3. Issue highlighting

Color is never the only signal (WCAG 1.4.1). Each category has a color **and** a line style **and** a label.

| Category                                          | Token            | Light / dark                 | Marker                            |
| ------------------------------------------------- | ---------------- | ---------------------------- | --------------------------------- |
| Structure (sentence, S–V gap, clause depth)       | `--hl-structure` | orange `#C2410C` / `#FB923C` | solid underline 2px               |
| Flow & coherence                                  | `--hl-flow`      | purple `#7E22CE` / `#C084FC` | dashed underline + connector line |
| Word choice (verbs, modifiers, jargon, wordiness) | `--hl-word`      | blue `#1D4ED8` / `#60A5FA`   | dotted underline                  |
| Paragraph organization                            | `--hl-org`       | teal `#0F766E` / `#2DD4BF`   | left border on the sentence       |
| Meaning risk (critical only)                      | `--hl-critical`  | red `#B91C1C` / `#F87171`    | double underline + ⚠ icon         |

- Severity changes weight, not hue: `info` outline only, `minor` 1px, `moderate` 2px, `major` 3px, `critical` double.
- Status: `candidate` = 60 % opacity; `confirmed_*` = full; `dismissed_by_human` = strikethrough in the list,
  hidden in the text by default.
- Highlight the smallest causal span. Relationship issues mark both endpoints and draw a connector (SVG overlay).
- Overlaps: stacked underlines (max 3 visible) and click-to-cycle; a `+n` chip opens the full list.
- Every highlight is a `<mark>` with `role="button"`, `tabindex="0"`, `aria-label="<type>, <severity>, <status>"`.
- Rendering maps stored code-point offsets to UTF-16 in one helper; never slice the DOM text to compute offsets.

## 4. Visual tokens

- Fonts: UI `Inter` (vi diacritics OK); analysed text `Source Serif 4` 17px / 1.7 for reading; code `JetBrains Mono`.
- Spacing scale 4 px; radius 6 px (controls) / 10 px (cards); shadows only on overlays.
- Neutral palette on `:root` (`--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`), redefined
  for dark mode under `prefers-color-scheme: dark` and `[data-theme="dark"]`. Contrast ≥ 4.5:1 for text.
- Components live in `src/shared/ui/` (Button, IconButton, Tabs, Badge, Card, Drawer, Tooltip, Toast, Kbd, Empty).
  Modules compose these; no one-off styled buttons in modules. Styling: CSS Modules + CSS variables.
- Icons: `lucide-react`.

## 5. Copy and states

- Vietnamese UI copy, sentence case, short verbs ("Phân tích", "Xác nhận", "Bỏ qua", "Áp dụng bản sửa").
- Scores always carry their context: never a bare number without coverage / confidence / rubric version.
- Findings wording follows the PRD distinction: "Ứng viên cần xem lại" (review candidate), "Gợi ý văn phong"
  (stylistic suggestion), "Vi phạm đã xác nhận" (confirmed). Default to the weakest label when unsure.
- Every async view has loading (skeleton), empty (explain + primary action), error (message + retry + details).
- AI actions show the privacy notice once per consent version before the first call.
