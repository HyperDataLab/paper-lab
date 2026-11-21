import type { ResearchCandidate } from '@/core/autoresearch/contracts';
import type { LiteratureProvider } from '@/core/autoresearch/stage-fields';
import type { searchQueries } from '@/core/autoresearch/validation';
import { normalizeDoi } from '@/core/library/doi';
import { paperId } from '@/core/schemas/labKg';
import { normalTitle } from '@/core/text/normalizeTitle';

export type Query = ReturnType<typeof searchQueries>[number];
type CandidateSource = ResearchCandidate['sources'][number];
export type Entry = Pick<
  ResearchCandidate,
  'title' | 'doi' | 'year' | 'abstract' | 'authors' | 'venue' | 'citations' | 'openalexId'
> & {
  source: CandidateSource;
  queryIds?: string[];
  decision?: ResearchCandidate['existingDecision'];
};
export const doiUrl = (doi: string | null, work: string | null) =>
  doi ? `https://doi.org/${doi}` : work ? `https://openalex.org/${work}` : null;

export type RecordEntry = { entry: Entry; provider: LiteratureProvider; retrievedAt: string };
type Group = { dois: Set<string>; works: Set<string>; titles: Set<string>; rows: RecordEntry[] };
export function mergeRecords(records: RecordEntry[], queries: Query[]): ResearchCandidate[] {
  const groups = new Set<Group>();
  const byDoi = new Map<string, Group>();
  const byWork = new Map<string, Group>();
  const byTitle = new Map<string, Set<Group>>();
  const compatible = (left: Set<string>, right: Set<string>) =>
    !left.size || !right.size || [...left].some((id) => right.has(id));
  for (const row of records) {
    const title = normalTitle(row.entry.title);
    const doi = normalizeDoi(row.entry.doi ?? '');
    const work = paperId(row.entry.openalexId);
    if (!title && !doi && !work) continue;
    const doiMatch = doi ? byDoi.get(doi) : undefined;
    const workMatch = work ? byWork.get(work) : undefined;
    const target = doiMatch ??
      workMatch ?? {
        dois: new Set<string>(),
        works: new Set<string>(),
        titles: new Set<string>(),
        rows: [],
      };
    if (doi) target.dois.add(doi);
    if (work) target.works.add(work);
    function join(other: Group) {
      if (other === target) return;
      other.dois.forEach((id) => target.dois.add(id));
      other.works.forEach((id) => target.works.add(id));
      other.titles.forEach((alias) => {
        target.titles.add(alias);
        byTitle.get(alias)?.delete(other);
      });
      target.rows.push(...other.rows);
      groups.delete(other);
    }
    if (workMatch) join(workMatch);
    // A shared title can fill missing identifiers but cannot override a conflicting DOI or work ID.
    const titleMatch = [...(byTitle.get(title) ?? [])].find(
      (group) =>
        group !== target && compatible(target.dois, group.dois) && compatible(target.works, group.works),
    );
    if (titleMatch) join(titleMatch);
    if (title) target.titles.add(title);
    target.rows.push(row);
    groups.add(target);
    target.dois.forEach((id) => byDoi.set(id, target));
    target.works.forEach((id) => byWork.set(id, target));
    target.titles.forEach((alias) => {
      const found = byTitle.get(alias) ?? new Set<Group>();
      found.add(target);
      byTitle.set(alias, found);
    });
  }
  const order = new Map(records.map((row, index) => [row, index]));
  const ordered = [...groups];
  for (const group of ordered) group.rows.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  ordered.sort(
    (a, b) => (a.rows[0] ? (order.get(a.rows[0]) ?? 0) : 0) - (b.rows[0] ? (order.get(b.rows[0]) ?? 0) : 0),
  );
  return ordered.flatMap(({ rows }, index) => {
    const entries = rows.map(({ entry }) => entry);
    const firstText = (key: 'title' | 'abstract' | 'venue') =>
      entries.find((entry) => entry[key]?.trim())?.[key]?.trim() ?? null;
    const title = firstText('title');
    const doi = entries.flatMap((entry) => normalizeDoi(entry.doi ?? '') ?? [])[0] ?? null;
    const work = entries.flatMap((entry) => paperId(entry.openalexId) ?? [])[0] ?? null;
    const id = doi ?? work ?? normalTitle(title ?? '');
    if (!id || !title) return [];
    const queryIds = [...new Set(entries.flatMap((entry) => entry.queryIds ?? []))];
    const provenance = new Map(
      rows.map(({ entry, provider, retrievedAt }) => [
        JSON.stringify([provider, entry.source.kind, entry.source.ref]),
        {
          provider,
          sourceId: entry.source.ref,
          url: doiUrl(normalizeDoi(entry.doi ?? ''), paperId(entry.openalexId)),
          retrievedAt,
        },
      ]),
    );
    const citationKey = `P${index + 1}`;
    return [
      {
        id,
        paper_id: id,
        title,
        doi,
        openalexId: work,
        citationKey,
        cite_key: citationKey,
        authors:
          entries
            .find((entry) => entry.authors?.some((author) => author.trim()))
            ?.authors?.map((author) => author.trim())
            .filter(Boolean) ?? [],
        year: entries.find((entry) => Number.isInteger(entry.year))?.year ?? null,
        abstract: firstText('abstract'),
        venue: firstText('venue'),
        citations:
          entries.find(
            ({ citations }) => typeof citations === 'number' && Number.isInteger(citations) && citations >= 0,
          )?.citations ?? null,
        sources: [...new Map(entries.map(({ source }) => [JSON.stringify(source), source])).values()],
        source_records: [...provenance.values()],
        queryIds: queryIds.length ? queryIds : queries.map((q) => q.id),
        queryLink: rows.some(({ provider }) => provider !== 'corpus')
          ? 'retrieved'
          : queryIds.length
            ? 'matched_harvest'
            : 'pool_context',
        existingDecision: entries.find((entry) => entry.decision)?.decision ?? null,
      },
    ];
  });
}
