import { csvCell } from '../extraction';
import type { Corpus } from '../schemas';
import { SCREENING_REASON_CODES, latestDecision, reasonCodeOf, type ScreeningReasonCode } from './screening';

export type PrismaSource = {
  source: string;
  kind: 'database' | 'import';
  totalReported: number;
  retrieved: number;
  /** The search stopped before the total it reported, so the source was not searched exhaustively. */
  notExhaustive: boolean;
};

/**
 * PRISMA 2020 flow counts. Every box equals its parent minus its siblings:
 * members = identified − duplicatesRemoved − awaitingDuplicateCheck + recordsOutsideSearches
 * members = recordsScreened + awaitingScreening
 * recordsScreened = excludedTitleAbstract + uncertainTitleAbstract + reportsSought
 * reportsSought = reportsNotRetrieved + awaitingFullText + reportsAssessed
 * reportsAssessed = reportsExcluded + uncertainFullText + studiesIncluded
 */
export type PrismaCounts = {
  sources: PrismaSource[];
  identified: number;
  identifiedOtherMethods: number;
  duplicatesRemoved: number;
  awaitingDuplicateCheck: number;
  /** Members added without a recorded search (Library, DOI list, promoted projects); negative means members left. */
  recordsOutsideSearches: number;
  members: number;
  recordsScreened: number;
  awaitingScreening: number;
  excludedTitleAbstract: number;
  uncertainTitleAbstract: number;
  reportsSought: number;
  reportsNotRetrieved: number;
  awaitingFullText: number;
  reportsAssessed: number;
  reportsExcluded: number;
  reportsExcludedByReason: Record<ScreeningReasonCode, number>;
  uncertainFullText: number;
  studiesIncluded: number;
};

export function prismaCounts(corpus: Corpus): PrismaCounts {
  const sources: PrismaSource[] = corpus.searches.map((search) =>
    'requestUrl' in search
      ? {
          source: search.source,
          kind: 'database',
          totalReported: search.totalReported,
          retrieved: search.retrieved,
          notExhaustive: search.truncated,
        }
      : {
          source: search.fileName,
          kind: 'import',
          totalReported: search.records,
          retrieved: search.records,
          notExhaustive: false,
        },
  );
  const identified = sources.reduce((sum, source) => sum + source.retrieved, 0);
  // Confirmed title-year matches are merged into an existing member and logged as an alias.
  const duplicatesRemoved =
    corpus.searches.reduce((sum, search) => sum + (search.duplicates ?? 0), 0) + corpus.aliases.length;
  const awaitingDuplicateCheck = corpus.pendingConfirmations?.length ?? 0;
  const members = corpus.members.length;
  const counts = {
    recordsScreened: 0,
    excludedTitleAbstract: 0,
    uncertainTitleAbstract: 0,
    reportsSought: 0,
    reportsNotRetrieved: 0,
    awaitingFullText: 0,
    reportsAssessed: 0,
    reportsExcluded: 0,
    uncertainFullText: 0,
    studiesIncluded: 0,
  };
  const reportsExcludedByReason = Object.fromEntries(
    SCREENING_REASON_CODES.map((code) => [code, 0]),
  ) as Record<ScreeningReasonCode, number>;
  for (const member of corpus.members) {
    const first = latestDecision(member, 'title-abstract');
    if (!first) continue;
    counts.recordsScreened++;
    if (first.decision === 'exclude') counts.excludedTitleAbstract++;
    if (first.decision === 'uncertain') counts.uncertainTitleAbstract++;
    if (first.decision !== 'include') continue;
    counts.reportsSought++;
    if (member.retrieval === 'not_retrieved') {
      counts.reportsNotRetrieved++;
      continue;
    }
    const second = latestDecision(member, 'full-text');
    if (!second) {
      counts.awaitingFullText++;
      continue;
    }
    counts.reportsAssessed++;
    if (second.decision === 'include') counts.studiesIncluded++;
    if (second.decision === 'uncertain') counts.uncertainFullText++;
    if (second.decision === 'exclude') {
      counts.reportsExcluded++;
      reportsExcludedByReason[reasonCodeOf(second.reasonCode)]++;
    }
  }
  return {
    sources,
    identified,
    // Citation searching and other methods arrive with snowballing (C3c).
    identifiedOtherMethods: 0,
    duplicatesRemoved,
    awaitingDuplicateCheck,
    recordsOutsideSearches: members - (identified - duplicatesRemoved - awaitingDuplicateCheck),
    members,
    awaitingScreening: members - counts.recordsScreened,
    reportsExcludedByReason,
    ...counts,
  };
}

export type PrismaBoxKey =
  | 'identified'
  | 'identifiedOtherMethods'
  | 'duplicatesRemoved'
  | 'awaitingDuplicateCheck'
  | 'recordsOutsideSearches'
  | 'recordsScreened'
  | 'awaitingScreening'
  | 'excludedTitleAbstract'
  | 'uncertainTitleAbstract'
  | 'reportsSought'
  | 'reportsNotRetrieved'
  | 'awaitingFullText'
  | 'reportsAssessed'
  | 'reportsExcluded'
  | 'uncertainFullText'
  | 'studiesIncluded';
export type PrismaBox =
  | { kind: 'source'; source: PrismaSource; n: number }
  | { kind: 'box'; key: PrismaBoxKey; n: number }
  | { kind: 'reason'; code: ScreeningReasonCode; n: number };

/** The flow in PRISMA order, one entry per box; the module gives each one its label. */
export function prismaBoxes(counts: PrismaCounts): PrismaBox[] {
  const box = (key: PrismaBoxKey): PrismaBox => ({ kind: 'box', key, n: counts[key] });
  return [
    ...counts.sources.map((source) => ({ kind: 'source' as const, source, n: source.retrieved })),
    box('identified'),
    box('identifiedOtherMethods'),
    box('duplicatesRemoved'),
    box('awaitingDuplicateCheck'),
    box('recordsOutsideSearches'),
    box('recordsScreened'),
    box('awaitingScreening'),
    box('excludedTitleAbstract'),
    box('uncertainTitleAbstract'),
    box('reportsSought'),
    box('reportsNotRetrieved'),
    box('awaitingFullText'),
    box('reportsAssessed'),
    box('reportsExcluded'),
    ...SCREENING_REASON_CODES.filter((code) => counts.reportsExcludedByReason[code] > 0).map((code) => ({
      kind: 'reason' as const,
      code,
      n: counts.reportsExcludedByReason[code],
    })),
    box('uncertainFullText'),
    box('studiesIncluded'),
  ];
}

export const toCsv = (rows: (string | number)[][]) =>
  rows.map((row) => row.map((value) => csvCell(String(value))).join(',')).join('\n');

const LOG_HEADER = [
  'member',
  'title',
  'stage',
  'decision',
  'reason code',
  'reason text',
  'decider',
  'accepted AI suggestion',
  'at',
];

/** Every decision in the log in time order; AI-suggested decisions say so in the decider column. */
export function screeningLogRows(corpus: Corpus): string[][] {
  const rows = corpus.members.flatMap((member) =>
    member.decisions.map((decision) => ({
      at: decision.at,
      cells: [
        member.exportId,
        member.title ?? member.identifiers.doi ?? '',
        decision.stage,
        decision.decision,
        decision.reasonCode,
        decision.reasonText,
        decision.decider.kind === 'person'
          ? `person: ${decision.decider.name ?? ''}`.trim()
          : 'ai-suggestion',
        decision.acceptedSuggestion
          ? `${decision.acceptedSuggestion.decision}: ${decision.acceptedSuggestion.reason}`
          : '',
        decision.at,
      ],
    })),
  );
  return [LOG_HEADER, ...rows.sort((a, b) => a.at.localeCompare(b.at)).map((row) => row.cells)];
}
