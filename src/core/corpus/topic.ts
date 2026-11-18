import { emptyDeep, mergeCandidates, papersFromCandidates } from '../extraction/deep';
import type { Candidate, Corpus, ExtractionProject } from '../schemas';
import { newCorpus } from './index';
import { addMember, intakeRecords } from './intake';
import { normalTitle } from '../text/normalizeTitle';
import { latestDecision } from './screening';

export function recordTopicSearch(
  corpus: Corpus,
  candidates: Candidate[],
  requestUrl: string,
  totalReported: number,
  retrieved: number,
  at: string,
): Corpus {
  return recordSearch(
    corpus,
    candidates,
    { requestUrl, totalReported, retrieved, truncated: totalReported > retrieved },
    at,
  );
}

export type SearchRecord = {
  /** `openalex` for a query; `snowball-backward` / `snowball-forward` for citation searching. */
  source?: string;
  requestUrl: string;
  requestUrls?: string[];
  totalReported: number;
  retrieved: number;
  truncated: boolean;
  updateRound?: number;
  seeds?: string[];
  snowballRound?: number;
};

/** One search entry: its records go through intake, and the entry keeps the members it added. */
export function recordSearch(
  corpus: Corpus,
  candidates: Candidate[],
  record: SearchRecord,
  at: string,
): Corpus {
  const deep = corpus.deep ?? emptyDeep();
  const merged = mergeCandidates(deep.candidates, candidates);
  const source = record.source ?? 'openalex';
  const updateRound = record.updateRound ?? 0;
  const {
    corpus: result,
    added,
    duplicates,
    memberIds,
  } = intakeRecords(corpus, candidates, at, { source, updateRound });
  const url = new URL(record.requestUrl);
  return {
    ...result,
    deep: { ...deep, candidates: merged.candidates },
    searches: [
      ...result.searches,
      {
        source,
        requestUrl: record.requestUrl,
        params: Object.fromEntries(url.searchParams),
        runAt: at,
        totalReported: record.totalReported,
        retrieved: record.retrieved,
        duplicates,
        added,
        truncated: record.truncated,
        updateRound,
        ...(record.requestUrls ? { requestUrls: record.requestUrls } : {}),
        ...(record.seeds ? { seeds: record.seeds } : {}),
        ...(record.snowballRound ? { snowballRound: record.snowballRound } : {}),
        memberIds,
      },
    ],
  };
}

export function promoteProject(project: ExtractionProject, id: string, at: string): Corpus {
  const deep = project.deep ?? emptyDeep();
  let corpus = newCorpus({
    id,
    kind: 'topic',
    title: project.title,
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: {
          researchQuestion: project.researchQuestion,
          inclusion: deep.plan?.inclusion ?? [],
          exclusion: deep.plan?.exclusion ?? [],
          years: [],
        },
      },
    ],
  });
  for (const candidate of deep.candidates) {
    const intake = addMember(corpus, candidate, at);
    corpus = intake.corpus;
    if ('memberId' in intake && candidate.status !== 'candidate') {
      const decision =
        candidate.status === 'included'
          ? 'include'
          : candidate.status === 'excluded'
            ? 'exclude'
            : 'uncertain';
      corpus = {
        ...corpus,
        members: corpus.members.map((member) =>
          member.memberId === intake.memberId
            ? {
                ...member,
                decisions: [
                  ...member.decisions,
                  {
                    stage: 'title-abstract',
                    decision,
                    reasonCode: 'other',
                    reasonText: candidate.reason ?? '',
                    decider: { kind: 'person' },
                    // A triage bucket the person applied stays visible in the audit trail.
                    ...(candidate.decidedBy === 'ai_accepted' && candidate.suggestion
                      ? { acceptedSuggestion: { decision, reason: candidate.suggestion.reason } }
                      : {}),
                    at: candidate.decidedAt ?? at,
                  },
                ],
              }
            : member,
        ),
      };
    }
  }
  return { ...corpus, deep };
}

export function linkTopic(project: ExtractionProject, corpus: Corpus): ExtractionProject {
  const candidates = (corpus.deep?.candidates ?? []).map((candidate) => {
    const member = corpus.members.find(
      (item) =>
        (candidate.doi && item.identifiers.doi === candidate.doi) ||
        (candidate.openalexId && item.identifiers.openalexId === candidate.openalexId) ||
        (item.title &&
          candidate.year !== null &&
          item.stratum.year === candidate.year &&
          normalTitle(item.title) === normalTitle(candidate.title)),
    );
    const decision = member && latestDecision(member, 'full-text');
    return {
      ...candidate,
      status: decision
        ? decision.decision === 'include'
          ? ('included' as const)
          : decision.decision === 'exclude'
            ? ('excluded' as const)
            : ('uncertain' as const)
        : ('candidate' as const),
    };
  });
  const existing = new Set(project.papers.map((paper) => paper.key));
  const represented = new Set(
    candidates.flatMap((candidate) => [candidate.doi, candidate.openalexId].filter(Boolean)),
  );
  const manual = corpus.members
    .filter((member) => {
      const decision = latestDecision(member, 'full-text');
      return (
        decision?.decision === 'include' &&
        ![member.identifiers.doi, member.identifiers.openalexId].some((id) => id && represented.has(id)) &&
        !candidates.some(
          (candidate) =>
            member.title &&
            candidate.year !== null &&
            candidate.year === member.stratum.year &&
            normalTitle(candidate.title) === normalTitle(member.title),
        )
      );
    })
    .map((member) => ({
      key: `corpus:${member.memberId}`,
      source: { kind: 'search' as const, candidateKey: `corpus:${member.memberId}` },
      title: member.title ?? member.identifiers.doi ?? member.exportId,
      authors: [],
      year: member.stratum.year ?? null,
      venue: null,
      doi: member.identifiers.doi ?? null,
      access: 'METADATA_ONLY' as const,
      abstract: null,
      revision: 'metadata',
      screening: 'included' as const,
    }));
  return {
    ...project,
    corpusId: corpus.id,
    papers: [
      ...project.papers,
      ...[...papersFromCandidates(candidates), ...manual].filter(
        (paper) =>
          !existing.has(paper.key) && !project.papers.some((old) => paper.doi && old.doi === paper.doi),
      ),
    ],
  };
}
