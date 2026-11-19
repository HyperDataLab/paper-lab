/**
 * Builds the agent-seeded Computer Science topic corpora from saved OpenAlex responses.
 *
 *   npx tsx scripts/seed/csCorpora.ts <raw.json> <outDir>
 *
 * `raw.json` maps a topic key to the OpenAlex requests made for it: `{ url, runAt, total, results }[]`, where
 * `url` is the request without `select` (the one stored on the search record). Each corpus goes through the
 * app's own path (`newCorpus` → `candidateFromWork` → `recordSearch`) and is parsed by `CorpusSchema` before it
 * is written. No screening decisions are made: screening stays with a person (or the AI triage).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newCorpus } from '../../src/core/corpus/index';
import { recordSearch } from '../../src/core/corpus/topic';
import { candidateFromWork } from '../../src/core/extraction/deep';
import { CorpusSchema, type Corpus } from '../../src/core/schemas/corpus';
import { normalTitle } from '../../src/core/text/normalizeTitle';

type Work = {
  id: string;
  doi: string | null;
  display_name: string;
  publication_year: number;
  cited_by_count: number;
  primary_topic?: { subfield?: { id?: string } } | null;
};
type Request = { url: string; runAt: string; total: number; results: Work[] };
type Pick = { query: number; take: number };
type Topic = {
  key: string;
  name: string;
  question: string;
  inclusion: string[];
  /** A work is kept only when its title names the topic. */
  relevant: (title: string) => boolean;
  /** Works taken per query, in citation order, after the earlier queries' picks. */
  picks: Pick[];
  /** At most this many works in all. */
  cap?: number;
};

const SEEDED_AT = '2026-11-19';
const PROVENANCE = `Seeded by agent from OpenAlex (CC0 metadata) on ${SEEDED_AT}; no screening decisions recorded.`;
const COMMON_INCLUSION = [
  'OpenAlex primary topic in the Computer Science field (fields/17)',
  'Open access (is_oa) with an abstract in OpenAlex',
  'Journal or conference article, or preprint',
];
const COMMON_EXCLUSION = [
  'Title does not name the topic (checked before intake; such records are not counted as retrieved)',
  'Same work already found by an earlier query (counted as a duplicate)',
  'Not open access, or no abstract in OpenAlex',
];
const fed = (title: string) => /federat/iu.test(title);

const TOPICS: Topic[] = [
  {
    key: 'asyncfl',
    name: 'Asynchronous federated learning',
    question:
      'How do asynchronous and semi-asynchronous federated learning methods (staleness-aware and buffered aggregation, straggler handling) train models on heterogeneous edge and IoT clients, and what convergence guarantees hold under staleness?',
    inclusion: [
      'Asynchronous, semi-asynchronous or buffered federated learning; staleness-aware aggregation; straggler handling; async FL on edge/IoT; convergence under staleness',
      'Published 2019 or later; the third query adds the most-cited 2024–2026 work',
    ],
    relevant: (title) =>
      /asynchron|\basync|stale|straggl|buffered|asynchronous tiers/iu.test(title) &&
      (fed(title) || /\bFL\b|FedAT|FedBuff/u.test(title)),
    picks: [
      { query: 0, take: 40 },
      { query: 1, take: 20 },
      { query: 2, take: 15 },
    ],
  },
  {
    key: 'energyfl',
    name: 'Energy- and carbon-aware federated learning',
    question:
      'How do federated learning systems reduce or account for the energy use and carbon emissions of training on wireless, edge and IoT devices?',
    inclusion: ['Federated learning whose title names energy, carbon, green or sustainable operation'],
    relevant: (title) => fed(title) && /energy|carbon|green|sustainab|power consumption/iu.test(title),
    picks: [
      { query: 0, take: 40 },
      { query: 1, take: 40 },
    ],
    cap: 40,
  },
  {
    key: 'agents',
    name: 'LLM-based autonomous agents',
    question:
      'How are large language models used as autonomous or multi-agent systems that plan, use tools and act, and how are such agents evaluated?',
    inclusion: ['Agents or multi-agent systems built on large language models'],
    relevant: (title) => /agent/iu.test(title),
    picks: [{ query: 0, take: 40 }],
  },
  {
    key: 'rag',
    name: 'Retrieval-augmented generation',
    question:
      'How does retrieval-augmented generation ground large language model output in retrieved documents, and how is it built and evaluated?',
    inclusion: ['Retrieval-augmented generation methods, systems, surveys or benchmarks'],
    relevant: (title) => /retriev|\bRAG\b/iu.test(title),
    picks: [{ query: 0, take: 40 }],
  },
  {
    key: 'codegen',
    name: 'Code generation with large language models',
    question:
      'How well do large language models generate, repair and reason about code, and how are they applied and evaluated in software engineering?',
    inclusion: ['Large language models for code generation, program synthesis or software engineering tasks'],
    relevant: (title) =>
      /\bcode|coding|program|software/iu.test(title) && !/^Empirical Standards for Software/iu.test(title),
    picks: [{ query: 0, take: 40 }],
  },
  {
    key: 'diffusion',
    name: 'Diffusion models for image generation',
    question:
      'How do diffusion and score-based generative models synthesise and edit images, and how do they compare with other generative models?',
    inclusion: ['Diffusion or score-based generative models for image generation, synthesis or editing'],
    relevant: (title) => /diffusion|score-based/iu.test(title) && !/audio/iu.test(title),
    picks: [{ query: 0, take: 40 }],
  },
];

const subfield = (work: Work) => {
  const id = work.primary_topic?.subfield?.id?.split('/').pop();
  return id && /^\d+$/u.test(id) ? `subfields/${id}` : undefined;
};
const workKey = (work: Work) => (work.doi ?? work.id).toLowerCase();

function select(topic: Topic, requests: Request[]) {
  const chosen = new Map<string, Work>();
  const titles = new Set<string>();
  for (const { query, take } of topic.picks) {
    const request = requests[query];
    if (!request) throw new Error(`${topic.key}: query ${query} missing`);
    let taken = 0;
    for (const work of request.results) {
      if (taken >= take || chosen.size >= (topic.cap ?? Infinity)) break;
      const title = `${normalTitle(work.display_name)}|${work.publication_year}`;
      if (chosen.has(workKey(work)) || titles.has(title) || !topic.relevant(work.display_name)) continue;
      chosen.set(workKey(work), work);
      titles.add(title);
      taken++;
    }
  }
  return chosen;
}

function build(topic: Topic, requests: Request[]) {
  const chosen = select(topic, requests);
  const works = [...chosen.values()];
  const years = works.map((work) => work.publication_year);
  const [from, to] = [Math.min(...years), Math.max(...years)];
  const createdAt = requests[0]!.runAt;
  let corpus: Corpus = newCorpus({
    id: crypto.randomUUID(),
    kind: 'topic',
    title: `CS · ${topic.name} (OA, ${from}–${to})`,
    createdAt,
    protocol: [
      {
        version: 1,
        createdAt,
        body: {
          researchQuestion: `${topic.question} ${PROVENANCE}`,
          inclusion: [...topic.inclusion, ...COMMON_INCLUSION, PROVENANCE],
          exclusion: COMMON_EXCLUSION,
          years: Array.from({ length: to - from + 1 }, (_, i) => from + i),
        },
      },
    ],
  });
  for (const request of requests) {
    // Every chosen work this request returned: the first request to return a work adds it, later ones count it
    // as a duplicate.
    const records = request.results.filter((work) => chosen.has(workKey(work)));
    const candidates = records.flatMap((work) => candidateFromWork(work, request.url) ?? []);
    corpus = recordSearch(
      corpus,
      candidates,
      {
        requestUrl: request.url,
        totalReported: request.total,
        retrieved: candidates.length,
        truncated: true,
      },
      request.runAt,
    );
  }
  const byOpenAlex = new Map(works.map((work) => [work.id.split('/').pop()!.toUpperCase(), work]));
  corpus = {
    ...corpus,
    members: corpus.members.map((member) => {
      const work = byOpenAlex.get(member.identifiers.openalexId ?? '');
      const subfieldId = work && subfield(work);
      return {
        ...member,
        role: 'build' as const,
        ...(work ? { citedByCount: work.cited_by_count } : {}),
        ...(subfieldId ? { subfieldId } : {}),
      };
    }),
  };
  const parsed = CorpusSchema.parse(corpus);
  if (parsed.pendingConfirmations?.length) throw new Error(`${topic.key}: pending title-year matches`);
  if (parsed.members.length !== chosen.size) throw new Error(`${topic.key}: member count mismatch`);
  if (parsed.members.some((member) => member.decisions.length)) throw new Error(`${topic.key}: decisions`);
  return parsed;
}

const [rawPath, outDir] = process.argv.slice(2);
if (!rawPath || !outDir) throw new Error('usage: csCorpora.ts <raw.json> <outDir>');
const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as Record<string, Request[]>;
mkdirSync(outDir, { recursive: true });
const summary = TOPICS.map((topic) => {
  const corpus = build(topic, raw[topic.key] ?? []);
  writeFileSync(join(outDir, `${corpus.id}.json`), JSON.stringify(corpus));
  const years = corpus.members.flatMap((member) => member.stratum.year ?? []);
  return {
    key: topic.key,
    id: corpus.id,
    title: corpus.title,
    kind: corpus.kind,
    updatedAt: corpus.updatedAt,
    members: corpus.members.length,
    years: [Math.min(...years), Math.max(...years)],
    searches: corpus.searches.map((search) =>
      'requestUrl' in search
        ? { url: search.requestUrl, runAt: search.runAt, total: search.totalReported, added: search.added }
        : search,
    ),
    openalexIds: corpus.members.map((member) => member.identifiers.openalexId),
    titles: corpus.members.map((member) => `${member.stratum.year} ${member.title ?? ''}`),
  };
});
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
for (const item of summary) console.log(item.key, item.id, item.members, item.years.join('–'), item.title);
