# S6 acceptance — defects to fix

Found by Claude during acceptance of S6 (live run with 9router on the paragraph below). Same rules as
`docs/briefs/S6.md` (no commit, no new dependency, UTF-8 without BOM + LF, never read `.env.development.local`).

Test paragraph:
`The performance of the proposed model, after extensive testing across multiple datasets, was dramatically improved. These improvements are very significant. Several experiments were conducted to evaluate the system. We have not observed a statistically significant change in order to confirm it. It should be noted that the results did not change.`

## D1 — auxiliaries flagged as fuzzy verbs (false positives)

Observed: `FUZZY_VERB` on `have` (in `have not observed`) and on `did` (in `did not change`). Forms of `have` and
`do` used as auxiliaries are not fuzzy verbs.
Fix in `detectLexical`: a form of `have`/`do` is flagged only when it is a main verb, i.e. **not** when the next
word token (skipping `not`/`n't` and adverbs from the intensifier lists) is `been` or a past participle / bare
verb (`-ed`, `-en`, `-wn`, or any fuzzy-verb form), and not when it is followed by `not`/`n't`. When annotations
exist and the token is inside the sentence's `verbSpan` but is not at `verbHeadTokenIndex`, it is also not
flagged. Tests (EV-04): `have not observed`, `did not change`, `have been shown` (→ only `shown`, span = verb
group when annotated), `does the analysis` stays a candidate.

## D2 — generic `why` / `suggestedFix` for every type

Every detector issue says "Cần xem xét cách diễn đạt trong ngữ cảnh." and "Cân nhắc cách diễn đạt rõ hơn…".
Give each type its own short Vietnamese `why` and `suggestedFix` (no claim of a proven error), for example:

- `SUBJECT_VERB_GAP`: why "Cụm xen giữa dài tách chủ ngữ khỏi động từ chính; người đọc phải giữ chủ ngữ trong
  đầu lâu hơn." fix "Cân nhắc chuyển cụm xen giữa ra sau động từ chính nếu không đổi nghĩa."
- `CLAUSE_DEPTH`, `FUZZY_VERB`, `NOMINALIZATION`, `WEAK_MODIFIER`, `UNSUPPORTED_INTENSIFIER` (fix must say to
  add the supporting figure from the user's own data, never to invent one), `REDUNDANT_PHRASE`, `METADISCOURSE`.
  Lexical metric: `{ name: '<type>_candidates' in snake_case, value: 1, unit: 'candidate' }` (PRD §6 example).

## D3 — judged-acceptable items still show the detector's fix

After an `acceptable` verdict the row shows the model's reason followed by "Cân nhắc cách diễn đạt rõ hơn…",
which contradicts it. In `applyJudgement`, `acceptable` → `suggestedFix: null`; an empty model `why` falls back to
the detector `why`. Update the test.

## D4 — UI text

- Severity is shown in English (`minor`, `moderate`, `info`). Show Vietnamese labels: critical → "Nghiêm
  trọng", major → "Lớn", moderate → "Vừa", minor → "Nhỏ", info → "Thông tin".
- The `context_limited` notice next to the judge button only shows before syntax analysis; the judge is always
  context-limited (no context inputs yet), so show it whenever the button is shown.
- In `CandidateList`, put `why`, `suggestedFix` (prefixed "Gợi ý:") and `sourcePrinciple` on separate lines; omit
  "Gợi ý" when null.

## D5 — reopening an analysis saved before S6

`load` sets `issues` to the saved array, so a saved S5 analysis (`versions.detectors === null`, `issues: []`)
shows "Ứng viên vấn đề (0)". When `versions.detectors` is null, show locally computed candidates instead (still
no model call). Add a UI test.

Definition of done: the S6 commands (typecheck, lint, format:check, test:cov, build) pass; report what changed.
