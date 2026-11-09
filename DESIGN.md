# DESIGN.md

UI and interaction rules for PaperLab. Implements PRD §6 (Highlight and annotation UX) and §9 (Accessibility).

## 1. Navigation: collapsible sidebar driven by a module registry

**Decision.** The app uses a **left vertical sidebar** grouped by section, collapsible to an icon rail, and a
slide-in drawer below 768 px. A horizontal top menu was rejected: it runs out of room after 5–6 items, and this
product will keep adding modules (Section/IMRaD, Citation, Figure captions, Batch, Calibration…).

```
┌───────────────┬──────────────────────────────────────────────────────────┐
│ ◧ PaperLab│ Breadcrumb: Đánh giá › Phân tích #12        [⌘K] [⚙]   │
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
  `group: 'analysis' | 'paper' | 'data' | 'labs' | 'system'`, `order`, `status: 'ready' | 'beta' | 'soon'`, `page` (lazy).
- Groups run **BÀI BÁO**, one **Đoạn văn** entry, **DỮ LIỆU**, then system. The app opens on the paper list. Paper work comes first because
  it is the product's main job; single-paragraph tools are secondary.
- `soon` modules render disabled with a badge; `beta` shows a small "Beta" pill.
- Collapsed state is remembered in `localStorage` (try/catch). Widths: 240 px expanded, 64 px rail.
- Active item: left accent bar + bold label + `aria-current="page"`. Keyboard: Tab order follows the list,
  `Ctrl/⌘+K` opens a command palette listing the same registry entries.
- Inside a module, sub-views use **tabs** (e.g. Evaluate: `Văn bản | Số liệu | Cấu trúc đoạn | JSON`), never a
  second sidebar.
- Evaluate's `Cấu trúc đoạn` tab shows the structure confidence, sentence roles, flow chain and metrics with denominators.
- Evaluate's `Điểm` tab shows the rubric, coverage, confidence, score evidence and provisional-scoring caveat.

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
D. Diff (Revise module): show original and revised text side by side from 1024 px, stacking them below that width. Code-aligned deletions use strikethrough and insertions use underlining as well as colour; labels identify each mark. List each change's rationale and issue IDs, and identify unexplained changes. Selecting a meaning check highlights its source or revised spans.
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
- When a flow finding is selected, a curved arrow connects its endpoint marks; its position is recalculated on resize.
- Overlaps: stacked underlines (max 3 visible) and click-to-cycle; a `+n` chip opens the full list.
- Every highlight is a `<mark>` with `role="button"`, `tabindex="0"`, `aria-label="<type>, <severity>, <status>"`.
- Rendering maps stored code-point offsets to UTF-16 in one helper; never slice the DOM text to compute offsets.

## 4. Visual tokens

- Fonts: `--font-ui` (Inter), `--font-reading` (Source Serif 4), `--font-mono` (JetBrains Mono).
  Reading text uses `--text-reading` (17 px) / 1.7.

| Tokens                                                    | Values                          |
| --------------------------------------------------------- | ------------------------------- |
| `--space-1`, `-2`, `-3`, `-4`, `-5`, `-6`, `-8`, `-10`    | 4, 8, 12, 16, 20, 24, 32, 40 px |
| `--radius-sm`, `--radius`, `--radius-lg`, `--radius-pill` | 4, 6, 10, 999 px                |
| `--text-xs`, `-sm`, `-base`, `-md`, `-lg`, `-xl`, `-2xl`  | 12, 13, 15, 16, 18, 20, 24 px   |
| `--control-h`, `--control-h-sm`                           | 36, 28 px                       |

- Semantic colours include `--danger`, `--success`, `--warning`, `--scrim` and the existing highlights;
  `--soft` is a subdued surface for selected and highlighted content. `--shadow-overlay` is for overlays only.
- Neutral palette on `:root` (`--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`), redefined
  for dark mode under `prefers-color-scheme: dark` and `[data-theme="dark"]`. Contrast ≥ 4.5:1 for text.
- Components live in `src/shared/ui/`: Button (primary, secondary, ghost, danger; md/sm), IconButton (md/sm),
  TextField, Select, Checkbox, SegmentedControl, Chip, Tabs, Badge (neutral, accent, success, warning, danger),
  Card (md/lg), Drawer, Tooltip (top/right), Toast, Kbd and EmptyState. Modules compose these; no one-off
  styled buttons in modules. Styling: CSS Modules + CSS variables.
- ESLint restricts native controls in app and module JSX, except the hidden file input. The
  `design system: CSS modules use tokens` test guards colours and spacing, radius and type values.
- Icons: `lucide-react`.

## 5. Copy and states

- Vietnamese UI copy, sentence case, short verbs ("Phân tích", "Xác nhận", "Bỏ qua", "Áp dụng bản sửa").
- Scores always carry their context: never a bare number without coverage / confidence / rubric version.
- Findings wording follows the PRD distinction: "Ứng viên cần xem lại" (review candidate), "Gợi ý văn phong"
  (stylistic suggestion), "Vi phạm đã xác nhận" (confirmed). Default to the weakest label when unsure.
- Every async view has loading (skeleton), empty (explain + primary action), error (message + retry + details).
- AI actions show the privacy notice once per consent version before the first call.

## 6. Generate workspace

At 1280 px and above, Generate presents the claim and evidence form, generated paragraph, and provenance
checks in three columns. Below that width the panels stack. Evidence rows retain their identifiers when
reordered; hovering or focusing a sentence's evidence chip highlights its corresponding row. The reading
view shows sentence roles and marks failed provenance with the critical double underline, icon and text.
The checks panel lists unused evidence and requests for missing support. A failed check requires an explicit
confirmation naming the failures before the user can create an analysis.

## 7. Report and comparison

Saved analyses expose a report menu in Evaluate and History. The printable report includes traceable issue
markers, a legend, scoring context and limitations. Print layout removes navigation and controls, uses A4
margins and page breaks, and retains distinct line styles in greyscale. History selects two analyses for
comparison; revision analyses link to their source. Comparison places aligned text side by side, identifies
insertions and deletions with line styles, and labels metric and score changes with arrows and numbers.

## 8. Paper batch panel

The paper map presents section and AI-step checkboxes, a call budget and a live estimate before starting.
Manuscript consent precedes calls. The panel shows overall and section progress, and paragraph badges combine
icons with text. Failed paragraphs offer retry; completed results link to Evaluate with their issue count and
score context. A run interrupted by a reload appears paused and can be resumed.

The paper page also has Sơ đồ and Tổng quan tabs. Tổng quan presents section coverage, issue counts with
numbered bars, per-dimension score distributions, recurring issue filters and paragraph transition chains.
It identifies stale and unavailable transitions, offers audited human review and links each endpoint to its
analysis. It never presents a paper-level total score.

The Kiểm tra tab runs deterministic checks locally and shows its current calibration status with n. Each check shows its
status, false-positive risks and anchored findings; users can confirm, dismiss or undo a decision. Dismissed
findings are collapsed, and selecting a quoted location opens the map at the highlighted passage. Tổng quan
links to the checks and shows counts by status.

The Hiệu chuẩn page imports human labels after a matched/unmatched preview, offers a finding-prefilled template,
and shows precision intervals, inter-rater agreement and score bias with denominators. Small samples are not
evidence of reliability. The optional filter hides unreliable checks or issue types only when enabled. A
collapsible Minh bạch section in the paper and report views displays recorded provenance; unavailable historical
fields are identified as unknown and the section offers a JSON download.

The Độ bền điểm tab follows Phản biện AI. It states that it measures the scorer and is not a way to raise a score,
then offers the sample size, call estimate and budget. A verdict appears only when a run has finished: a badge
(Ổn định, Nhạy với văn phong, Chưa đủ dữ liệu), a table of signed change, absolute change, test–retest noise and n,
the discarded rewrites with reasons, and per-paragraph scores. Rewritten text sits in a collapsed section for
verification only, with no copy or apply action. A style-sensitive verdict shows a warning on Tổng quan and in the
Điểm tab of Evaluate.

The Phản biện AI tab follows Kiểm tra. It presents human notes before revealing reviews, then keeps those
notes beside the advisory results on wide screens and stacks them on smaller screens. Setup shows the selected
sections, reviewer lenses, character and call estimates, budget and manuscript consent. Results show anchoring,
similarity, template and human-agreement counts, with filters and audited decisions on anchored points. Quotes
open the paper map at the highlighted span; unanchored points remain separate and cannot be confirmed. Model and
prompt versions accompany the advisory banner.

## 9. Paper workspace

The header (title, page, section and word counts) and the tabs come first on the page, and the tabs stay visible while scrolling.
Setup never sits above them. Tabs follow what a researcher does, in two groups: **Hiểu bài** (Đọc bài, Đo lường) and **Đánh giá**
(Chất lượng viết, Kiểm tra, Phản biện AI, Độ bền điểm). One muted line under the tabs says what the current tab is for.

Anything with more than a screenful of items is a tree or folds:

- Đọc bài has a sticky outline tree (`shared/ui/Tree`, ARIA tree keyboard pattern) built from section levels, with a filter and body-paragraph
  counts that include children. The reading column shows one section at a time with previous and next.
- Four or more consecutive list, equation or footnote blocks fold into one row, and open when a highlight lands inside.
- Internal ids and the `body` kind are not shown; other kinds carry a Vietnamese label.
- `SectionPicker` is the one way to choose sections for AI work: an outline with tri-state parents, a live count and the presets
  Chọn tất cả, Phần chính, Bỏ chọn.
- Each screen has one primary button, named for what it does. Once a run exists its setup folds behind "Chạy với lựa chọn khác".

The Đo lường tab is one line of run status and actions above a master-detail view. The left tree follows the chain the module exists to explain:
Thí nghiệm → Metric → Kết quả, then Claim, Thuộc tính đo, Cảnh báo and Cần xem lại. A flag marks rows needing review, and search flattens the tree.
The right pane shows one item in full. Overview carries clickable counts and a protocol matrix (experiments × fields, marks plus a text legend, never colour alone).
Fields with no information fold into a single line listing their names.

## 10. Paragraph workflow

Evaluate presents its AI work as numbered steps in order (sentences, paragraph structure, contextual judgement, scoring). The next step is the only
primary button, a finished step shows a tick and "Đã xong", and a step that cannot run says why. Saving becomes primary once scoring is done.
The theme control is an icon button in the header, cycling Hệ thống, Sáng and Tối.

Atomic sentences are a branch of the Đo lường tree, grouped by role. Each opens on its own with its source, the items that use it and the action `Đã đối chiếu với nguồn`; the branch root shows progress and what code could and could not check.

Paragraph work is one sidebar entry. The page opens on a choice between evaluating an existing paragraph and drafting a new one; the choice leaves once work begins. Revising opens from Evaluate or History, because it needs an analysis. All three keep their own routes.

## 11. Paper library

The Bài báo page has two tabs: Bài đã nhập and Thư viện DOI. The library adds papers from pasted DOIs or CSV and reports what it skipped. Status filters carry counts and hide when empty, and taxonomy filters narrow one another so a choice never leads to an empty list. The table pages at 50 rows; bulk actions act on the selection, or on the current filter when nothing is selected. "Chưa thấy bản mở" says only that no source listed an open copy; the app does not claim a paper is paywalled. A browser cannot fetch most publisher PDFs, so a row offers Mở bản mở and Gắn PDF, or a direct arXiv download.

The Giọng văn tab reports Hyland's stance and engagement markers as a tree of nine categories beside one detail pane. Counts are per 1,000 words the model actually read, always with the word count, and are labelled descriptive. Each marker shows its clause with the marker highlighted, a link to its place in the paper, and Xác nhận or Loại bỏ; dismissed markers leave the counts but stay in the CSV.

## 12. Rules every screen must meet

These are checked on each screen, by looking at it, before a change is accepted.

- **Setup is a wizard** when AI work needs more than one kind of choice: choose, configure, confirm. The cost estimate stays visible on every step, and only the last step has the action that runs. A setup with only a few numbers stays on one screen, with the estimate and the action in an `ActionBar`.
- **One primary button per view,** named for what it does. `Dừng` and permanent deletion use danger. Undo, dismiss and links to sources are ghost.
- **Status left, actions right** in `ActionBar`. Several actions of one kind, such as exports, go in one `ActionMenu`.
- **Every finding is a `FindingCard`,** in a fixed order: labels, quote, explanation, source, then actions. A message repeated on many findings is said once above them.
- **Readers see places, not ids:** `Tr. 3 · Results`, never `sec3_p09`. Dates are formatted for Vietnamese readers, never ISO. Internal codes appear only in folded technical detail or exports.
- **Filters are `Chip`s with counts** when the options are few. Labels on items are `Badge`s. Key numbers are `Stat`s.
- **Long lists are trees:** group by paper, then section, with counts. A flat list of parsed items is not acceptable.
- **Never promise a control the screen does not have.** Empty states name an action only where that action exists.
- **Provenance is not page content.** Minh bạch opens from the header in a drawer, grouped by run.

## 13. Paper page is organised by question

The page opens on **Hồ sơ**: five dimensions (Khoa học, Lập luận, Diễn ngôn, Viết học thuật, Bối cảnh), each stating its question, coverage and indicators. Indicators are computed in `core/paperProfile`.

- No total score and no radar chart: the dimensions do not share a scale.
- An indicator that has not been measured shows `—`, never zero.
- Every AI-derived number says so.
- A finding's source opens beside the current screen in the evidence drawer; reading it does not lose the reader's place.
