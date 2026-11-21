import { z } from 'zod';
import { openAlexLevelId } from '../library/lookup';
import type { Corpus } from '../schemas/corpus';
import { addMember } from './intake';
import type { Work } from './sampling';

export const JournalWorkSchema = z.object({
  id: z.string(),
  doi: z.string().nullable(),
  title: z.string().nullable(),
  publication_year: z.number(),
  type: z.string(),
  is_retracted: z.boolean(),
  primary_location: z
    .object({ source: z.object({ id: z.string().optional() }).nullable().optional() })
    .nullable()
    .optional(),
  biblio: z
    .object({ volume: z.string().nullable().optional(), issue: z.string().nullable().optional() })
    .nullable()
    .optional(),
  authorships: z
    .array(
      z.object({
        author: z.object({ id: z.string().optional() }).optional(),
        institutions: z.array(z.object({ country_code: z.string().nullable().optional() })).optional(),
      }),
    )
    .optional(),
  cited_by_count: z.number().int().nonnegative().nullish(),
  primary_topic: z.object({ subfield: z.object({ id: z.string().nullish() }).nullish() }).nullish(),
});

export function addJournalSample(
  corpus: Corpus,
  sample: { work: Work; role: 'build' | 'held_out' }[],
  at: string,
) {
  let next = corpus;
  for (const { work, role } of sample) {
    const added = addMember(
      next,
      { doi: work.doi, openalexId: work.id, title: work.title, year: work.publication_year },
      at,
    );
    next = added.corpus;
    if (!('memberId' in added)) continue;
    const subfieldId = openAlexLevelId(work.primary_topic?.subfield?.id, 'subfields');
    next = {
      ...next,
      members: next.members.map((m) =>
        m.memberId !== added.memberId
          ? m
          : {
              ...m,
              role,
              version: 'publishedVersion',
              stratum: {
                ...m.stratum,
                year: work.publication_year,
                articleType: work.type,
                issue: [work.biblio?.volume, work.biblio?.issue].filter(Boolean).join('/') || undefined,
              },
              authorIds: [
                ...new Set(
                  (work.authorships ?? []).map((a) => a.author?.id).filter((v): v is string => Boolean(v)),
                ),
              ],
              countries: [
                ...new Set(
                  (work.authorships ?? [])
                    .flatMap((a) => (a.institutions ?? []).map((i) => i.country_code))
                    .filter((v): v is string => Boolean(v)),
                ),
              ],
              ...(typeof work.cited_by_count === 'number' ? { citedByCount: work.cited_by_count } : {}),
              ...(subfieldId ? { subfieldId } : {}),
            },
      ),
    };
  }
  return next;
}

export function admiredControlQuotas(target: Corpus, years: number[]) {
  return new Map(
    years.map((year) => [year, target.members.filter((m) => m.role && m.stratum.year === year).length]),
  );
}

export function admiredHarvestLimit(yearQuota: number, venueCount: number) {
  const quota = Math.ceil(yearQuota / venueCount);
  // Leave room for records the journal eligibility rules drop.
  return quota ? Math.max(3 * quota, 20) : 0;
}
