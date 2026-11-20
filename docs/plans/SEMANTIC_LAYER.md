# Semantic layer

PaperLab's own semantic layer, borrowing the idea of NVIDIA auto-ontology without running its stack. It lets
agents (the lab MCP server, AutoResearch PI / Critic, UI agents) understand PaperLab's objects, pages and
corpora. Everything is plain TypeScript data plus pure helpers in `src/core/semantic/`; no embeddings, no new
runtime dependency. The four steps run in order, and each one builds on the previous step's output.

The layer describes the central store (D1 `paperlab-data` plus R2, ADR-0007), including its collection registry
and Zod schemas in `src/core/storage/collections.ts` and original PDFs under `paperlab/pdfs/`. The lab KG has
its own D1 database, `paperlab-kg`, with migrations in `worker/migrations/*.sql`.

## Step 1: concept registry (done)

Files:

- `src/core/semantic/concepts.ts`: `CONCEPTS`, a typed list of `Concept`.
- `src/core/semantic/index.ts`: `searchTerms(query, { limit })`, `getTerm(id)`, `relatedTerms(id)`,
  `normalizeTerm(text)` and `toJson()`.
- `src/core/semantic/concepts.test.ts`: the registry checks.

Shape of a concept:

```ts
{
  id: 'corpus-member',                 // kebab-case, unique
  name: 'Corpus member',               // English
  labelVi: 'Bài trong corpus',         // Vietnamese, academic terms in English (DESIGN.md §5)
  description: '…',                    // one or two plain Vietnamese sentences
  synonyms: ['member', 'thành viên', …],
  store:
    | { kind: 'central', collection }  // a CollectionName
    | { kind: 'kg', table }            // a migration table
    | { kind: 'nested', parent, path } // dotted path inside the parent concept, `[]` = array element
    | { kind: 'r2', prefix },
  fields: [{ name: 'identifiers.doi', description: '…' }],  // main fields only
  relations: [{ to: 'kg-paper', kind: 'refers-to', via: 'identifiers.doi' }],
  schema?: { file: 'src/core/schemas/corpus.ts', export: 'CorpusMemberSchema' },
}
```

Rules the tests enforce:

- every collection in `COLLECTIONS` has exactly one `central` concept; objects inside a record are `nested`;
- nested paths, field names and relation `via` resolve in the real zod schema (zod v4 `def` introspection; a key
  in a union passes when one option has it; `lazy` is never entered);
- KG concepts name a migration table, and their fields and `via` are its real columns (or an edge table);
  every table in `KG_NODE_TABLES` and `KG_EDGE_TABLES` has a concept;
- relation targets and nested parents exist; ids are unique; schema refs point at exported zod schemas;
- `searchTerms` is accent-insensitive (NFD plus `đ` → `d`) and ranks exact label or synonym matches first.

`toJson()` returns `{ format: 'paperlab-semantic-concepts', version, concepts }` in registry order with no
timestamps, so the MCP server can serve it as is. Bump `SEMANTIC_REGISTRY_VERSION` when the shape changes.

Hand-written parts are limited to descriptions, synonyms and relations. When a schema changes, the test names
the stale field.

## Step 2: page map

Files: `src/core/semantic/pages.ts` (`PAGES`), helpers `describePage(routeOrId)` and `pagesForConcept(id)` in
`index.ts`, `pages.test.ts`.

The page map is plain data in `core`, which may not import `app` or `modules` (AGENTS.md, enforced by ESLint).
A test outside `core` (for example `src/app/pageMap.test.ts`) compares it with the module registry
(`src/app/modules.ts` and each `src/modules/<id>/index.ts`), so a route added there without a page fails.
Shape of a page (the route below is illustrative; real ids and routes come from the registry):

```ts
{
  id: 'corpus.screening',
  route: '/corpus/:corpusId/screening',  // illustrative
  module: 'corpus',
  labelVi: '…',
  purpose: '…',                       // what a person does here, Vietnamese
  params: [{ name: 'corpusId', concept: 'corpus' }],
  shows: ['corpus-member', 'screening-decision'],   // concept ids
  edits: ['screening-decision'],
  actions: [{ id: 'decide', labelVi: '…', writes: 'screening-decision', ai: false }],
}
```

Tests: every registered route has a page, every concept id exists, every route param maps to a concept.

## Step 3: MCP / agent tools

The lab MCP server (and AutoResearch agents) get five read-only tools backed by steps 1–2:

| Tool               | Input               | Output                                                                     |
| ------------------ | ------------------- | -------------------------------------------------------------------------- |
| `search_terms`     | `{ query, limit? }` | `[{ id, name, labelVi, score, store }]` from `searchTerms`                 |
| `get_term`         | `{ id }`            | the concept from `toJson()` plus `relatedTerms(id)`                        |
| `describe_page`    | `{ route \| id }`   | the page from step 2 with its concepts expanded to `{ id, name, labelVi }` |
| `describe_corpus`  | `{ corpusId }`      | kind, protocol summary, member and screening counts, releases, profiles    |
| `check_answerable` | `{ question }`      | `{ answerable, concepts, stores, missing }`                                |

`check_answerable` says which concepts and stores a question needs, and what PaperLab does not hold.

The registry ships to the MCP server as `toJson()` output (a generated JSON file, checked in CI against the
source), so the server never imports app code. `describe_corpus` reads the central store through the existing
data routes. No tool writes.

## Step 4: read-only text-to-SQL on the lab KG (done)

Files: `worker/src/kg/sql.ts` (validator and runner), `src/core/semantic/kgSchema.ts` (the KG part of the
registry rendered as a prompt schema), tests next to each.

- The question and the `kg` schema go to 9router from the browser after consent. The prompt version is
  `kg-sql-1`. The model returns a statement and an explanation. KG rows stay out of the model request.
- The browser posts the statement to `POST /v1/kg/sql`. The authenticated worker validates one `SELECT` or
  non-recursive `WITH … SELECT` against the registry and runs it on the `KG` binding. See the
  [route contract](../contracts/lab-kg.md) for validation and limits.
- `/lab-kg` shows the generated SQL, explanation, result table, truncation and the registry concepts used.
- Validator, route and UI tests use synthetic data. Deploy the worker before Firebase Hosting so the panel
  can reach the new route. The existing KG binding suffices and this step adds no migration or worker secret.
