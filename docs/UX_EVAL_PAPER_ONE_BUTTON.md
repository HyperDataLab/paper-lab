# Paper page evaluation: first-time users and the one-button analysis

Date: 2026-11-13. Main at d38eb0a. Owner context: the owner will pay the AI cost so that **one press analyses the
paper**, either once for everything or once per purpose. Waiting time matters more than money.

## How it was done

- Test paper: a real 32-page arXiv preprint (66 references, 106 body paragraphs) imported into a local dev build.
  Neither the PDF nor its text is committed; quotes from it are paraphrased here.
- Claude recorded every screen before any AI ran (S0 Home through S9 Minh bạch), as visible text in reading order.
- Four persona agents read only that recording and thought aloud screen by screen, each with one task:
  - Linh, a first-year PhD student, with 10 minutes to decide whether to cite the paper.
  - Dr. Minh, a reviewer looking for the weakest claims.
  - An, a co-author fixing the writing before resubmission.
  - Hà, an SLR assistant filling an extraction row and exporting the reference.
- Claude checked each persona claim on the real screen (table below), then ran every AI analysis and timed it with
  the Browser pane visible.
- A second reviewer (advisor) checked the plan and the conclusions.

## Result per persona

| Persona            | Task done?         | What blocked them                                                                                           |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Linh (newcomer)    | No                 | No verdict or brief; five different run entry points; jargon (Toulmin/AIF, Atomic sentences, Stance)        |
| Dr. Minh (review)  | Partly             | Page badges work but do not look clickable; 18 Sources cards from a mangled reference list bury the claims  |
| An (author)        | Partly             | Writing feedback is behind "~359 lượt · trần 718" with no time or description of the output                 |
| Hà (SLR assistant) | Partly, leaning no | Title is the file name, no DOI, no authors or year; RIS/BibTeX exist but are hidden under Trích xuất → Xuất |

Common to all four: they could not tell what each run produces, how long it takes, or whether "Phân tích toàn bài ·
còn 7" covers what they need.

## Persona claims checked on the real screen

| Claim                                          | Verdict                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| No jump to the exact place in the PDF          | False as a capability (a badge opens the page and highlights the passage). True as discoverability: the badge does not look like a link |
| No RIS/BibTeX                                  | False as a capability (Trích xuất → Xuất). True as discoverability; the RIS lacks authors, year and DOI because metadata is missing     |
| Title is the file name                         | True                                                                                                                                    |
| arXiv DOI not detected                         | True: the arXiv id is in the file name and `10.48550/arXiv.<id>` is derivable                                                           |
| Reference entries merged                       | True: one entry runs into the next, and some "uncited reference" cards are fragments of the previous entry                              |
| Sentence counts differ                         | True: 869 (paper model) and 818 (body) with no label saying which is which                                                              |
| "Data table" holds only the Contribution graph | True: the real table lives under Trích xuất                                                                                             |
| Two icon-only header buttons                   | True: "Minh bạch" and "Thông tin xuất bản" have no visible text                                                                         |
| Many sections labelled "Khác"                  | True                                                                                                                                    |
| One card joins two unrelated quotes with " · " | True (claim-strength card: an abstract sentence and an unrelated discussion sentence)                                                   |

## Measured run times (Browser pane visible)

All AI calls run **one after another**: run-all runs its seven jobs in sequence, and each job sends its calls in
sequence (`RunAllCard.tsx`, `runBatch.ts`, `paperParagraphAnalyzer.ts`).

| Analysis                    | Calls (estimate / used) | Wall time             | Note                                                                      |
| --------------------------- | ----------------------- | --------------------- | ------------------------------------------------------------------------- |
| Tóm tắt                     | 1                       | ~70 s                 |                                                                           |
| Key facts                   | 1                       | ~14 s                 |                                                                           |
| Evidence & measurement      | ~18 / 20 (cap 36)       | not a fair time\*     | Stopped "incomplete": 3 appendix sections could not be read               |
| Claims & reasoning          | 3                       | ~97 s                 | 22 claims                                                                 |
| Validity & rhetorical moves | ~7 / 7 (cap 14)         | ~230 s                | ~33 s per call                                                            |
| Stance & engagement         | ~6 / 1                  | under 30 s            | ran on one section only, because the section choice is shared (see below) |
| Coherence & sentences       | ~359                    | ~2–3 h (extrapolated) | measured on one 3-paragraph section: 12 calls in ~244 s (~20 s per call)  |

\* The pane was hidden for part of that run, which suspends the page.

Per call, the router took about 14–70 s (median about 30 s). In sequence, the whole paper is about **2 to 3 hours**,
almost all of it Coherence & sentences (4 calls per paragraph on the measured section). The other six analyses
together are about **10–15 minutes**. If a user presses "Chọn tất cả" (446 paragraphs including appendices), Coherence
alone becomes roughly 1,500 calls.

**Two blocks can already run at the same time.** Stance was started while Coherence was running; both progressed,
and Coherence kept about 20 s per call. So the router accepts at least two calls in flight without slowing down. A
higher limit is not yet measured.

## What went wrong during the run

1. **Run-all stops at the first incomplete job.** Evidence & measurement ended incomplete (3 sections unreadable), and
   run-all ran nothing after it: Claims, Validity, Stance and Coherence never started.
2. **The chip said "Xong · +4 issues"** after that stop, which reads as full success. This contradicts R15 E2 (marked
   Done).
3. **No resume.** Re-opening run-all offers to redo measurement from scratch (~393 calls) and ignores the block's own
   "Tiếp tục phần còn lại (14 phần đã xong)".
4. **Contradictory cost wording.** Validity says "Một lượt phân tích cho cả…" (one pass) beside "~7 lượt · trần 14",
   and its progress counts against the cap: "1/14 lượt". Coherence shows "Phạm vi: ·" with an empty value.
5. **"còn 7" is unexplained** (R15 B1 marked Done) and does not say that Coherence alone is ~90 % of the calls.
   After every analysis had run at least once it still said "còn 3".
6. **The section choice is shared by every analysis.** Narrowing Coherence to one section silently narrowed Stance
   too, which then ran on one section with one call. The note "dùng chung cho mọi phân tích" sits at the bottom of
   the options.
7. **Paragraph counts disagree inside one block:** "106 đoạn" in the header, "3/446 đoạn" in the overview.

## After the run

- The Summary tab becomes useful: key facts with pages, a one-sentence finding, a paragraph summary and one summary
  per section. It describes; it does not say what is weak or whether to rely on the paper.
- Each summary paragraph ends in a row of repeated badges ("Tr. 1" six times), which is noise.
- AI findings show internal ids to the reader: "Bằng chứng: ev-0055, ev-0056 …; kết luận liên quan: cl-7 …".
- Some quotes are cut at a line-break hyphen, ending mid-word.
- Two of the four Claims findings flag appendix sentences that only list examples or point to subsections, which are
  not claims.
- Weak claims, evidence gaps, writing issues and the 18 citation cards sit in one list; nothing ranks them.

Linh and Dr. Minh were run again on the after-run screens:

| Persona  | Before the run | After the run | Still blocking                                                                                       |
| -------- | -------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| Linh     | No             | Partly        | Main claim now stated, but no cite / don't-cite view with strengths and limits; "Xong" chip misleads |
| Dr. Minh | Partly         | Partly        | 2 of 4 claim findings are false positives; no ranking; evidence shown as ids, not as "found / none"  |

Their joint top three: a Brief with the weakest claims ranked, each with evidence found or "none found" (U6, U9); a
truthful, complete one-press run (U1–U5); and less noise in findings (U7, U9, plus a precision fix for appendix
sentences flagged as claims).

## Proposal

### Decision for the owner: what one press does

Recommended: **one button, results grouped by purpose.** The press starts every analysis; the page shows one
progress panel with a line per purpose (Brief, Claims & evidence, Writing fixes, Extraction & reference), each
filling in as soon as its own calls finish. People who only need one purpose read that section and leave; nobody has
to choose a run before seeing anything.

The alternative, **one button per purpose**, fits users with one job (Hà never needs Coherence), but four buttons
bring back the "which do I press" problem every persona hit.

### Second decision: the shape of the calls

| Shape                             | Calls for this paper | Time (sequential → parallel)      | Risk                                                                |
| --------------------------------- | -------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Per paragraph (today)             | ~395                 | 2–3 h → ~20–40 min at 4 in flight | none new; the in-flight limit above 2 is unmeasured                 |
| Per section                       | ~60–80               | ~30–40 min → ~5–10 min            | longer outputs; quote anchoring per section needs checking          |
| Whole paper, one call per purpose | ~7                   | ~5 min → ~2 min                   | output length limits and quote anchoring over 30 pages need a spike |

"One shot" can mean one press, or one large call per purpose over the whole paper. The table covers both.

Recommended: **per section for Coherence, a parallel queue for everything**, and a spike before any whole-paper
call. The six non-Coherence analyses would finish in about 3–5 minutes in parallel, so the Brief appears quickly
while Writing fixes keep filling in.

### Slices

| Slice | What                                                                                                                                                                          | Why                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| U1    | Run-all keeps going after an incomplete job, lists what is incomplete, and the chip says "Xong một phần · 3 phần chưa đọc được" instead of "Xong"                             | Wrong success signal; later jobs never ran |
| U2    | Run-all resumes: it reuses saved analyses and resume points instead of starting fresh                                                                                         | A reload costs hundreds of calls           |
| U3    | Parallel queue with a small limit (e.g. 4 in flight) across jobs and inside Coherence; per-call failures retried and isolated                                                 | 3–4 h → under 30 min                       |
| U4    | Coherence batched per section (one call per section and step, not per paragraph)                                                                                              | ~359 → ~60 calls                           |
| U5    | One "Phân tích bài báo" button with consent once, an honest time estimate ("~25 phút"), progress per purpose, and the call cap hidden under "Nâng cao"                        | One press, as the owner asked              |
| U6    | A one-screen Brief after the run: main claim, its evidence strength, top 3 weaknesses with page links, and basic facts (preprint or published, year, reference recency)       | Linh's and Minh's missing verdict view     |
| U7    | Parser and metadata fixes: split merged references, group duplicate citation cards, title from the PDF, arXiv DOI from the id, one sentence count with a label                | Noise buries real findings; RIS is empty   |
| U8    | Discoverability: badges read "Tr. 5 ↗" with a tooltip "Mở trong PDF"; header buttons get text; RIS/BibTeX also in Thông tin xuất bản; rename the "Data table" tab or merge it | Capabilities exist but nobody finds them   |

| U9 | Finding text for people: no internal ids (ev-…, cl-…) in the reason, quotes joined across line-break hyphens, repeated page badges collapsed ("Tr. 1 ×6" → "Tr. 1, 2, 6") | Seen on every AI finding after the run |
| U10 | Section choice per run, not silently shared; one paragraph count with its scope ("106 đoạn phần chính / 446 cả phụ lục"); "còn N" names what is left | Narrowing one block changed another |

Order: U1 → U2 → U3 → U4 → U5 → U6, with U7–U10 in parallel. U3 and U4 need a short spike on the router's
concurrency limit before they are built.

### Not reopened

The owner already decided that AI results are accepted until rejected and that the PDF is the centre
(`UX_REVIEW_PAPER_PAGE.md`). Dr. Minh asked for reject-by-default as a reviewer; that is recorded here, not proposed.
