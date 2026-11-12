import { csvCell } from '../extraction';
import type { Corpus, CorpusMember, CorpusSearch } from '../schemas';
import { SCREENING_REASON_CODES, latestDecision, reasonCodeOf, type ScreeningReasonCode } from './screening';
import { isSnowballSearch } from './snowball';
import { currentRound } from './updateSearch';

export type PrismaSource = {
  source: string;
  kind: 'database' | 'import' | 'citation';
  totalReported: number;
  retrieved: number;
  /** The search stopped before the total it reported, so the source was not searched exhaustively. */
  notExhaustive: boolean;
  updateRound: number;
  snowballRound?: number;
};

/**
 * One PRISMA 2020 column. Every box equals its parent minus its siblings:
 * members = identified − duplicatesRemoved − awaitingDuplicateCheck + recordsOutsideSearches
 * members = recordsScreened + awaitingScreening
 * recordsScreened = excludedTitleAbstract + uncertainTitleAbstract + reportsSought
 * reportsSought = reportsNotRetrieved + awaitingFullText + reportsAssessed
 * reportsAssessed = reportsExcluded + uncertainFullText + studiesIncluded
 */
export type PrismaFlow = {
  sources: PrismaSource[];
  identified: number;
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

/**
 * PRISMA 2020 counts in two columns: databases and files ("databases"), and citation searching ("other methods").
 * The flat fields are the review totals; `identified` and `identifiedOtherMethods` are the two columns' records,
 * so members = identified + identifiedOtherMethods − duplicatesRemoved − awaitingDuplicateCheck + recordsOutsideSearches.
 */
export type PrismaCounts = Omit<PrismaFlow, 'sources'> & {
  /** Database and file sources; citation searches are in `otherMethods.sources`. */
  sources: PrismaSource[];
  identifiedOtherMethods: number;
  databases: PrismaFlow;
  otherMethods: PrismaFlow;
  /** The update round shown, or null for every round. */
  round: number | null;
};
export type PrismaScope = 'all' | 'latest';

type Searches = CorpusSearch[];
function sourceOf(search: CorpusSearch): PrismaSource {
  if (!('requestUrl' in search))
    return {
      source: search.fileName,
      kind: 'import',
      totalReported: search.records,
      retrieved: search.records,
      notExhaustive: false,
      updateRound: 0,
    };
  return {
    source: search.source,
    kind: isSnowballSearch(search) ? 'citation' : 'database',
    totalReported: search.totalReported,
    retrieved: search.retrieved,
    notExhaustive: search.truncated,
    updateRound: search.updateRound,
    ...(search.snowballRound ? { snowballRound: search.snowballRound } : {}),
  };
}

const emptyReasons = () =>
  Object.fromEntries(SCREENING_REASON_CODES.map((code) => [code, 0])) as Record<ScreeningReasonCode, number>;

function flowOf(searches: Searches, members: CorpusMember[], aliases: number, pending: number): PrismaFlow {
  const sources = searches.map(sourceOf);
  const identified = sources.reduce((sum, source) => sum + source.retrieved, 0);
  // Confirmed title-year matches are merged into an existing member and logged as an alias.
  const duplicatesRemoved = searches.reduce((sum, search) => sum + (search.duplicates ?? 0), 0) + aliases;
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
  const reportsExcludedByReason = emptyReasons();
  for (const member of members) {
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
    duplicatesRemoved,
    awaitingDuplicateCheck: pending,
    recordsOutsideSearches: members.length - (identified - duplicatesRemoved - pending),
    members: members.length,
    awaitingScreening: members.length - counts.recordsScreened,
    reportsExcludedByReason,
    ...counts,
  };
}

const SUMMED = [
  'duplicatesRemoved',
  'awaitingDuplicateCheck',
  'recordsOutsideSearches',
  'members',
  'recordsScreened',
  'awaitingScreening',
  'excludedTitleAbstract',
  'uncertainTitleAbstract',
  'reportsSought',
  'reportsNotRetrieved',
  'awaitingFullText',
  'reportsAssessed',
  'reportsExcluded',
  'uncertainFullText',
  'studiesIncluded',
] as const;

/**
 * Counts from the searches and the decision log. Members a citation search added form the "other methods"
 * column. `latest` keeps only the latest update round's searches and the members they added.
 */
export function prismaCounts(corpus: Corpus, scope: PrismaScope = 'all'): PrismaCounts {
  const latest = currentRound(corpus);
  const round = scope === 'latest' && latest > 0 ? latest : null;
  const searches =
    round === null
      ? corpus.searches
      : corpus.searches.filter((search) => 'updateRound' in search && search.updateRound === round);
  const roundIds =
    round === null
      ? null
      : new Set(searches.flatMap((search) => ('memberIds' in search && search.memberIds) || []));
  const inRound = (id: string) => roundIds === null || roundIds.has(id);
  const citation = new Set(
    corpus.searches.filter(isSnowballSearch).flatMap((search) => search.memberIds ?? []),
  );
  const members = corpus.members.filter((member) => inRound(member.memberId));
  const aliases = corpus.aliases.filter((alias) => inRound(alias.from));
  const pending = (corpus.pendingConfirmations ?? []).filter(
    (item) => round === null || (item.updateRound ?? 0) === round,
  );
  const pendingCitation = pending.filter((item) => item.source?.startsWith('snowball-')).length;
  const databases = flowOf(
    searches.filter((search) => !isSnowballSearch(search)),
    members.filter((member) => !citation.has(member.memberId)),
    aliases.filter((alias) => !citation.has(alias.from)).length,
    pending.length - pendingCitation,
  );
  const otherMethods = flowOf(
    searches.filter(isSnowballSearch),
    members.filter((member) => citation.has(member.memberId)),
    aliases.filter((alias) => citation.has(alias.from)).length,
    pendingCitation,
  );
  const totals = Object.fromEntries(SUMMED.map((key) => [key, databases[key] + otherMethods[key]])) as Record<
    (typeof SUMMED)[number],
    number
  >;
  const reportsExcludedByReason = emptyReasons();
  for (const code of SCREENING_REASON_CODES)
    reportsExcludedByReason[code] =
      databases.reportsExcludedByReason[code] + otherMethods.reportsExcludedByReason[code];
  return {
    ...totals,
    sources: databases.sources,
    identified: databases.identified,
    identifiedOtherMethods: otherMethods.identified,
    reportsExcludedByReason,
    databases,
    otherMethods,
    round,
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
/** `total` holds the one box both columns flow into: the studies included in the review. */
export type PrismaColumn = 'databases' | 'otherMethods' | 'total';
export type PrismaBox = { column: PrismaColumn } & (
  | { kind: 'source'; source: PrismaSource; n: number }
  | { kind: 'box'; key: PrismaBoxKey; n: number }
  | { kind: 'reason'; code: ScreeningReasonCode; n: number }
);

function columnBoxes(flow: PrismaFlow, column: 'databases' | 'otherMethods'): PrismaBox[] {
  const box = (key: Exclude<PrismaBoxKey, 'identifiedOtherMethods'>): PrismaBox => ({
    column,
    kind: 'box',
    key,
    n: flow[key],
  });
  return [
    ...flow.sources.map((source) => ({ column, kind: 'source' as const, source, n: source.retrieved })),
    column === 'databases'
      ? box('identified')
      : { column, kind: 'box', key: 'identifiedOtherMethods', n: flow.identified },
    box('duplicatesRemoved'),
    box('awaitingDuplicateCheck'),
    // Citation searching only reaches members through a search, so it has no "outside" box unless one drifted.
    ...(column === 'databases' || flow.recordsOutsideSearches !== 0 ? [box('recordsOutsideSearches')] : []),
    box('recordsScreened'),
    box('awaitingScreening'),
    box('excludedTitleAbstract'),
    box('uncertainTitleAbstract'),
    box('reportsSought'),
    box('reportsNotRetrieved'),
    box('awaitingFullText'),
    box('reportsAssessed'),
    box('reportsExcluded'),
    ...SCREENING_REASON_CODES.filter((code) => flow.reportsExcludedByReason[code] > 0).map((code) => ({
      column,
      kind: 'reason' as const,
      code,
      n: flow.reportsExcludedByReason[code],
    })),
    box('uncertainFullText'),
    box('studiesIncluded'),
  ];
}

/** The flow in PRISMA order, column by column, then the review total; the module gives each box its label. */
export function prismaBoxes(counts: PrismaCounts): PrismaBox[] {
  return [
    ...columnBoxes(counts.databases, 'databases'),
    ...columnBoxes(counts.otherMethods, 'otherMethods'),
    { column: 'total', kind: 'box', key: 'studiesIncluded', n: counts.studiesIncluded },
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
