# Topic and gap check (Research Design section)

Status: plan, 2026-11-17. Owner request: review the skills that sit on top of the Research Fast Track tools,
judge their role, and build the useful part into PaperLab's Project (setting up the search for the problems worth
researching).

## 1. What the two public skills do, and what we take

The Research Fast Track page ships two skills on top of its 8 tools. We read them to learn the workflow. We do not
copy their text, names or branding; the method ideas below are common research-methods practice.

| Skill            | Role in the workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Tools it leans on                                                       | What PaperLab takes                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Topic validation | Pressure-tests a topic the researcher already has. Two tracks: review (is there enough primary research to synthesise, is a review already published) and empirical study (will it be cited). Intake: topic in 2-3 sentences, 1-3 closest papers and how the idea differs, the live debate, a quick search count, time/resources/interest. Phases: topic neighbourhood (interest x feasibility x live debate), tests (duplication, feasibility, impact), a precise question (PICO), plain-language check, then human validation. | run_duplication_test, check_gap_saturation, map_topic_debate, get_paper | Yes, as section **"Đề tài và khoảng trống"** (this plan).                                                                  |
| Reference audit  | Checks every reference of a manuscript against Crossref/OpenAlex: identifier registered, metadata match, in-text markers vs list, claim vs abstract. Never calls a reference fake.                                                                                                                                                                                                                                                                                                                                               | verify_reference, search_papers, get_paper                              | Later slice T3: extends PaperLab's existing reference check (`paper-import/PaperReferences.tsx`) with metadata comparison. |

Principles we keep, because they match PaperLab's own invariants:

- **The researcher owns the topic, the gap and the question.** The app never generates them; there is no LLM call in
  this feature. Tools return leads (papers, counts) with openable links; the researcher reads them and decides.
- **No machine verdict.** Each check shows what is missing or what the evidence says. The researcher records their
  own decision (go / adjust / back to groundwork) and the next human step (supervisor or lab meeting).
- **Thin counts are not proof of a gap.** Counts are estimates and depend on vocabulary; the UI says so and shows the
  query actually used (`query_used`, `broadened_from`).
- Duplication on the review track is judged against existing reviews, not primary studies.

## 2. Where it lives

- New first section of Research Design: id `topic`, label "Đề tài và khoảng trống".
- Data: optional field `topicCheck` on `ResearchDesignSchema` (same pattern as `publishedPlans`), so it is saved
  with the design, versioned, and exported/imported with no extra wiring. Older records still parse.
- The question draft already has `gap` per question; the topic check links to it (copy the agreed gap statement into
  a question's `gap` on the researcher's click), not a parallel concept.

## 3. Data model (`core/schemas/topicCheck.ts`)

```
TopicCheck = {
  schemaVersion: 1,
  track: 'review' | 'study',
  statement: string,                    // the topic in 2-3 sentences, researcher's words
  neighbours: [{ ref: string (DOI or W-id), label: string, difference: string, source: 'researcher' | 'tool' }],
  debate: string,                       // the live debate, researcher's summary
  convergence: { interest: 1..5 | null, feasibility: string, debateAlive: 'yes' | 'unsure' | 'no' | null },
  pico: { population, exposure, comparison, outcome: string },   // review track required, study track optional
  plainSummary: string,                 // explain to a non-specialist
  evidence: [{ id, kind: 'duplication' | 'saturation' | 'debate' | 'impact', ranAt, input, queryUsed,
               broadenedFrom?, result }],  // snapshots of tool outputs, newest first, max 20
  decision: { verdict: 'go' | 'adjust' | 'groundwork' | null, note: string, nextHumanStep: string, decidedAt? },
  updatedAt
}
```

`result` stores the tool output trimmed to what the UI shows (titles, ids, years, counts, urls), parsed by Zod.

## 4. Checks (pure, `core/topicCheck/checks.ts`)

Deterministic, explained, and labelled as suggestions:

| Check                | Missing            | Needs work                                                                   | Ready                    |
| -------------------- | ------------------ | ---------------------------------------------------------------------------- | ------------------------ |
| Topic statement      | empty              | > 3 sentences or > 90 words                                                  | otherwise                |
| Neighbours           | none               | any without a difference note                                                | >= 1 with differences    |
| Debate               | empty              | < 40 words                                                                   | otherwise                |
| Convergence          | any field unset    | interest <= 2, or debate 'no'                                                | all set and positive     |
| Duplication evidence | no duplication run | review track: newest run lists reviews the researcher has not marked as read | run present and reviewed |
| Feasibility (review) | no saturation run  | total < 5 (too narrow, suggestion) or > 500 (too broad, suggestion)          | otherwise                |
| Impact (study)       | no impact run      | all neighbours flat at ~0 citations/year                                     | otherwise                |
| PICO (review)        | element empty      | —                                                                            | all four filled          |
| Plain summary        | empty              | > 3 sentences                                                                | otherwise                |

Thresholds are constants in one place with a comment that they are rules of thumb, shown as "gợi ý".

## 5. Calling the tools

`shared/labResearch/client.ts`, copied from the `bankApi.ts` pattern: base URL `VITE_LAB_RESEARCH_URL`,
`getToken` from `useAuth()`, injectable `fetch`, typed `LabResearchError(status, code, message, retryAfter)`.
Calls `POST {base}/v1/tools/{name}` on the lab-research Worker (HyperDataLab/lab-research-mcp), which accepts
PaperLab's Firebase ID tokens. Output is validated with Zod in the client.

Why the Worker and not the browser scholar client: one implementation of the duplication test, gap curve and debate
map, shared with Claude over MCP; the OpenAlex key and cache stay server-side.
Until the owner deploys the Worker, development runs it with `wrangler dev` (ALLOWED_ORIGINS=http://localhost:5174).

## 6. Slices

| #   | Slice                                                                                                                                                                                            | Repo             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| T0  | `POST /v1/tools/:name` JSON API + CORS for PaperLab origins                                                                                                                                      | lab-research-mcp |
| T1  | Schema + checks + lab-research client + section with the researcher's inputs, PICO, plain summary, checklist, decision                                                                           | paragraph-lab    |
| T2  | Evidence runs from the section: duplication (review mode on review track), gap curve (CSS bars), debate map, citation trajectory of neighbours; snapshots; "add as neighbour" and "mark as read" | paragraph-lab    |
| T3  | Reference audit: metadata comparison against Crossref for a paper's reference list                                                                                                               | paragraph-lab    |

Owner actions: deploy the lab-research Worker with its secrets, set `VITE_LAB_RESEARCH_URL` for the PaperLab build.
