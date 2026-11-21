import type { StageContent } from '@/core/autoresearch/contracts';
import type { LiteratureProvider } from '@/core/autoresearch/stage-fields';
import { searchQueries } from '@/core/autoresearch/validation';
import { latestDecision } from '@/core/corpus/screening';
import { candidateFromWork } from '@/core/extraction';
import { normalizeDoi } from '@/core/library/doi';
import { paperId } from '@/core/schemas/labKg';
import type { Candidate, Corpus, ExtractionProject } from '@/core/schemas';
import type { SciAtlasPaper } from '@/core/openkg';
import { LabKgError, searchLabKg } from '@/shared/labKg/client';
import type { ScholarClient } from '@/shared/scholar/client';
import { doiUrl, mergeRecords, type Entry, type Query, type RecordEntry } from './candidate-merge';

type CollectionSource = NonNullable<StageContent['S4']['meta']>['sources'][number];
const RESULTS_PER_QUERY = 10;

function localEntries(project: ExtractionProject, corpus: Corpus | undefined, queries: Query[]): Entry[] {
  const members = (corpus?.members ?? []).map((member): Entry => {
    const doi = member.identifiers.doi ?? null;
    const decision = latestDecision(member, 'full-text') ?? latestDecision(member, 'title-abstract');
    return {
      title: member.title?.trim() || doi || '',
      doi,
      openalexId: member.identifiers.openalexId,
      year: member.stratum.year ?? null,
      citations: member.citedByCount,
      abstract: null,
      source: { kind: 'corpus', ref: member.memberId },
      decision: decision
        ? {
            decision: ({ include: 'included', exclude: 'excluded', uncertain: 'uncertain' } as const)[
              decision.decision
            ],
            reason:
              decision.reasonText.trim() ||
              decision.reasonCode.trim() ||
              'Existing screening decision; no reason saved.',
          }
        : null,
    };
  });
  const harvested = [project.deep, corpus?.deep].flatMap((harvest) =>
    (harvest?.candidates ?? []).map((candidate): Entry => {
      const pastQueries = harvest?.rounds.filter(
        (round) => round.kind === 'query' && candidate.foundBy.includes(round.id),
      );
      return {
        ...candidate,
        citations: candidate.citedBy,
        source: { kind: 'harvest', ref: candidate.key },
        queryIds: queries
          .filter(
            (q) =>
              pastQueries?.some((round) => round.input.trim() === q.query) ||
              candidate.foundBy.includes(q.query),
          )
          .map((q) => q.id),
        decision:
          candidate.status === 'candidate'
            ? null
            : {
                decision: candidate.status,
                reason: candidate.reason?.trim() || 'Existing human screening decision; no reason saved.',
              },
      };
    }),
  );
  return [
    ...members,
    ...harvested,
    ...project.papers.map((paper): Entry => ({
      ...paper,
      source: { kind: 'project', ref: paper.key },
    })),
  ];
}

type CollectionDeps = {
  project: ExtractionProject;
  corpus: () => Promise<Corpus | undefined>;
  localAbstract: (paperIds: string[]) => Promise<{ text: string; paperId: string } | null>;
  scholar: ScholarClient;
  getLabToken?: () => Promise<string | null>;
  check: () => void;
  now: () => string;
  signal?: AbortSignal;
};

function kgEntry(item: SciAtlasPaper, queryId: string): Entry {
  return {
    ...item,
    doi: normalizeDoi(item.doi ?? item.id ?? ''),
    openalexId: paperId(item.openalexId ?? item.id),
    abstract: item.abstract ?? null,
    source: { kind: 'lab_kg', ref: item.id?.trim() || item.doi || item.title },
    queryIds: [queryId],
  };
}

function openAlexEntry(item: Candidate, queryId: string): Entry {
  return {
    ...item,
    citations: item.citedBy,
    source: { kind: 'openalex', ref: item.openalexId ?? item.key },
    queryIds: [queryId],
  };
}

export async function collectCandidates(
  plan: StageContent['S3'],
  deps: CollectionDeps,
): Promise<StageContent['S4']> {
  const { check, now, signal, scholar } = deps;
  const queries = searchQueries(plan);
  const { from, to } = plan.yearFilter;
  const records: RecordEntry[] = [];
  const sources: CollectionSource[] = [];
  const add = (provider: LiteratureProvider, entries: Entry[]) => {
    const retrievedAt = now();
    records.push(
      ...entries.filter((entry) => entry.title.trim()).map((entry) => ({ entry, provider, retrievedAt })),
    );
  };
  const search = async (provider: 'lab_kg' | 'openalex', lookup: (q: Query) => Promise<Entry[]>) => {
    const source: CollectionSource = { provider, status: 'empty', errors: [] };
    sources.push(source);
    const start = records.length;
    for (const query of queries) {
      check();
      try {
        add(provider, await lookup(query));
      } catch (cause) {
        check();
        const unconfigured = cause instanceof LabKgError && cause.detail.includes('kg_not_configured');
        source.errors.push({
          queryId: query.id,
          message: unconfigured ? 'kg_not_configured' : 'search_failed',
        });
        if (unconfigured) {
          source.status = 'not_configured';
          break;
        }
      }
    }
    if (records.length > start) source.status = 'retrieved';
    else if (source.errors.length && source.status !== 'not_configured') source.status = 'unavailable';
  };
  let token: string | null = null;
  check();
  try {
    token = (await deps.getLabToken?.()) ?? null;
  } catch {
    check();
    sources.push({
      provider: 'lab_kg',
      status: 'unavailable',
      errors: [{ queryId: null, message: 'token_unavailable' }],
    });
  }
  if (token) {
    const labToken = token;
    await search('lab_kg', async (q) => {
      const { papers } = await searchLabKg(
        {
          query: q.query.slice(0, 2000),
          keywords: [{ text: q.query.slice(0, 200).trim(), level: 'high' }],
          after: from ? `${from}-01-01` : undefined,
          before: to ? `${to}-12-31` : undefined,
          topK: RESULTS_PER_QUERY,
        },
        labToken,
        signal,
      );
      return papers.map((paper) => kgEntry(paper, q.id));
    });
  } else if (!sources.length) {
    sources.push({ provider: 'lab_kg', status: 'not_configured', errors: [] });
  }
  await search('openalex', async (q) => {
    const { results } = await scholar.searchWorks(
      q.query,
      { fromYear: from, toYear: to, perPage: RESULTS_PER_QUERY },
      signal,
    );
    return results.flatMap((work) => {
      const candidate = candidateFromWork(work, q.id);
      return candidate ? [openAlexEntry(candidate, q.id)] : [];
    });
  });
  check();
  const corpusSource: CollectionSource = { provider: 'corpus', status: 'empty', errors: [] };
  sources.push(corpusSource);
  let corpus: Corpus | undefined;
  try {
    corpus = await deps.corpus();
  } catch {
    check();
    corpusSource.status = 'unavailable';
    corpusSource.errors.push({ queryId: null, message: 'corpus_read_failed' });
  }
  const local = localEntries(deps.project, corpus, queries).filter((entry) => entry.title.trim());
  if (local.length) corpusSource.status = 'retrieved';
  add('corpus', local);

  const candidates = mergeRecords(records, queries);
  const localPaperIds = new Map(
    corpus?.members.map((member) => [member.memberId, member.identifiers.paperIds]),
  );
  for (const paper of deps.project.papers)
    if (paper.source.kind === 'paper') localPaperIds.set(paper.key, [paper.source.paperId]);
  for (const candidate of candidates.filter(({ abstract }) => !abstract)) {
    const ids = [...new Set(candidate.sources.flatMap(({ ref }) => localPaperIds.get(ref) ?? []))];
    if (!ids.length) continue;
    check();
    try {
      const abstract = await deps.localAbstract(ids);
      if (abstract) {
        candidate.abstract = abstract.text;
        candidate.sources.push({ kind: 'local_abstract', ref: abstract.paperId });
        candidate.source_records?.push({
          provider: 'corpus',
          sourceId: abstract.paperId,
          url: null,
          retrievedAt: now(),
        });
      }
    } catch {
      check();
      if (!corpusSource.errors.some(({ message }) => message === 'abstract_read_failed'))
        corpusSource.errors.push({ queryId: null, message: 'abstract_read_failed' });
    }
  }
  // Project records can be metadata-only even when no search returned the DOI.
  const openAlex = sources.find(({ provider }) => provider === 'openalex');
  const missing = candidates.filter(
    ({ abstract, doi, sources }) =>
      !abstract &&
      doi &&
      sources.some(({ kind }) => kind === 'corpus' || kind === 'project' || kind === 'harvest'),
  );
  for (let start = 0; start < missing.length; start += 4) {
    const batch = await Promise.all(
      missing.slice(start, start + 4).map(async (paper) => {
        check();
        if (!paper.doi) return true;
        try {
          const abstract = (await scholar.workAbstract(paper.doi, signal))?.trim();
          if (abstract) {
            paper.abstract = abstract;
            paper.sources.push({ kind: 'openalex_abstract', ref: paper.doi });
            const refs = paper.source_records ?? [];
            const position = refs.findIndex(({ provider }) => provider === 'corpus');
            refs.splice(position < 0 ? refs.length : position, 0, {
              provider: 'openalex',
              sourceId: paper.doi,
              url: doiUrl(paper.doi, null),
              retrievedAt: now(),
            });
          }
          return true;
        } catch {
          check();
          return false;
        }
      }),
    );
    if (batch.includes(false)) {
      openAlex?.errors.push({ queryId: null, message: 'abstract_lookup_failed' });
      break;
    }
  }
  return { candidates, meta: { sources } };
}
