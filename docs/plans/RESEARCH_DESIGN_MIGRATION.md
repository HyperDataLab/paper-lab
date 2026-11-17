# Moving Research Design into PaperLab Projects

Owner decision, 2026-11-17: "tôi quyết định sẽ không build Research Design full mà biến phần này thành 1 phần quan
trọng trong Project của PaperLab. Lập kế hoạch để move các tính năng đã code của research design về."

Research Design (repo `HyperDataLab/research-design`, about 12k lines without tests) stops as a separate app. Its
planning features become a **Thiết kế nghiên cứu** part of PaperLab's multi-paper **Project** (sidebar Projects,
`/extraction/:id`, `ExtractionProject` in Dexie). Single-paper projects (a paper's Trích xuất tab) do not get it.

## What exists today

| Research Design (merged, never deployed)                                                                                                                               | Where it goes in PaperLab                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `core/plan` (910 lines): plan contract v1, `validatePlan` gate, freeze rules, `draftToPlan`, ZIP manifest, runner stubs                                                | **Port** to `src/core/researchDesign/plan`, with its tests and test IDs. Contract schema generated into `schemas/`.       |
| `core/draft` (1.2k): questions, hypotheses, gaps, design, threats, measurement (variables, metrics, datasets, conditions), analyses, run matrix; checks DS, CH, AN, RM | **Port** to `src/core/researchDesign/draft`, with tests.                                                                  |
| `core/bank` (300): Writing Bank snapshot, release pinning, aliases, re-pin                                                                                             | **Port** to `src/core/researchDesign/bank`. Bank content stays a git-ignored snapshot; tests use invented entries.        |
| `core/facts` (340): reads `paperlab-experiment-facts` v1, resolves anchors in a paper model, per-fact project decision                                                 | **Port unchanged.** The seam stays the facts contract; only the HTTP client is replaced (below).                          |
| `core/suggest` (150): AI suggestions from used facts (D55)                                                                                                             | **Port**, calls go through PaperLab's LLM client with its consent and prompt versions.                                    |
| `core/papers`, `core/project`, `core/llm`                                                                                                                              | **Not moved.** PaperLab has its own paper set (project papers, corpus), project record and LLM client.                    |
| Screens: Câu hỏi và giả thuyết, Thiết kế nghiên cứu, Đo lường, Phân tích thống kê, Ma trận chạy, Bảng so sánh, Writing Bank, Gói kế hoạch                              | **Rebuilt** on PaperLab's `shared/ui` and `DESIGN.md` tokens, reusing RD's component logic where it is not styling.       |
| Screens: project list, Thành viên, Tập bài báo, Cài đặt, home                                                                                                          | **Not moved.** PaperLab already has projects, papers and settings; members are dropped (PaperLab is local-first).         |
| `shared/ui`, `shared/auth`, `shared/api`, `shared/paperlab`, Worker (auth, projects, members, LLM proxy with budget, frozen plans on R2)                               | **Not moved.** Replaced by PaperLab's UI kit, auth, LLM client and, for frozen plans, a later route in PaperLab's worker. |

Nothing was deployed and no Firebase project was created for Research Design, so there is **no user data to migrate**
(to be confirmed by the Research Design session in `_coord/requests/005`).

## Data in PaperLab

- One new Dexie table `researchDesigns`, keyed by project id: the draft (questions, hypotheses, design, threats,
  measurement, analyses, run matrix), the pinned bank snapshot reference, per-fact decisions and bank matches, frozen
  versions. A record of its own, not a field of `ExtractionProject` (whose `schemaVersion` is a literal 1).
- Experiment facts come from PaperLab itself: for each project paper, `projectExperimentFacts` over its latest
  measurement run, with `modelEtag = contentEtag(buildPaperModel(...))`. The ported facts reader and comparison
  table take this local provider instead of the `/v1` client. A paper with no measurement run shows "chưa có dữ kiện"
  and a link to run measurement on that paper.
- Bank snapshot: imported from a file as in RD (`node scripts/make-bank-snapshot.mjs ../writing-bank` produces it),
  later fetched from `/bank/v1` when Writing Bank serves it (request 001; PaperLab becomes its consumer).
- Frozen plans: stored as versions in the Dexie record and exported as the package ZIP. A server copy for SRD (a
  `paperlab/plans/` route in the existing pdf worker) is a later slice, after the owner says how SRD should read plans.

## Rules carried over, and rules that change

Carried over: LLM output is a candidate and a person adds it (D55); facts are PaperLab's and shown as they came, the
project adds only a decision (D52); exact bank matching, nothing fuzzy (D54); the bank is read from the stored snapshot,
never per field (D31); the plan schema is generated, never hand-edited; synthetic fixtures only (PaperLab is public).

Changes (recorded here, raised to the owner):

- D23/D50 no longer apply inside PaperLab: PaperLab already extracts and is the caller of Paper Fetch Hub.
- D24 AI budget: RD capped its own calls per day through its Worker. PaperLab has no such cap; the suggestion action
  shows its estimated calls and asks for consent like PaperLab's other AI actions. A daily cap can be added if the
  owner wants it.
- D49/D53: the API clients between RD and PaperLab are no longer needed for planning. The deployed `/v1` routes stay
  for other callers (SRD).
- Members (S2b) are dropped: PaperLab projects are local to the browser.

## Slices (one PR each, Codex builds, Claude accepts)

| Slice | Deliverable                                                                                                                                                                                                                                          | Depends on |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| M1    | Port `core/plan`, `core/draft`, `core/bank`, `core/facts`, `core/suggest` into `src/core/researchDesign/*` with their tests; plan contract JSON Schema generated into `schemas/` and `public/schemas` (same format id, so SRD is unaffected). No UI. | –          |
| M2    | Storage: `researchDesigns` Dexie table + repository + schema; local facts provider from project papers; included in project export/import.                                                                                                           | M1         |
| M3    | Project page gets the **Thiết kế nghiên cứu** area (DESIGN.md pattern) with Câu hỏi và giả thuyết and Thiết kế nghiên cứu (design, threats, checks DS).                                                                                              | M2         |
| M4    | Đo lường (variables, metrics, datasets, conditions, chain line, checks CH) and the Writing Bank snapshot screen (import, release, re-pin).                                                                                                           | M3         |
| M5    | Phân tích thống kê and Ma trận chạy (checks AN, RM).                                                                                                                                                                                                 | M4         |
| M6    | Bảng so sánh: project papers × fact kinds from the local provider, per-fact decisions, bank matching, "Dùng trong nhiều bài", AI suggestions into the draft.                                                                                         | M2, M4     |
| M7    | Gói kế hoạch: gate PP-01..PP-10, freeze into local versions with a deviation note, package ZIP and runner stubs.                                                                                                                                     | M5, M6     |
| M8    | Close-out: Research Design repo README points here, `_coord` and `API_REQUESTS` updated, PaperLab ROADMAP and DESIGN.md updated.                                                                                                                     | M7         |

M3–M5 touch the same project page and run one after another; M1 and the bank/facts parts can run in parallel worktrees.
Each slice ports the matching RD tests (keeping their IDs) and adds UI tests; acceptance runs the touched tests locally
and CI on main, plus a browser check of the new screens.

## Owner decisions still open

- Archive the `research-design` repo (read-only) after M8, and stop its session's feature work now.
- How SRD should read frozen plans (file package only, or a route on PaperLab's worker).
- RD's open owner steps (its Firebase project, its Worker, its secrets) are no longer needed.
