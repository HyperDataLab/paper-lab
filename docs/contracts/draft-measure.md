# Draft measure v1 (`POST /v1/measure`)

Writing Bank slice B4 compares a writer's draft with a journal profile (corpus profile v2). PaperLab's pdf
worker measures the draft with the same code and the same feature registry v2 that built the profile, so
each value can be set against the profile's value for the same feature id.

- Schema: `schemas/draft-measure-v1.schema.json` (public copy `public/schemas/draft-measure-v1.schema.json`;
  the request body is under `$defs.request`).
- Synthetic example: `schemas/examples/draft-measure-v1.example.json`.
- Code: `src/core/draftMeasure` (`measureDraft`), route `worker/src/measure.ts`.
- Regenerate with `npm run schema:corpus-profile` (the script writes every contract file).

## Request

```http
POST https://paperlab-pdf-worker.hyperdatalab.workers.dev/v1/measure
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{ "format": "markdown", "title": "A toy study", "text": "## Introduction\n\nWidgets may matter..." }
```

- `format`: `markdown` or `text`. `text`: the draft, not empty. `title`: optional, at most 500 characters.
  No other keys.
- The whole body is at most 200 KB (UTF-8).
- Sign-in: a verified Google account of the lab's domain, with a token from a Firebase project listed in
  the worker's `ACCEPTED_PROJECT_IDS`. That list and `ALLOWED_ORIGINS` include Writing Bank's project
  (`hyperdatalab-writing-bank`) and its web.app and firebaseapp.com origins, so the Writing Bank site can
  call the route once the worker is deployed.
- The draft is not stored: it is never written to R2 and never logged, and the response is
  `Cache-Control: no-store`. Error messages name only the failing fields, never draft text.

Errors use the `/v1` shape `{ "error", "message" }`: 400 `bad_request` (bad JSON, bad shape, empty text,
method other than POST), 401 `unauthenticated`, 403 `forbidden` (another domain), 413 `bad_request`
(over 200 KB), 500 `internal`.

## How the draft is read

PaperLab's own segmenter (`segmentPaper`, the one used for `.md` and `.txt` imports) reads the text, and
the result becomes a paper model (`buildPaperModel`) with sections, roles from the heading table
(`sectionRoles`), body paragraphs and sentences with content keys. Both formats use the same reader:

- Markdown: `#`…`######` lines are headings. A single leading `# Title` above `##` sections is taken as the
  draft title, not a section (warning `title_heading_lifted`); otherwise it would hold every section as a
  subsection.
- Plain text: a line is a heading when it is a known section name ("Introduction", "Methods", …), an
  upper-case line, or a numbered heading ("2. Methods"), as in a PDF import.
- Text before the first heading is front matter and is not measured. Paragraphs are separated by blank
  lines. A line containing `=` reads as an equation and a line starting with `-`, `*` or `1.` as a list;
  neither counts as body text.
- References, the title and boilerplate (acknowledgements, funding, data availability, author
  contributions, competing interests) are left out, as for papers in a profile.

## Response

```jsonc
{
  "format": "paperlab-draft-measure",
  "version": 1,
  "registryId": "paperlab-feature-registry",
  "registryVersion": 2,
  "registryDigest": "sha256:…", // same as registry.digest of a corpus profile v2
  "title": "A toy study of synthetic widgets",
  "features": [
    { "id": "section.METHODS.paragraph_count", "value": 1, "status": "measured" },
    { "id": "section.ABSTRACT.paragraph_count", "value": null, "status": "unavailable", "reason": "no_data" },
    { "id": "argument.with_data", "value": null, "status": "unavailable", "reason": "needs_llm_pass" },
    {
      "id": "section.METHODS.passive",
      "value": null,
      "status": "unavailable",
      "reason": "grammar_service_unavailable",
    },
  ],
  "sections": [
    {
      "index": 0,
      "line": 1,
      "heading": "## 1. Introduction",
      "title": "1. Introduction",
      "level": 2,
      "role": "INTRODUCTION",
      "counted": true,
      "paragraphs": 2,
      "words": 16,
    },
  ],
  "grammar": { "status": "not_configured", "parser": null, "sentences": 7, "parsed": 0 },
  "warnings": [
    {
      "code": "excluded_sections",
      "message": "Not measured (…): \"Acknowledgements\".",
      "sections": [3],
    },
  ],
}
```

### `features`

One entry per registry v2 feature, in registry order (243 features). `value` is a number only when
`status` is `measured`; otherwise it is null and `reason` says why:

| `reason`                      | Features                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needs_llm_pass`              | Every `extractor: "llm"` feature (130): `stance.hedges`, `stance.boosters`, `rhetoric.*`, `claim.*`, `section.<ROLE>.claim.*`, `argument.*`. They count machine labels, and the route runs no LLM. |
| `grammar_service_unavailable` | Every `extractor: "tool"` feature (36): `section.<ROLE>.passive` and `section.<ROLE>.tense.*`, when the grammar service is not configured, has nothing to parse, or failed.                        |
| `no_data`                     | A deterministic or parsed feature with no value for this draft: the role is absent, or a share has no denominator. The same case is null in a profile.                                             |

The 77 deterministic features (`section.<ROLE>.word_share`, `sentence_length`, `presence`,
`paragraph_count`, `paragraph_length`, `hedges`, `boosters`, `first_person`; `paragraph.length`,
`citation.rate`, `structure.*`) are always computed; for a draft they are `measured` or `no_data`. The
style-lexicon rates `section.<ROLE>.hedges` / `boosters` / `first_person` are word-list matches, not the
machine labels behind `stance.*`.

Main-claim evidence levels (`evidenceLevel` in corpus profile v2) are not registry features and are not
measured for drafts: they need an argument run.

### `sections`

One entry per section, in order. `heading` is the heading line as written (trimmed, with its `#` or
numbering; both lines when the reader joined a two-line heading), `line` its 1-based line in `text`, and
`title` the heading as PaperLab reads it. For text before the first heading, `heading` and `line` are
null and `title` is "Front matter". `role` is the signature section used in feature ids; a combined
"Results and discussion" heading takes its first role (`RESULTS`) and sets
`structure.results_discussion_combined`. `counted` is true when the section's own body paragraphs enter the measures: it is false for front
matter, references and boilerplate, and also for a heading with no text of its own (a `##` whose text
sits in its `###` subsections).
`paragraphs` and `words` count body paragraphs only.

### `grammar`

`status` is `parsed` (the topics worker parsed the body sentences), `not_configured` (the worker has no
`NLP_URL`, or the draft has no body sentence) or `failed` (the call failed or returned an invalid parse;
the route still answers 200). `parser` names the service version, spaCy version and model when parsed;
`sentences` and `parsed` count body sentences sent and parsed.

### `warnings`

`{ code, message, sections? }`, where `sections` lists `sections[].index` values:

| `code`                      | Meaning                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| `no_headings`               | No heading found, so nothing was measured.                                    |
| `text_before_first_heading` | Text above the first heading is front matter and not measured.                |
| `title_heading_lifted`      | A single leading markdown `# Title` was read as the title.                    |
| `unrecognised_headings`     | Headings with no known role; their text counts as `OTHER`.                    |
| `excluded_sections`         | Sections with text that are not measured (references, title, boilerplate).    |
| `non_body_blocks`           | Blocks read as lists, equations, captions or tables, not counted as body.     |
| `grammar_partial`           | The grammar service parsed only some body sentences.                          |
| `grammar_service_failed`    | The grammar service was configured but failed; passive and tense unavailable. |

## Deploy notes

- `NLP_URL` is unset by default. To measure passive voice and tense, the owner sets it (for example
  `npx wrangler deploy --var NLP_URL:https://paperlab-topics-worker.hyperdatalab.workers.dev`, or in the
  dashboard). The topics worker checks the caller's token itself, so it must accept the same Firebase
  projects: its `topics-worker/wrangler.toml` lists only `hyperdatalab-paragraph-lab` today, so for
  Writing Bank callers grammar would be `failed` until the owner adds `hyperdatalab-writing-bank` there. A worker calling another `workers.dev` worker on the same account may need a service binding;
  check this after deploy.
