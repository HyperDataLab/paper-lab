# SciAtlas proxy: `POST /v1/sciatlas/search`

Slice K4 of `docs/plans/OPENKG_PAPER_BRANCH.md`. The PaperLab PDF worker forwards a related-papers search to
SciAtlas (OpenKG, `http://sciatlas.openkg.cn/v1/search`) with the lab's token. SciAtlas is plain HTTP, so the
https app cannot call it directly.

- Code: `worker/src/sciatlas.ts` (route), `src/core/openkg/sciatlas.ts` (request schema, payload, normaliser,
  shared by the worker and the app), `src/core/openkg/sciatlasAnchors.ts` (anchors from a paper or corpus KG),
  `src/shared/openkg/` (client and panel).
- Auth: the same Firebase ID token check as every `/v1` route (`Authorization: Bearer <token>`, lab domain).
  No token or a bad one → 401 `unauthenticated`; another domain → 403 `forbidden`.
- Secret: `SCIATLAS_API_KEY`, set with `npx wrangler secret put SCIATLAS_API_KEY` in `worker/`. It is read from
  the environment only, sent to SciAtlas as `Authorization: Bearer` and `X-API-Key`, and never logged, stored or
  returned.
- Nothing is stored: no R2 write, no log of the query text. Every response carries `Cache-Control: no-store`.
- No per-user rate limit; SciAtlas's own daily quota applies.

## Request

```json
{
  "query": "optional free text; empty means the titles and keywords joined with '; '",
  "keywords": [{ "text": "graph neural networks", "level": "high" }],
  "titles": [{ "title": "A synthetic study of graphs", "level": "high" }],
  "references": ["An earlier synthetic study"],
  "after": "2015-01-01",
  "before": "2025-12-31",
  "topK": 10,
  "mode": "hybrid",
  "ranking": "balanced"
}
```

- `level`: `high` | `middle` | `low`. At least one keyword or title is required (otherwise 400).
- Limits: 20 keywords, 10 titles, 20 references, query 2000 characters, body 64 KB (413 above).
- `after` / `before`: `YYYY-MM-DD`. `topK` is capped at 20. `mode`: `keyword` | `semantic` | `title` |
  `hybrid` (default). `ranking`: `precision` | `balanced` | `discovery` | `impact`.
- A 400 names only the failing fields, never their values.

## Payload sent to SciAtlas

```json
{
  "plan": {
    "query_text": "…",
    "source_type": "idea_text",
    "source_title": "first title or null",
    "keywords": [{ "text": "graph neural networks", "score": 9 }],
    "titles": [{ "title": "A synthetic study of graphs", "confidence": 0.95 }],
    "reference_titles": ["An earlier synthetic study"]
  },
  "options": {
    "top_k": 10,
    "retrieval_mode": "hybrid",
    "after": "2015-01-01",
    "before": "2025-12-31",
    "retrieval_bias": { "ranking_profile": "balanced" }
  }
}
```

Keyword scores are the base of each SciAtlas level: high 9, middle 7, low 4. Title confidences: high 0.95,
middle 0.85, low 0.65. The request times out after 60 seconds.

## Response

```json
{
  "papers": [
    {
      "rank": 1,
      "title": "A related synthetic paper",
      "year": 2021,
      "score": 0.82,
      "citations": 14,
      "venue": "Synthetic Journal",
      "authors": ["A. Author"],
      "id": "https://openalex.org/W123",
      "doi": "10.1000/example",
      "openalexId": "W123",
      "abstract": "…"
    }
  ],
  "requestId": "req-1",
  "elapsedMs": 2140
}
```

`year`, `score`, `citations`, `venue` and `id` are `null` when SciAtlas gives none; `doi`, `openalexId` and
`abstract` are left out. `doi` is lowercase without the `https://doi.org/` prefix; `openalexId` is the short
`W…` id.

### Normalising SciAtlas's answer

The paper list is not documented. Like the official CLI, the reader walks `data` recursively and takes every
object with a title, in order:

- title ← `title`, `paper_title`, `work_title`; or `display_name` / `name` only when the object also has a
  paper field (a year, citation count, `doi`, `openalex_id`, `paper_id` or authors), so a bare author or keyword
  object is not a paper;
- year ← `year`, `publication_year`, `pub_year`; score ← `score`, `rank_score`, `kg_score`, `similarity`,
  `similarity_score`, `final_score`; citations ← `citation_count`, `cited_by_count`, `citations`;
  venue ← `venue`, `journal`, `conference`, `source` (a string or an object's `display_name` / `name`);
  authors ← `authors` or `author_names` (strings or objects with a name); id ← `id`, `paper_id`,
  `openalex_id`, `doi`, `url`; abstract ← `abstract`, `abstract_text` (cut at 4000 characters).
- An object taken as a paper is not searched further. The keys `plan`, `query`, `keywords`, `titles`,
  `reference_titles` and `options` are skipped, since they echo the request.
- Papers are deduplicated by DOI, OpenAlex id, id or normalised title, and ranked 1… in order.

Not verified against a live SciAtlas answer; adjust the key lists if the real shape differs.

## Errors

Errors are `{ "error", "message" }` JSON, as on other `/v1` routes. SciAtlas's own text is never forwarded.

| Case                                      | Status | `error`                                    |
| ----------------------------------------- | ------ | ------------------------------------------ |
| `SCIATLAS_API_KEY` not set                | 503    | `sciatlas_not_configured`                  |
| SciAtlas 401 or 403 (bad/disabled token)  | 502    | `sciatlas_auth`                            |
| SciAtlas 429 (daily quota used up)        | 429    | `sciatlas_quota`                           |
| No answer within 60 s                     | 504    | `sciatlas_timeout`                         |
| Envelope `status` other than `"ok"`       | 502    | `sciatlas_error` (+ `requestId` when safe) |
| Any other SciAtlas or network failure     | 502    | `sciatlas_error`                           |
| Method other than POST                    | 405    | `bad_request`                              |
| Bad JSON, no keyword or title, bad fields | 400    | `bad_request`                              |

## Anchors built by PaperLab

- **Paper** (`paperSciAtlasAnchors`): keywords are the paper's OpenAlex keywords with salience high or middle
  (score ≥ 0.6 high, ≥ 0.4 middle), highest score first, at most 8, at their own level; the paper title as a
  high title; up to 10 reference titles, first from GROBID's structured references, then from SCG references
  (`buildsOn` Work nodes). Raw citation strings and bare OpenAlex ids are never sent. The date range is the
  paper's year ± 5 when known, and the user may turn it off.
- **Corpus** (`corpusSciAtlasAnchors`): the 8 keywords carried by the most member papers (ties by mean score,
  then name); the first half (rounded up) high, the rest middle; no titles or references; the date range is
  the corpus's first to last publication year.

The panel lets the user remove any anchor and change a keyword's level before searching. Results stay in the
panel only. In the corpus card, a result whose DOI or OpenAlex id matches a member is marked "Đã có trong
corpus", and one with a DOI can be added with "Thêm vào corpus" (the corpus "Danh sách DOI" intake path). In the
paper tab, results are marked "Đã có trong Library" when they match a Library record; there is no corpus to
add to there.
