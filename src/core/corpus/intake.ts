import { normalizeDoi } from '../library/doi';
import { normalTitle } from '../text/normalizeTitle';
import type { Corpus, CorpusMember, LibraryItem, Paper } from '../schemas';
import { exportIdOf } from './index';

export type IntakeInput = {
  memberId?: string;
  doi?: string | null;
  openalexId?: string | null;
  sha256?: string | null;
  paperId?: string | null;
  libraryId?: string | null;
  title?: string | null;
  year?: number | null;
};
const unique = (values: string[]) => [...new Set(values)];
const openalex = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\/openalex\.org\//iu, '')
    .toUpperCase();

export function addMember(
  corpus: Corpus,
  input: IntakeInput,
  now: string,
  makeId: () => string = () => crypto.randomUUID(),
) {
  const doi = input.doi ? normalizeDoi(input.doi) : null;
  const oa = input.openalexId ? openalex(input.openalexId) : undefined;
  const found = corpus.members.find((m) =>
    Boolean(
      (doi &&
        [m.identifiers.doi, ...(m.identifiers.doiAliases ?? [])].some((v) => v && normalizeDoi(v) === doi)) ||
      (oa &&
        [m.identifiers.openalexId, ...(m.identifiers.openalexIdAliases ?? [])].some(
          (v) => v && openalex(v) === oa,
        )) ||
      (input.sha256 && m.identifiers.sha256.includes(input.sha256)) ||
      (input.paperId && m.identifiers.paperIds.includes(input.paperId)) ||
      (input.libraryId && m.identifiers.libraryIds.includes(input.libraryId)),
    ),
  );
  if (found) {
    const identifiers = {
      ...found.identifiers,
      doi: found.identifiers.doi ?? doi ?? undefined,
      doiAliases: unique([
        ...(found.identifiers.doiAliases ?? []),
        ...(doi && found.identifiers.doi && normalizeDoi(found.identifiers.doi) !== doi ? [doi] : []),
      ]),
      openalexId: found.identifiers.openalexId ?? oa,
      openalexIdAliases: unique([
        ...(found.identifiers.openalexIdAliases ?? []),
        ...(oa && found.identifiers.openalexId && openalex(found.identifiers.openalexId) !== oa ? [oa] : []),
      ]),
      sha256: unique([...found.identifiers.sha256, ...(input.sha256 ? [input.sha256] : [])]),
      paperIds: unique([...found.identifiers.paperIds, ...(input.paperId ? [input.paperId] : [])]),
      libraryIds: unique([...found.identifiers.libraryIds, ...(input.libraryId ? [input.libraryId] : [])]),
    };
    const member = {
      ...found,
      title: found.title ?? input.title ?? undefined,
      stratum: { ...found.stratum, year: found.stratum.year ?? input.year ?? undefined },
      identifiers,
    };
    return {
      corpus: {
        ...corpus,
        updatedAt: now,
        members: corpus.members.map((m) => (m.memberId === found.memberId ? member : m)),
      },
      memberId: found.memberId,
      matched: 'identifier' as const,
    };
  }
  const title = input.title && normalTitle(input.title);
  const candidate =
    title && input.year != null
      ? corpus.members.find((m) => m.title && normalTitle(m.title) === title && m.stratum.year === input.year)
      : undefined;
  if (candidate) return { corpus, candidate: candidate.memberId, matched: 'title-year' as const };
  const memberId = input.memberId ?? makeId();
  const member: CorpusMember = {
    memberId,
    title: input.title ?? undefined,
    identifiers: {
      doi: doi ?? undefined,
      openalexId: oa,
      sha256: input.sha256 ? [input.sha256] : [],
      paperIds: input.paperId ? [input.paperId] : [],
      libraryIds: input.libraryId ? [input.libraryId] : [],
    },
    exportId: exportIdOf(memberId),
    role: null,
    stratum: { year: input.year ?? undefined },
    version: null,
    retrieval: 'sought',
    textRead: 'METADATA_ONLY',
    authorIds: [],
    countries: [],
    decisions: [],
    appraisal: [],
    inputs: null,
  };
  return {
    corpus: { ...corpus, updatedAt: now, members: [...corpus.members, member] },
    memberId,
    matched: 'new' as const,
  };
}

export function mergeMembers(
  corpus: Corpus,
  from: string,
  into: string,
  reason: string,
  now: string,
): Corpus {
  const source = corpus.members.find((m) => m.memberId === from);
  const target = corpus.members.find((m) => m.memberId === into);
  if (!source || !target || from === into) return corpus;
  const a = target.identifiers,
    b = source.identifiers;
  const merged = {
    ...target,
    title: target.title ?? source.title,
    stratum: { ...target.stratum, year: target.stratum.year ?? source.stratum.year },
    identifiers: {
      doi: a.doi ?? b.doi,
      doiAliases: unique([
        ...(a.doiAliases ?? []),
        ...(b.doiAliases ?? []),
        ...(a.doi && b.doi && normalizeDoi(a.doi) !== normalizeDoi(b.doi) ? [b.doi] : []),
      ]),
      openalexId: a.openalexId ?? b.openalexId,
      openalexIdAliases: unique([
        ...(a.openalexIdAliases ?? []),
        ...(b.openalexIdAliases ?? []),
        ...(a.openalexId && b.openalexId && openalex(a.openalexId) !== openalex(b.openalexId)
          ? [b.openalexId]
          : []),
      ]),
      sha256: unique([...a.sha256, ...b.sha256]),
      paperIds: unique([...a.paperIds, ...b.paperIds]),
      libraryIds: unique([...a.libraryIds, ...b.libraryIds]),
    },
    decisions: [...target.decisions, ...source.decisions],
  };
  return {
    ...corpus,
    updatedAt: now,
    members: corpus.members.filter((m) => m.memberId !== from).map((m) => (m.memberId === into ? merged : m)),
    aliases: [...corpus.aliases, { from, into, at: now, reason }],
  };
}

export type IntakeOptions = { now?: string; makeId?: () => string };
function addAll(corpus: Corpus, inputs: IntakeInput[], invalid: string[], options: IntakeOptions) {
  let result = corpus;
  const counts = { added: 0, matched: 0, needsConfirmation: 0, invalid: invalid.length };
  const now = options.now ?? new Date().toISOString();
  for (const input of inputs) {
    const next = addMember(result, input, now, options.makeId);
    result = next.corpus;
    if (next.matched === 'new') counts.added++;
    else if (next.matched === 'identifier') counts.matched++;
    else counts.needsConfirmation++;
  }
  return { corpus: result, counts, invalid };
}
export function addFromLibrary(corpus: Corpus, items: LibraryItem[], options: IntakeOptions = {}) {
  return addAll(
    corpus,
    items.map((item) => ({
      doi: item.doi,
      openalexId: item.openalex_id,
      paperId: item.paper_id,
      libraryId: item.id,
      title: item.title,
      year: item.year,
    })),
    [],
    options,
  );
}
export function addFromPapers(corpus: Corpus, papers: Paper[], options: IntakeOptions = {}) {
  return addAll(
    corpus,
    papers.map((paper) => ({ paperId: paper.id, sha256: paper.source.sha256, title: paper.title })),
    [],
    options,
  );
}
export function addFromDois(corpus: Corpus, text: string, options: IntakeOptions = {}) {
  const inputs: IntakeInput[] = [],
    invalid: string[] = [];
  for (const part of text.split(/[\r\n,]+/u)) {
    const value = part.trim();
    if (!value) continue;
    const doi = normalizeDoi(value);
    if (doi) inputs.push({ doi });
    else invalid.push(value);
  }
  return addAll(corpus, inputs, invalid, options);
}
