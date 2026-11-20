import { normalizeDoi } from '@/core/library';
import type { Corpus } from '@/core/schemas/corpus';
import { CorpusKeywordsSchema, DoiKeywordsSchema, type CorpusKeywords } from '@/core/schemas/corpusKeywords';
import { LibraryItemSchema, type LibraryItem, type PaperKeyword } from '@/core/schemas/library';
import type { DocStore } from './docStore';
import { libraryByDois, type createLibraryRepository } from './library';
import type { KeywordTarget, MemberKeywords } from './types';
export type { KeywordTarget, MemberKeywords } from './types';

export function createCorpusKeywordsRepository(
  store: DocStore,
  library: ReturnType<typeof createLibraryRepository>,
  now: () => string,
) {
  return {
    async get(corpusId: string) {
      const row = await store.get('corpusKeywords', corpusId);
      return row ? CorpusKeywordsSchema.parse(row.doc) : undefined;
    },
    async save(collection: CorpusKeywords) {
      const value = CorpusKeywordsSchema.parse(collection);
      await store.put('corpusKeywords', value.corpusId, value);
      return value;
    },
    /**
     * Each member's keywords: from its library record (by library id, then DOI), else from keywords fetched for its
     * DOI alone. A member with neither is missing when it has a DOI.
     */
    async memberKeywords(corpus: Corpus): Promise<MemberKeywords> {
      const doiOf = (value: string | undefined) => (value ? normalizeDoi(value) : null);
      const libraryIds = [...new Set(corpus.members.flatMap((member) => member.identifiers.libraryIds))];
      const dois = [...new Set(corpus.members.flatMap((member) => doiOf(member.identifiers.doi) ?? []))];
      const byId = new Map<string, LibraryItem>();
      const byDoi = new Map<string, LibraryItem>();
      // Start every read together: Dexie's liveQuery only tracks reads issued before its context is lost.
      const [linkedRows, byDoiItems, fetchedRows] = await Promise.all([
        store.getMany('library', libraryIds),
        libraryByDois(store, dois),
        store.getMany('doiKeywords', dois),
      ]);
      const linked = linkedRows.flatMap((row) => (row ? [LibraryItemSchema.parse(row.doc)] : []));
      for (const item of [...linked, ...byDoiItems]) {
        byId.set(item.id, item);
        byDoi.set(item.doi, item);
      }
      const fetched = new Map(
        fetchedRows.flatMap((row) => {
          if (!row) return [];
          const value = DoiKeywordsSchema.parse(row.doc);
          return [[value.doi, value.keywords] as const];
        }),
      );
      const result: MemberKeywords = { papers: [], missing: [], withoutDoi: 0 };
      for (const member of corpus.members) {
        const doi = doiOf(member.identifiers.doi);
        const item =
          member.identifiers.libraryIds.map((id) => byId.get(id)).find(Boolean) ??
          (doi ? byDoi.get(doi) : undefined);
        const keywords = item?.keywords ?? (doi ? fetched.get(doi) : undefined);
        const year = member.stratum.year ?? item?.year ?? null;
        // A member linked to a library record may lack a DOI of its own; the record's DOI still finds it.
        const lookupDoi = doi ?? item?.doi;
        if (keywords) result.papers.push({ memberId: member.memberId, year, keywords });
        else if (lookupDoi)
          result.missing.push({ memberId: member.memberId, doi: lookupDoi, libraryId: item?.id ?? null });
        else result.withoutDoi++;
      }
      return result;
    },
    /** Saves fetched keywords on the library record when there is one, otherwise against the DOI alone. */
    async saveFetched(target: KeywordTarget, keywords: PaperKeyword[]) {
      if (target.libraryId) await library.update(target.libraryId, { keywords });
      else
        await store.put(
          'doiKeywords',
          target.doi,
          DoiKeywordsSchema.parse({ doi: target.doi, fetchedAt: now(), keywords }),
        );
    },
  };
}
