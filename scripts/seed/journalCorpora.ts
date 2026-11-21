import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  admiredQuotas,
  samplingRuleText,
  selectAdmired,
  selectAdmiredControl,
} from '../../src/core/corpus/admired';
import { newCorpus } from '../../src/core/corpus/index';
import {
  addJournalSample,
  admiredControlQuotas,
  admiredHarvestLimit,
  JournalWorkSchema,
} from '../../src/core/corpus/journalHarvest';
import { harvestPageUrl, harvestQuery, type Work } from '../../src/core/corpus/sampling';
import { recordSearch } from '../../src/core/corpus/topic';
import { candidateFromWork } from '../../src/core/extraction/deep';
import { CorpusSchema, type Corpus, type CorpusSampling } from '../../src/core/schemas/corpus';
import { openAlexSnapshot } from './fetchJournalOpenAlex';

const YEARS = [2021, 2022, 2023, 2024, 2025];
const SAMPLING = {
  scope: 'admired',
  n: 50,
  rankedBy: 'cited_by_count within publication year',
} satisfies CorpusSampling;
const PAIRS = [
  {
    source: 'S2480266640',
    targetId: 'd076ad26-8222-4385-aee4-ffbfefef4543',
    controlId: 'ca212a61-f793-4c24-a80b-3fe311a3777c',
    peers: ['S184777250', 'S4210174276', 'S2484352698'],
  },
  {
    source: 'S69141925',
    targetId: '0dd52a4c-e634-4288-b83c-cd3915aaf463',
    controlId: 'ad02427c-95e8-4b47-8b8c-c9fbdbaab04b',
    peers: ['S63392143', 'S173527311', 'S10936095'],
  },
  {
    source: 'S97130795',
    targetId: '638d5e0b-d051-427a-90fe-c1d44e0b1b4b',
    controlId: 'c09e06c1-a60c-4d28-9329-2a0c344807e9',
    peers: ['S186357190', 'S32326811', 'S106148199'],
  },
  {
    source: 'S186357190',
    targetId: '001f76b5-aeac-4928-8c2a-1f8816732bce',
    controlId: '09f28aed-a9c0-4bd2-a809-2fda98730c34',
    peers: ['S106148199', 'S32326811', 'S63392143'],
  },
  {
    source: 'S4210202420',
    targetId: 'c756b38f-133a-48a1-b21f-e1ffc0adf27e',
    controlId: '5a7f3607-9fb7-4780-8510-72beb4f511a4',
    peers: ['S2484188435', 'S186584794', 'S10936095'],
  },
];

const count = z.number().int().nonnegative();
const scanSchema = z.object({
  sources: z.array(z.object({ id: z.string(), name: z.string(), issn: z.array(z.string()).nullish() })),
});
const sourceSchema = z.object({ display_name: z.string(), issn: z.array(z.string()).min(1) });
const pageSchema = z.object({
  meta: z.object({ count, next_cursor: z.string().nullable() }),
  results: z.array(z.unknown()),
});
const oaSchema = z.object({
  open_access: z.object({ oa_status: z.enum(['gold', 'diamond', 'hybrid', 'bronze']) }),
});

type Request = {
  url: string;
  urls: string[];
  runAt: string;
  total: number;
  records: { work: Work; raw: unknown }[];
  invalid: number;
};
type Venue = { name: string; issn: string[]; openalexSourceId: string };
type ReadOpenAlex = ReturnType<typeof openAlexSnapshot>;

async function harvest(read: ReadOpenAlex, venue: Venue, year: number, limit: number) {
  const url = harvestQuery({ sourceId: venue.openalexSourceId, years: [year], sort: 'cited_by_count:desc' });
  const request: Request = { url, urls: [], runAt: '', total: 0, records: [], invalid: 0 };
  let cursor: string | null = '*';
  let count = 0;
  while (cursor && count < limit) {
    const pageUrl = harvestPageUrl(url, cursor);
    const rawPage = await read(pageUrl);
    const page = pageSchema.parse(rawPage.body);
    request.urls.push(pageUrl);
    if (count === 0) {
      request.runAt = rawPage.runAt;
      request.total = page.meta.count;
    }
    for (const raw of page.results.slice(0, limit - count)) {
      const parsed = JournalWorkSchema.safeParse(raw);
      if (parsed.success) request.records.push({ work: parsed.data, raw });
      else request.invalid++;
    }
    count += page.results.length;
    cursor = page.results.length ? page.meta.next_cursor : null;
  }
  return request;
}

async function build(
  read: ReadOpenAlex,
  input: { id: string; title: string; venues: Venue[]; target?: Corpus },
) {
  const { id, title, venues, target } = input;
  const quotas = target
    ? admiredControlQuotas(target, YEARS)
    : admiredQuotas({ n: SAMPLING.n, years: YEARS });
  const requests: Request[] = [];
  for (const venue of venues) {
    for (const [year, quota] of quotas) {
      const limit = admiredHarvestLimit(quota, target ? venues.length : 1);
      if (limit) requests.push(await harvest(read, venue, year, limit));
    }
  }
  const times = requests.map(({ runAt }) => runAt).sort();
  const createdAt = times[0];
  const updatedAt = times.at(-1);
  if (!createdAt || !updatedAt) throw new Error(`${title}: no harvest requests`);
  const members = requests.flatMap(({ records }) => records.map(({ work }) => work));
  const result = target
    ? selectAdmiredControl({ members, targetPerYear: quotas, venues: venues.map((v) => v.openalexSourceId) })
    : selectAdmired({ members, n: SAMPLING.n, years: YEARS });

  let corpus = newCorpus({
    id,
    title,
    kind: target ? 'control' : 'journal',
    createdAt,
    protocol: [
      {
        version: 1,
        createdAt,
        body: {
          venues,
          years: YEARS,
          articleTypes: ['article'],
          versionOfRecordOnly: true,
          ...(target ? {} : { sampling: SAMPLING }),
          samplingRule: target ? `match:${target.id}` : samplingRuleText(SAMPLING),
          seed: `paperlab-fl-journals-${id}`,
          strata: ['publication year'],
          capPerIssue: null,
          exclusions: ['retracted', 'editorial', 'errata', 'correction', 'missing DOI'],
        },
      },
    ],
  });

  const selected = new Set(result.sample.map(({ work }) => work));
  const oaStatuses: Record<string, number> = {};
  for (const request of requests) {
    // As with the topic seeds, the search credits only works that passed selection.
    const candidates = request.records.flatMap(({ work, raw }) => {
      if (!selected.has(work)) return [];
      const { open_access } = oaSchema.parse(raw);
      oaStatuses[open_access.oa_status] = (oaStatuses[open_access.oa_status] ?? 0) + 1;
      const candidate = candidateFromWork(raw, request.url);
      if (!candidate) throw new Error(`${title}: selected work has no search candidate: ${work.id}`);
      return [candidate];
    });
    corpus = recordSearch(
      corpus,
      candidates,
      {
        requestUrl: request.url,
        requestUrls: request.urls,
        totalReported: request.total,
        retrieved: candidates.length,
        truncated: request.total > candidates.length,
      },
      request.runAt,
    );
  }
  if (corpus.pendingConfirmations?.length || corpus.members.length !== selected.size)
    throw new Error(`${title}: selected works do not map one-to-one to corpus members`);
  corpus = CorpusSchema.parse(
    addJournalSample(
      corpus,
      result.sample.map(({ work }) => ({ work, role: 'build' })),
      updatedAt,
    ),
  );
  const invalid = requests.reduce((sum, request) => sum + request.invalid, 0);
  return {
    corpus,
    summary: {
      id,
      title,
      kind: corpus.kind,
      targetId: target?.id,
      members: corpus.members.length,
      years: result.report.years,
      exclusions: { ...result.report.exclusions, ...(invalid ? { invalid_record: invalid } : {}) },
      oaShare: selected.size ? 1 : null,
      oaStatuses,
      firstRequestAt: createdAt,
      lastRequestAt: updatedAt,
    },
  };
}

export async function runJournalCorpora(args: string[]) {
  const [mode, scanPath, rawDir, outDir] = args;
  if ((mode !== 'fetch' && mode !== 'build') || !scanPath || !rawDir || (mode === 'build' && !outDir)) {
    throw new Error(
      'usage: journalCorpora.mjs fetch <scan.json> <rawDir> | build <scan.json> <rawDir> <outDir>',
    );
  }
  const scan = scanSchema.parse(JSON.parse(readFileSync(scanPath, 'utf8')));
  const read = openAlexSnapshot(rawDir, mode === 'fetch');
  const venues = new Map<string, Venue>();
  for (const { source, peers } of PAIRS) {
    for (const id of [source, ...peers]) {
      if (venues.has(id)) continue;
      const scanned = scan.sources.find((row) => row.id === id);
      if (scanned?.issn?.length)
        venues.set(id, { name: scanned.name, issn: scanned.issn, openalexSourceId: id });
      else {
        const raw = await read(`https://api.openalex.org/sources/${id}`);
        const source = sourceSchema.parse(raw.body);
        venues.set(id, {
          name: scanned?.name ?? source.display_name,
          issn: source.issn,
          openalexSourceId: id,
        });
      }
    }
  }
  const venue = (id: string) => {
    const found = venues.get(id);
    if (!found) throw new Error(`Missing venue: ${id}`);
    return found;
  };
  const outputs: Awaited<ReturnType<typeof build>>[] = [];
  for (const pair of PAIRS) {
    const journal = venue(pair.source);
    const target = await build(read, { id: pair.targetId, title: journal.name, venues: [journal] });
    if (!target.corpus.members.length) throw new Error(`${journal.name}: the app requires a sampled target`);
    const control = await build(read, {
      id: pair.controlId,
      title: `${journal.name} đối chứng`,
      venues: pair.peers.map(venue),
      target: target.corpus,
    });
    outputs.push(target, control);
  }
  if (mode === 'build' && outDir) {
    mkdirSync(outDir, { recursive: true });
    for (const { corpus } of outputs)
      writeFileSync(join(outDir, `${corpus.id}.json`), JSON.stringify(corpus));
    const summary = outputs.map((item) => item.summary);
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  }
}
