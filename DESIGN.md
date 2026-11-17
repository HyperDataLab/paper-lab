# DESIGN.md

The paper's **Trích xuất** space (right of Writing style) opens the extraction matrix of the paper's own project, with this paper already chosen as its only row: add columns, run, review cells and export (CSV, JSON, plus the paper's RIS and BibTeX). The table is made on first visit from the default template. The **Data table** space holds the contribution graph. Projects (sidebar) hold multi-paper Deep Research; the project page no longer has a matrix tab.

A single-paper extraction presents fields as rows, with the column menu beside each name and the full value alongside it; on narrow screens the value sits below the name. Status filters select field rows. Matrices with multiple papers retain the horizontal comparison layout.

The single-paper run drawer offers Full Extract: all catalog fields are selected by group, with optional High Quality verification. Starting adds missing catalog columns after existing columns, including when custom columns bring the total above the normal add-column limit. Project runs retain the Deep Research option.

The Contribution graph offers a four-stage contribution flow and a node-link knowledge graph of verified triples. The flow groups triples by NCG information unit; selecting a graph node lists its triples. Expand a triple to read its sentence and open its location; the analysis action shows its estimated AI calls and the ZIP export includes an out-of-domain note when applicable. Large graphs show the most connected nodes and link back to the full flow.

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
- Group titles are sentence case (Nghiên cứu, Viết, Dữ liệu), never all caps. `soon` modules render disabled with a
  badge; `beta` is not marked in the sidebar, where four pills on nine items were noise.
- Collapsed state is remembered in `localStorage` (try/catch). Widths: 232 px expanded, 64 px rail. The top bar is
  56 px and sticky.
- Active item: soft accent background, accent icon, semibold label + `aria-current="page"`. Keyboard: Tab order follows the list,
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

### Criterion marks

A paper analysis belongs to one of four criteria. Each has one colour, one shape and one letter, used wherever the criterion is named
(block headers, jump and filter chips, the layer switches and margin marks beside the paper, the left edge of a finding card).

| Criterion | Token             | Light / dark          | Mark                 |
| --------- | ----------------- | --------------------- | -------------------- |
| Claims    | `--crit-claim`    | `#1D4ED8` / `#60A5FA` | circle, letter C     |
| Evidence  | `--crit-evidence` | `#7E22CE` / `#C084FC` | square, letter E     |
| Writing   | `--crit-writing`  | `#A21CAF` / `#F0ABFC` | dashed box, letter W |
| Sources   | `--crit-context`  | `#475569` / `#CBD5E1` | double box, letter S |

On the paper's text a criterion is an underline in its colour **and** its own line style: Luận điểm solid, Bằng chứng double,
Cách viết dotted, Bối cảnh dashed. A finding's underline is thicker than a descriptive mark's. The passage the reader just opened is a
`<mark>` on `--soft`. Overlapping marks show the finding first and a small `+n`; the title lists them all.

Criterion colour marks only the mark and the underline: never quote text, numbers, headings or card backgrounds.
Two of these hues match `--hl-word` and `--hl-flow` above. The two sets never share a screen: the sentence-level colours belong to
Đánh giá, the criterion marks to the paper page.

- Severity changes weight, not hue: `info` outline only, `minor` 1px, `moderate` 2px, `major` 3px, `critical` double.
- Status: `candidate` = 60 % opacity; `confirmed_*` = full; `dismissed_by_human` = strikethrough in the list,
  hidden in the text by default.
- Highlight the smallest causal span. Relationship issues mark both endpoints and draw a connector (SVG overlay).
- When a flow finding is selected, a curved arrow connects its endpoint marks; its position is recalculated on resize.
- Overlaps: stacked underlines (max 3 visible) and click-to-cycle; a `+n` chip opens the full list.
- Every highlight is a `<mark>` with `role="button"`, `tabindex="0"`, `aria-label="<type>, <severity>, <status>"`.
- Rendering maps stored code-point offsets to UTF-16 in one helper; never slice the DOM text to compute offsets.

## 4. Visual tokens

- Direction: the neutral (zinc) system most current web apps share (shadcn/ui, Vercel, Linear): white surfaces,
  near-black text, 1px borders, 12px card radius, light shadows, a 232px sidebar on `--sidebar-bg`. The brand green
  (`--accent`, `--accent-hover`, `--accent-strong`, `--soft`) marks actions, the current place and selection; a PDF
  sits on `--desk`, and the passage the reader opened is the one bright mark (`--highlight`).
- Fonts: `--font-ui` (Inter), `--font-reading` (Source Serif 4) for quotes and analysed paragraphs only,
  `--font-mono` (JetBrains Mono, digests and code only). Reading text uses `--text-reading` (17 px) / 1.7.
- Page widths: list and form pages `--content-width` (1200 px), detail pages `--wide-width` (1440 px), the paper
  workspace `--workspace-width` (1680 px); all centred, with one gutter shared by header, tabs and columns.
- Lists of saved things (projects, corpora) are `ItemCard`s in `ItemGrid`: three columns, two below 1100 px, one on
  phones. A card shows its kind, title, question, three key numbers, progress and last update.
- Every token is a whole pixel. Do not scale tokens per breakpoint (fractional sizes blur text and borders).
- Widths: `--content-width` 1200 px for list and form pages (centred), workspaces use the full width;
  `--form-width` 720 px. A page that lists things and creates them puts the list first and the create form in a
  side column (Corpus, Trích xuất).
- Cards are for objects (a paper, a finding, a corpus). Page sections are separated by headings and space, not by
  wrapping each one in a card. Cards are flat: border, no shadow. Empty states sit on `--surface-sunken`, no dashed
  border.
- Toolbars are one row of icon buttons; a control whose value explains itself hides its label visually
  (`hideLabel`) and keeps it for screen readers.

| Tokens                                                                   | Values                              |
| ------------------------------------------------------------------------ | ----------------------------------- |
| `--space-1`, `-2`, `-3`, `-4`, `-5`, `-6`, `-8`, `-10`, `-12`            | 4, 8, 12, 16, 20, 24, 32, 40, 48 px |
| `--radius-sm`, `--radius`, `--radius-lg`, `--radius-xl`, `--radius-pill` | 4, 6, 10, 16, 999 px                |
| `--text-xs`, `-sm`, `-base`, `-md`, `-lg`, `-xl`, `-2xl`, `-3xl`         | 12, 13, 14, 15, 17, 20, 24, 30 px   |
| `--control-h`, `--control-h-sm`, `--control-h-lg`                        | 36, 30, 44 px                       |

- Semantic colours include `--danger`, `--success`, `--warning`, `--scrim` and the existing highlights;
  `--soft` is a subdued surface for selected and highlighted content. `--shadow-overlay` is for overlays only.
- Neutral palette on `:root` (`--bg`, `--surface`, `--surface-sunken`, `--sidebar-bg`, `--desk`, `--border`,
  `--border-subtle`, `--border-strong`, `--text`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-hover`,
  `--accent-strong`, `--on-accent`, `--hover`, `--highlight`), redefined
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

The paper is the centre of the page, as in SciSpace's reader. From 1280 px the page has two columns that scroll on their own: the
paper in the centre and, on the right, what needs a decision and what is known about the paper. Below 1280 px one tab bar holds the
tabs and shows one column at a time; a quote then opens in a drawer so the reader keeps their place. The app sidebar folds to a rail
from the control beside the brand. "Ẩn phân tích" hides the right column and leaves the paper alone on the page.

**Spaces.** Arguments and Writing style are spaces behind the paper, not tabs. Two entries above the right column's tabs open them,
each with one line on what is inside ("11 claims · 38 evidence"). A space takes the whole width, with "← Quay lại bài" and a tab
to the other space; a quote opens in the evidence drawer. Choosing Full text or Summary also leaves the space. Analyses keep
running while the reader moves between the paper, the tabs and the spaces.

Each tab and space answers the question a reader brings to it. There is no help line under the tabs: names and content say it, and anything that does not help the reader is left out.

| Where  | Name              | The reader wants                                     | Holds                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Centre | **Full text**     | to read the paper itself and check a passage         | A PDF paper is its PDF, with findings drawn on the words; no PDF/Text switch and no layer chips. The parsed text shows only for papers that are not PDFs, or under "Gắn PDF gốc" while the PDF is missing                                                                                                                                                                                   |
| Centre | **Summary**       | to grasp what the paper says before reading closely  | Key facts as a strip of what the paper states (each with its page; a wrong one can be rejected), then the reader's summary written by AI. One button, "Tóm tắt bài (AI)", makes both (two requests). One readable column (72ch)                                                                                                                                                             |
| Right  | **Issues**        | to see what needs a decision and make it             | Every finding in one list, grouped by type, with criterion chips as the only filter                                                                                                                                                                                                                                                                                                         |
| Right  | **Citations**     | to see what the paper cites and whether it holds up  | Context overview (profile dimension E), References (recency, retracted papers), Citation checks (citations ↔ references)                                                                                                                                                                                                                                                                    |
| Right  | **Paper info**    | to know what the paper is                            | Publication info only (where, when, by whom, DOI)                                                                                                                                                                                                                                                                                                                                           |
| Space  | **Arguments**     | to judge how the author reasons and on what evidence | Arguments overview (dimensions A Khoa học, B Lập luận); Issues; Automated checks (Numbers & claims); then, open on arrival because they run nothing: Research gap & contribution, Claims & grounds (with stated limitations), Atomic sentences by section and role; then Claims & reasoning (Toulmin model, AIF graph), Evidence & measurement, Validity & rhetorical moves, AI peer review |
| Space  | **Writing style** | to learn from how the paper is written               | Writing overview (dimensions C Diễn ngôn, D Viết học thuật); Issues; Automated checks (Figures & tables, Acronyms & claim strength); Coherence & sentences, Stance & engagement, Vocabulary & phrases (open on arrival, no AI), Score robustness                                                                                                                                            |

"Phân tích toàn bài" sits in the centre column's tab bar.

**Accepted by default.** What the analyses and rule checks produce counts as accepted until the reader rejects it; there is no
review queue, no "cần duyệt" count and no confirm button. Every card offers "Bác bỏ", and a rejected card stays in place, dimmed,
with "Đã bác bỏ" and "Hoàn tác". Rejections are saved to the source that produced the result and are left out of marks and counts.
Stored results keep their own status: accepting by default records no human decision.

**Issues where they belong.** Each space and tab has an "Issues (N)" block with the findings of its criteria: Claims and Evidence in
the Arguments space, Writing in the Writing style space, Sources in Citations. The Issues tab stays as the one list of everything,
beside the paper; a mark pressed on the paper opens its finding there.

**Language.** Navigation, block titles and scientific terms are in English, the way researchers name them (Claims, Grounds, Warrant,
Qualifier, Rebuttal, Premise, Inference, Conflict, Key facts, Stance & engagement…); empty Toulmin slots read "Chưa xác định". Help
lines, hints, explanations, action buttons and status words stay in Vietnamese ("Bác bỏ", "Đã bác bỏ", "Hoàn tác", "Phân tích").

**Findings are one list in one card shape**, whatever found them (rule checks, AI review, sentence-level writing issues, paragraph
transitions, measurement findings). A card reads: criterion mark, the point in bold, "Đã bác bỏ" once rejected, the quote, the reason, the place, then
actions; severity and origin are not shown as labels. The only filter is the criterion `Chip`s with counts; Writing starts off when
anything else exists. The list is grouped by type of problem (Claims & reasoning, Evidence & data, Sources & citations, Writing),
each group with its count and how many were rejected; inside a group the most severe come first, then paper order. A list inside a
space shows only its own criteria. Running one analysis for one section is done from that analysis's block. Every card can be rejected and the rejection undone, with the decision saved to its source; the AI review's points stay out until the reader has
saved or skipped their own notes. Descriptions (claims, stance markers, snapshot sources) are marks on the text, not findings.

**A section run merges, it does not replace.** Claims & reasoning, Validity & rhetorical moves, Stance & engagement and Coherence & sentences can be run for one
section, from the block options ("Chạy cho một mục") or from a cell of the findings table. Items of other sections stay as they were,
the rerun section's items are replaced, and a person's decisions on kept items carry over to the merged run (the previous run stays in
the history unchanged). The abstract comparison is whole-paper and is kept. A result made with another prompt or model takes no section
run; Evidence & measurement, AI peer review and Key facts always run for the whole paper.

**A finished result can be out of date.** It is "Kết quả cũ" when the reader now asks for a section it did not read, when its prompt has
changed, or when it was made with another model; the block says which. "Phân tích toàn bài" runs such results again instead of
skipping them.

**Findings are drawn on the paper's words** in Full text, by layer; the chips switch layers on and off
(Writing starts off) and a margin mark names the criteria present in each paragraph. Pressing a marked stretch opens its finding in
the list, or the block that described it.

**Arguments are drawn as diagrams.** Claims & reasoning shows one argument at a time with previous / next, zoom and “Vừa khung”. The canvas chooses a vertical layout below 720px, and the reader can choose its orientation. Cards and scheme nodes can be moved by pointer or arrow keys; “Bố cục lại” restores their computed positions. A minimap shows the visible area when the drawing overflows. “Toàn bài” in AIF graph lays out the live argument network with shared statements once, and “Chỉ hiện xung đột” isolates conflict steps. Toulmin model uses the slots Claim, Grounds, Warrant, Backing, Qualifier and Rebuttal; empty slots read “Chưa xác định” and inferred warrants are labelled “AI suy ra” and “Không phải lời tác giả”. In AIF, statements connect through RA or CA nodes, which have no passage. Limits and conflicts use dashed, labelled lines. “Danh sách” keeps every argument on one page.

There is no second level of tabs; a theory's name (Toulmin, AIF, CARS) appears only inside its block. Each analysis is one
**block** (`SectionBlock`): a row with its criterion mark, a plain title, the question it answers, its state as a `Badge`, and its
content folded underneath. A block that has not run is that row plus one `Phân tích` button and a muted cost estimate; it is never an empty card.
A block with two readings of one analysis switches between them inside the block. Jump `Chip`s at the top of a tab open a block and
scroll to it. Every former `?view=` id still opens its block. AI panels stay mounted while folded or in another mode, so a run is not
interrupted; a strip names what is running out of sight.

Anything with more than a screenful of items is a tree or folds:

- Full text has a sticky outline tree (`shared/ui/Tree`, ARIA tree keyboard pattern) built from section levels, with a filter and body-paragraph
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

- **Setup is a default, not a question.** A paper analysis starts from one button: the sections are the paper's remembered scope and the call ceiling comes from Cài đặt › Giới hạn chạy (`RunSetup`). The estimate and the ceiling are stated beside the button; the choices sit behind `Tuỳ chọn`. A wizard remains only where a step must come before the run for a reason of substance, as with the reader's own notes before Phản biện AI.
- **One primary button per view,** named for what it does. `Dừng` and permanent deletion use danger. Undo, dismiss and links to sources are ghost.
- **Status left, actions right** in `ActionBar`. Several actions of one kind, such as exports, go in one `ActionMenu`.
- **Every finding is a `FindingCard`,** in a fixed order: labels, quote, explanation, source, then actions. A message repeated on many findings is said once above them.
- **Readers see places, not ids:** `Tr. 3 · Results`, never `sec3_p09`. Dates are formatted for Vietnamese readers, never ISO. Internal codes appear only in folded technical detail or exports.
- **Filters are `Chip`s with counts** when the options are few. Labels on items are `Badge`s. Key numbers are `Stat`s.
- **Long lists are trees:** group by paper, then section, with counts. A flat list of parsed items is not acceptable.
- **Secondary actions are icons.** Toggles, dismiss, undo, open-detail, show/hide panels, transparency and info are
  `IconButton`s: a coloured icon (accent to do, danger to reject or remove, neutral otherwise), a tooltip above it
  and the same accessible name the text button had. A view's one primary action keeps its text.
- **Disabled is neutral.** A disabled button is a grey fill with muted text, never a faded accent.
- **One table style.** Every table is left-aligned with regular-weight cells and a small muted header; row headers
  are medium weight. Modules set widths, never centring.
- **Drawers are side sheets**: a header with the title, one line of description and a close icon; a body that scrolls; the actions pinned in a footer (a muted note of what the action costs on the left, the primary action last). Never a loose "Đóng" button above the content. Content is grouped in `SheetSection`s; choices use `OptionCard` (a whole-row checkbox, or a card to pick one of), not bare checkboxes.
- **No idle labels.** A block that has not run shows its run button, not a "Chưa chạy" badge; a finished block
  shows its content, not "Đã có kết quả". Only a run in progress and a stale result are labelled. A block's help
  line shows when it is open, not on the folded row. Calibration status shows on the suggestion the reader opened,
  not on every card.
- **Never promise a control the screen does not have.** Empty states name an action only where that action exists.
- **Provenance is not page content.** Minh bạch opens from the header in a drawer, grouped by run.

## 13. Paper page is organised by question

The profile has five dimensions (Khoa học, Lập luận, Diễn ngôn, Viết học thuật, Bối cảnh), each stating its question, coverage and indicators. Indicators are computed in `core/paperProfile`. Each dimension leads the place that is about it: A and B the Arguments space, C and D the Writing style space, E the Citations tab. A card's button opens the analysis behind it ("Mở để phân tích" or "Xem chi tiết"); it never starts a run.

- No total score and no radar chart: the dimensions do not share a scale.
- An indicator that has not been measured is never shown as a tile: a dimension with nothing measured is one row
  (title, question, "Mở để phân tích"), and a partly measured one lists what is not measured yet in one line
  ("Chưa đo: …"). It is never shown as zero.
- Every AI-derived number says so.
- A Toulmin slot with nothing behind it reads "Chưa xác định". An inferred warrant is labelled as inferred and never shown as the authors' own.
- A finding's source opens beside the current screen in the evidence drawer; reading it does not lose the reader's place.

## 14. Original PDFs

- Full text opens on the paper's original PDF (pdf.js, a canvas and a selectable text layer per page). There is no switch to the parsed text. Opening a finding's location moves the PDF to its page.
- The PDF scrolls with its column: there is one scrollbar. The sticky toolbar holds, in order: the way back (when there is one), page field, previous/next, zoom, fit width and the storage badge; on its second row "Tìm trong bài" (Enter searches the paper's text and outlines the first match; ‹ › step through matches, with "2/7") and "Mục" (jumps to a section's first page). The page field moves the PDF on Enter or when it is left, not on every keystroke.
- **A way back.** A source opened from Summary, or from a space through the drawer's "Mở trong PDF", shows "← Quay lại Summary" (or the space's name) at the start of the toolbar; it returns to that tab at the same scroll position. Going anywhere else ends it.
- A mark pressed while the analysis is hidden shows the right column again with its finding.
- The PDF is kept in this browser (IndexedDB, keyed by the file's SHA-256). With a lab account (Google, @hyperdatalab.org only) it is also kept in the lab's storage, so other members can open it on any machine. Without an account it stays on this machine, and the screen says so with a badge: "Chỉ trên máy này", "Đang lưu lên kho lab…" or "Đã lưu trong kho lab".
- A paper imported before PDFs were kept offers "Gắn PDF gốc". The file is accepted only when its hash matches the one recorded at import.
- What was found in the paper is drawn on the PDF too: a translucent box in the criterion's colour over the words, with the same underline style as in Text (solid, double, dotted, dashed). Findings to review are stronger than analysis marks. Pressing a box opens what it stands for. Claims, Evidence and Sources are drawn; Writing marks are not, since they would cover the page. A passage opened from Issues gets an accent outline that pulses once and is scrolled into the upper part of the view. Passages are matched to the PDF text with the paragraph's text around them, never guessed; when one cannot be found, the page opens and the toolbar says so.
- Analysis never needs the account; it only decides where the original file is kept. Privacy copy on import screens says exactly this.

## 15. Reader's summary

- Modelled on SciSpace's Summary tab: the paper retold section by section (headline, overview, then Introduction, Methods, Results, Discussion… as the paper has them), in prose with lists whose items start with a bold lead.
- One button makes it, in one AI request over the whole body of the paper (title and references left out). A very long paper is cut at a fixed length, and the footer says how many paragraphs were read.
- Key facts that the reader rejects stay in the strip, dimmed and struck through, with "Hoàn tác".
- Every paragraph and list item ends with the pages it comes from ("Tr. N"); pressing one opens that paragraph in the PDF. Code keeps only sources that exist in the paper. A part without a source reads "Không rõ nguồn", and a part whose numbers are not in the paragraphs it cites reads "Số chưa đối chiếu được"; neither is hidden.
- The summary describes what the paper says. It is not a verdict on the paper, and it is kept until the reader makes it again ("Tóm tắt lại").

**Automated checks** run on their own when a paper opens. Each check sits with what it is about: Numbers & claims in the
Arguments space, Figures & tables and Acronyms & claim strength in the Writing style space, citations in Citations. Their
findings are also in the Issues block of the same place.

**Where a passage is.** Every place shown on the paper page reads the same way: the kind of its section as a small
coloured badge (Abstract, Introduction, Related work, Methods, Results, Discussion, Conclusion; other sections by a
short form of their heading), then "· Tr. N". The full heading shows on hover. Pressing it opens the passage. Colours
come from the `--sec-*` tokens in `theme.css`, with light and dark values; the colour is never the only cue, the name is
always written.

**Reference list.** Citations lists every reference of the paper, one per line: its number, the entry cut to one
line (the whole text on hover), "Đã bị rút" when OpenAlex reports a retraction, the year, a DOI link, and its place.
Numbered entries that a two-column PDF joins into one paragraph are cut where the numbers follow each other; a
numbered entry always starts a new reference.

**Publication info.** "Sửa thông tin" turns the metadata table into a form (shared `TextField`s): title, year,
venue, volume, issue, pages, DOI, keywords separated by commas, and authors one per line as the paper writes them.
"Lưu" stores it with source "Nhập tay"; "Huỷ" changes nothing. It works without a DOI, and the DOI lookup stays
beside it. Under the table a quiet "Paper model" block gives one line of counts ("N câu · M tài liệu tham khảo")
and "Tải paper-model.json", which downloads the whole model with today's rhetoric and stance labels and their
review state. "Tải article.xml (JATS)" downloads the same paper as JATS Archiving XML after a well-formedness check.
"Công bố lên máy chủ lab" sends the current paper model only on explicit request, requires a lab account, and reports the result or reason for failure.

The paper header offers a switch between Bài báo, Arguments, Writing style and Data table. Arguments and Writing
style show issue counts. Publication details open from the header, and the line beneath the title shows stored
authors, venue, year and DOI. Parser counts belong in Minh bạch.

# Corpus screen

- PDF imports from corpus acquisition and the DOI library show each GROBID request's state and a completed count. GROBID runs in the background with two requests at a time; signed-out imports wait for a lab account.

- The latest profile and its held-out test stay on this device and travel in backups. Show when it was computed and flag changes to either corpus since the computation; “Tính lại” refreshes it.
- The list pairs each corpus with its kind, member count and last update; a short form creates its first protocol.
- The detail screen groups intake, member status, protocol history and releases in separate cards. Intake shows matching counts and asks a person to resolve title-and-year matches. The table can be filtered by retrieval status.
- A release displays its digest and calls out an unchanged digest; the manifest download contains the validated corpus without paper text.

# Paper page patterns

- Look up publication metadata once when a DOI is known and metadata is absent; send only the DOI.
- Put automatic checks in Issues as a filter with a secondary re-run action.
- Keep run progress in the sticky centre tabs; the completion chip opens Issues and can be dismissed.
- Show the whole-paper action as secondary with the number of remaining analyses, including the summary; hide it when none remain.
