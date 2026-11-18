import type { ResearchCandidate, StageContent } from '@/core/autoresearch/contracts';
import { searchQueries } from '@/core/autoresearch/validation';
import { latestDecision } from '@/core/corpus/screening';
import { normalizeDoi } from '@/core/library/doi';
import { normalTitle } from '@/core/text/normalizeTitle';
import type { Candidate, Corpus, ExtractionProject } from '@/core/schemas';
import type { SearchRound } from '@/core/schemas/deepResearch';

export function collectCandidates(
  project: ExtractionProject,
  corpus: Corpus | undefined,
  plan: StageContent['S3'],
) {
  const queries = searchQueries(plan);
  const pool: ResearchCandidate[] = [];
  const add = (entry: {
    title: string;
    doi: string | null;
    year: number | null;
    abstract: string | null;
    source: ResearchCandidate['sources'][number];
    queryIds?: string[];
    decision?: ResearchCandidate['existingDecision'];
  }) => {
    const doi = entry.doi ? normalizeDoi(entry.doi) : null;
    const title = entry.title.trim();
    if (!title) return;
    const normalized = normalTitle(title);
    const arxiv = entry.source.ref.match(/(?:arxiv:|arxiv\.org\/abs\/)([\w./-]+)/iu)?.[1];
    const titleId = `title:${normalized || title.toLowerCase()}${entry.year === null ? '' : `:${entry.year}`}`;
    const id = doi ?? (arxiv ? `arxiv:${arxiv}` : titleId);
    const existing = pool.find(
      (paper) =>
        paper.id === id ||
        ((!doi || !paper.doi) && normalTitle(paper.title) === normalized && paper.year === entry.year),
    );
    const matched = entry.queryIds ?? [];
    if (existing) {
      existing.sources.push(entry.source);
      existing.abstract ??= entry.abstract?.trim() || null;
      existing.year ??= entry.year;
      existing.existingDecision ??= entry.decision ?? null;
      if (doi && existing.doi === null) {
        existing.doi = doi;
        existing.id = doi;
      }
      if (matched.length) {
        existing.queryIds =
          existing.queryLink === 'matched_harvest'
            ? [...new Set([...existing.queryIds, ...matched])]
            : matched;
        existing.queryLink = 'matched_harvest';
      }
      return;
    }
    pool.push({
      id,
      doi,
      title,
      year: entry.year,
      abstract: entry.abstract?.trim() || null,
      citationKey: `P${pool.length + 1}`,
      sources: [entry.source],
      queryIds: matched.length ? matched : queries.map((q) => q.id),
      queryLink: matched.length ? 'matched_harvest' : 'pool_context',
      existingDecision: entry.decision ?? null,
    });
  };
  const fromHarvest = (candidate: Candidate, rounds: SearchRound[]) => {
    const pastQueries = rounds.filter(
      (round) => round.kind === 'query' && candidate.foundBy.includes(round.id),
    );
    const queryIds = queries
      .filter(
        (q) =>
          pastQueries.some((round) => round.input.trim() === q.query.trim()) ||
          candidate.foundBy.includes(q.query),
      )
      .map((q) => q.id);
    add({
      ...candidate,
      source: { kind: 'harvest', ref: candidate.key },
      queryIds,
      decision:
        candidate.status === 'candidate'
          ? null
          : {
              decision: candidate.status,
              reason: candidate.reason?.trim() || 'Existing human screening decision; no reason saved.',
            },
    });
  };
  const harvests = [project.deep, corpus?.deep];
  for (const harvest of harvests) {
    if (harvest) harvest.candidates.forEach((candidate) => fromHarvest(candidate, harvest.rounds));
  }
  for (const member of corpus?.members ?? []) {
    const doi = member.identifiers.doi ?? null;
    const decision = latestDecision(member, 'full-text') ?? latestDecision(member, 'title-abstract');
    add({
      title: member.title ?? doi ?? '',
      doi,
      year: member.stratum.year ?? null,
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
              'Existing human screening decision; no reason saved.',
          }
        : null,
    });
  }
  for (const paper of project.papers) {
    add({ ...paper, source: { kind: 'project', ref: paper.key } });
  }
  return { candidates: pool };
}
