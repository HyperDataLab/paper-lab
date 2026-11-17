import { normalizeDoi } from '@/core/library';
import type { Corpus } from '@/core/schemas/corpus';
import {
  CorpusKeywordsSchema,
  DoiKeywordsSchema,
  type CorpusKeywords,
  type KeywordPaper,
} from '@/core/schemas/corpusKeywords';
import { LibraryItemSchema, type LibraryItem, type PaperKeyword } from '@/core/schemas/library';
import type { ParagraphDb } from './db';
import type { createLibraryRepository } from './library';

/** A member whose keywords have not been fetched yet; `libraryId` is where they will be saved, if it has a record. */
export interface KeywordTarget {
  memberId: string;
  doi: string;
  libraryId: string | null;
}
export interface MemberKeywords {
  papers: KeywordPaper[];
  missing: KeywordTarget[];
  /** Members with no keywords and no DOI to look them up by. */
  withoutDoi: number;
}

export function createCorpusKeywordsRepository(
  db: ParagraphDb,
  library: ReturnType<typeof createLibraryRepository>,
  now: () => string,
) {
  return {
    async get(corpusId: string) {
      const row = await db.corpusKeywords.get(corpusId);
      return row ? CorpusKeywordsSchema.parse(row) : undefined;
    },
    async save(collection: CorpusKeywords) {
      const value = CorpusKeywordsSchema.parse(collection);
      await db.corpusKeywords.put(value);
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
      for (const row of [
        ...(await db.library.bulkGet(libraryIds)),
        ...(await db.library.where('doi').anyOf(dois).toArray()),
      ]) {
        if (!row) continue;
        const item = LibraryItemSchema.parse(row);
        byId.set(item.id, item);
        byDoi.set(item.doi, item);
      }
      const fetched = new Map(
        (await db.doiKeywords.bulkGet(dois)).flatMap((row) => {
          if (!row) return [];
          const value = DoiKeywordsSchema.parse(row);
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
        if (keywords) result.papers.push({ memberId: member.memberId, year, keywords });
        else if (doi) result.missing.push({ memberId: member.memberId, doi, libraryId: item?.id ?? null });
        else result.withoutDoi++;
      }
      return result;
    },
    /** Saves fetched keywords on the library record when there is one, otherwise against the DOI alone. */
    async saveFetched(target: KeywordTarget, keywords: PaperKeyword[]) {
      if (target.libraryId) await library.update(target.libraryId, { keywords });
      else await db.doiKeywords.put(DoiKeywordsSchema.parse({ doi: target.doi, fetchedAt: now(), keywords }));
    },
  };
}
