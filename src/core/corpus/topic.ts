import { emptyDeep, mergeCandidates, papersFromCandidates } from '../extraction/deep';
import type { Candidate, Corpus, ExtractionProject } from '../schemas';
import { newCorpus } from './index';
import { addMember } from './intake';
import { normalTitle } from '../text/normalizeTitle';

export function recordTopicSearch(
  corpus: Corpus,
  candidates: Candidate[],
  requestUrl: string,
  totalReported: number,
  retrieved: number,
  at: string,
): Corpus {
  const deep = corpus.deep ?? emptyDeep();
  const merged = mergeCandidates(deep.candidates, candidates);
  let result = corpus;
  let added = 0;
  let duplicates = 0;
  for (const candidate of candidates) {
    const intake = addMember(result, candidate, at);
    result = intake.corpus;
    if (intake.matched === 'new') added++;
    if (intake.matched === 'identifier') duplicates++;
    if (intake.matched === 'title-year') {
      result = {
        ...result,
        pendingConfirmations: [
          ...(result.pendingConfirmations ?? []),
          { id: crypto.randomUUID(), candidate: intake.candidate, input: candidate },
        ],
      };
    }
  }
  const url = new URL(requestUrl);
  return {
    ...result,
    deep: { ...deep, candidates: merged.candidates },
    searches: [
      ...result.searches,
      {
        source: 'openalex',
        requestUrl,
        params: Object.fromEntries(url.searchParams),
        runAt: at,
        totalReported,
        retrieved,
        duplicates,
        added,
        truncated: totalReported > retrieved,
        updateRound: 0,
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
    const decision = member?.decisions.filter((item) => item.decider.kind === 'person').at(-1);
    return {
      ...candidate,
      status: decision
        ? decision.decision === 'include'
          ? ('included' as const)
          : decision.decision === 'exclude'
            ? ('excluded' as const)
            : ('uncertain' as const)
        : candidate.status,
    };
  });
  const existing = new Set(project.papers.map((paper) => paper.key));
  const represented = new Set(
    candidates.flatMap((candidate) => [candidate.doi, candidate.openalexId].filter(Boolean)),
  );
  const manual = corpus.members
    .filter((member) => {
      const decision = member.decisions.filter((item) => item.decider.kind === 'person').at(-1);
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
