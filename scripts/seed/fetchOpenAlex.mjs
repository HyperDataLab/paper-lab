/**
 * Runs the OpenAlex requests behind the agent-seeded CS corpora and saves them for `csCorpora.ts`.
 *
 *   node scripts/seed/fetchOpenAlex.mjs <raw.json>
 *
 * Anonymous, polite requests (no mailto, a few seconds apart, backing off on 429). The stored `url` omits
 * `select`, so it is the request a corpus search record keeps and "Cập nhật tìm kiếm" re-runs.
 */
import { writeFileSync } from 'node:fs';

const FILTER = 'primary_topic.field.id:17,is_oa:true,has_abstract:true,type:article|preprint';
const SELECT =
  'id,doi,display_name,publication_year,type,cited_by_count,authorships,primary_location,keywords,abstract_inverted_index,primary_topic';
const url = (search, from, perPage, field = 'title_and_abstract.search') =>
  `https://api.openalex.org/works?filter=${FILTER},from_publication_date:${from},${field}:${encodeURIComponent(search)}&sort=cited_by_count:desc&per_page=${perPage}`;

const TOPICS = {
  asyncfl: [
    url(
      '"asynchronous federated learning" OR "asynchronous federated optimization" OR "asynchronous federated"',
      '2019-01-01',
      100,
    ),
    url(
      'federated AND (staleness OR stale OR "semi-asynchronous" OR "buffered asynchronous" OR straggler OR stragglers)',
      '2019-01-01',
      100,
    ),
    url(
      '"asynchronous federated" OR "semi-asynchronous federated" OR (federated AND staleness)',
      '2024-01-01',
      60,
    ),
  ],
  energyfl: [
    url(
      '"federated learning" AND ("energy-efficient" OR "energy efficiency" OR "energy consumption" OR "energy-aware" OR "carbon footprint" OR "carbon-aware" OR "carbon emissions")',
      '2020-01-01',
      100,
    ),
    url('federated AND (energy OR carbon OR green OR sustainable)', '2020-01-01', 100, 'title.search'),
  ],
  agents: [
    url(
      '("large language model" OR "large language models" OR LLM OR LLMs) AND (agent OR agents) AND (autonomous OR "multi-agent" OR agentic OR "tool use")',
      '2020-01-01',
      100,
    ),
  ],
  rag: [url('"retrieval-augmented generation" OR "retrieval augmented generation"', '2020-01-01', 100)],
  codegen: [
    url(
      '("large language model" OR "large language models" OR LLM OR LLMs OR "language models") AND ("code generation" OR "program synthesis" OR "software engineering")',
      '2020-01-01',
      100,
    ),
  ],
  diffusion: [
    url(
      '("diffusion model" OR "diffusion models" OR "denoising diffusion" OR "score-based generative") AND image AND (generation OR synthesis OR editing)',
      '2020-01-01',
      100,
    ),
  ],
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function get(requestUrl) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(`${requestUrl}&select=${SELECT}`, {
      headers: { 'User-Agent': 'paperlab-seed/1.0' },
    });
    if (response.status === 429) {
      await wait(Math.max(Number(response.headers.get('retry-after')) || 0, 15 * (attempt + 1)) * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} ${requestUrl}`);
    return response.json();
  }
  throw new Error(`rate limited: ${requestUrl}`);
}

const out = process.argv[2];
if (!out) throw new Error('usage: fetchOpenAlex.mjs <raw.json>');
const raw = {};
for (const [topic, urls] of Object.entries(TOPICS)) {
  raw[topic] = [];
  for (const requestUrl of urls) {
    const body = await get(requestUrl);
    raw[topic].push({
      url: requestUrl,
      runAt: new Date().toISOString(),
      total: body.meta.count,
      results: body.results,
    });
    console.log(topic, body.meta.count, body.results.length);
    await wait(4000);
  }
}
writeFileSync(out, JSON.stringify(raw));
