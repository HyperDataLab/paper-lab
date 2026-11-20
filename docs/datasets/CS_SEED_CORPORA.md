# CS seed corpora (agent-seeded, 2026-11-19)

Six Computer Science topic corpora seeded by an agent from OpenAlex (CC0 metadata) at the owner's request. They
were seeded in R2 under `paperlab/corpora/<id>`. In Settings, a lab admin can choose **Nhập corpus cũ**
under **Tài khoản lab** to add missing corpus records to the central store and make them visible in the corpus list.
Members carry DOI, OpenAlex W id, year (stratum), `cited_by_count` and subfield, all with role `build`.
No screening decisions were made. Screening is left to a person or the AI triage.

## How they were built

1. `node scripts/seed/fetchOpenAlex.mjs <raw.json>` runs the queries below: anonymous requests with no mailto,
   spaced a few seconds apart. Every query filters on `primary_topic.field.id:17` (Computer Science),
   `is_oa:true`, `has_abstract:true` and `type:article|preprint`, and is sorted by `cited_by_count:desc`.
2. `npx tsx scripts/seed/csCorpora.ts <raw.json> <outDir>` keeps works whose title names the topic, dedupes by
   identifier and by title plus year, and takes the most-cited ones. Each corpus goes through the app's own path
   (`newCorpus`, `candidateFromWork`, `recordSearch`) and is parsed by `CorpusSchema` before it is written.
   There is one search record per query, so the PRISMA counts and "Cập nhật tìm kiếm" work as usual. `retrieved`
   counts only the records that passed the title check.
3. Each object was uploaded with a create-only write (`etagDoesNotMatch: '*'`). It carries the same
   customMetadata the worker sets (`title`, `kind`, `updatedAt`, `updatedBy`).

The OpenAlex W ids were queued in the lab KG `ingest_queue` with source `seed`. The asynchronous FL members are
queued first, at depth 1, so their references and their top citing works are pulled in too. The other members
are queued at depth 0.

## Corpora

| Corpus                                               | id                                     |   N | Years     | 2024+ |
| ---------------------------------------------------- | -------------------------------------- | --: | --------- | ----: |
| CS · Asynchronous federated learning (OA, 2019–2026) | `e99ebad7-14cc-4d58-8710-0430d8c05dd8` |  75 | 2019–2026 |    29 |
| CS · Energy- and carbon-aware federated learning     | `0627d020-c2d1-450c-aedd-25302405bdb4` |  40 | 2020–2025 |    12 |
| CS · LLM-based autonomous agents                     | `1ebdf940-4ee5-484b-90ef-61b55a8aade9` |  40 | 2022–2025 |    28 |
| CS · Retrieval-augmented generation                  | `508e05a0-a904-4a0f-8f5d-c4fafeca9210` |  40 | 2020–2026 |    31 |
| CS · Code generation with large language models      | `8cbfd5c2-e899-4fa7-8d31-3070e3d80cd4` |  40 | 2021–2026 |    20 |
| CS · Diffusion models for image generation           | `3e8608dd-5958-44eb-ba59-0d55eb1254db` |  40 | 2020–2025 |     8 |

Each stored title ends with "(OA, years)". The year ranges are the ones in the table.

## Queries (run 2026-11-19, UTC)

All URLs share the prefix `https://api.openalex.org/works?filter=primary_topic.field.id:17,is_oa:true,has_abstract:true,type:article|preprint,`
and end with `&sort=cited_by_count:desc&per_page=<n>`. Reported = OpenAlex `meta.count`. Added = new members.

| Corpus     | Run (UTC) | From       | Search filter (decoded)                                                                                                                                                                                  | n   | Reported | Added |
| ---------- | --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------: | ----: |
| Async FL   | 06:44:06  | 2019-01-01 | `title_and_abstract.search:"asynchronous federated learning" OR "asynchronous federated optimization" OR "asynchronous federated"`                                                                       | 100 |      207 |    57 |
| Async FL   | 06:44:13  | 2019-01-01 | `title_and_abstract.search:federated AND (staleness OR stale OR "semi-asynchronous" OR "buffered asynchronous" OR straggler OR stragglers)`                                                              | 100 |      449 |    17 |
| Async FL   | 06:44:20  | 2024-01-01 | `title_and_abstract.search:"asynchronous federated" OR "semi-asynchronous federated" OR (federated AND staleness)`                                                                                       | 60  |      249 |     1 |
| Energy FL  | 06:44:27  | 2020-01-01 | `title_and_abstract.search:"federated learning" AND ("energy-efficient" OR "energy efficiency" OR "energy consumption" OR "energy-aware" OR "carbon footprint" OR "carbon-aware" OR "carbon emissions")` | 100 |     1157 |    19 |
| Energy FL  | 06:48:56  | 2020-01-01 | `title.search:federated AND (energy OR carbon OR green OR sustainable)`                                                                                                                                  | 100 |      420 |    21 |
| LLM agents | 06:44:34  | 2020-01-01 | `title_and_abstract.search:("large language model" OR "large language models" OR LLM OR LLMs) AND (agent OR agents) AND (autonomous OR "multi-agent" OR agentic OR "tool use")`                          | 100 |    21054 |    40 |
| RAG        | 06:44:55  | 2020-01-01 | `title_and_abstract.search:"retrieval-augmented generation" OR "retrieval augmented generation"`                                                                                                         | 100 |     7551 |    40 |
| Code gen   | 06:45:48  | 2020-01-01 | `title_and_abstract.search:("large language model" OR "large language models" OR LLM OR LLMs OR "language models") AND ("code generation" OR "program synthesis" OR "software engineering")`             | 100 |     4711 |    40 |
| Diffusion  | 06:46:45  | 2020-01-01 | `title_and_abstract.search:("diffusion model" OR "diffusion models" OR "denoising diffusion" OR "score-based generative") AND image AND (generation OR synthesis OR editing)`                            | 100 |     4773 |    40 |

The third asynchronous FL query (2024 onward) added only one new member. The first query had already returned
most of the highly cited 2024–2026 work, and that work is counted as a duplicate on the third query's record.
The exact request URLs are on each corpus's search records and in `scripts/seed/fetchOpenAlex.mjs`.
