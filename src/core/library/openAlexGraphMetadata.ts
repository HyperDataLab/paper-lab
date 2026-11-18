import { z } from 'zod';
import type { LibraryItem } from '../schemas/library';

const named = { display_name: z.string().nullish() };
export const OpenAlexSourceSchema = z.object({ ...named, id: z.string().nullish() }).nullish();
export const OpenAlexAuthorshipsSchema = z
  .array(
    z.object({
      author: z.object({ ...named, id: z.string().nullish(), orcid: z.string().nullish() }).nullish(),
      institutions: z
        .array(z.object({ ...named, ror: z.string().nullish(), country_code: z.string().nullish() }))
        .nullish(),
    }),
  )
  .nullish();

export function openAlexShortId(value: string | null | undefined, pattern: RegExp) {
  const short = value?.trim().replace(/^https?:\/\/openalex\.org\//iu, '');
  return short && pattern.test(short) ? short : null;
}

function externalId(value: string | null | undefined, prefix: RegExp, pattern: RegExp) {
  const short = value?.trim().replace(prefix, '');
  return short && pattern.test(short) ? short : null;
}

export function mapOpenAlexGraphMetadata(
  authorships: z.infer<typeof OpenAlexAuthorshipsSchema>,
  references: (string | null)[] | null | undefined,
  source: z.infer<typeof OpenAlexSourceSchema>,
): Required<Pick<LibraryItem, 'authorships' | 'referenced_works' | 'openalex_source_id'>> {
  return {
    authorships: (authorships ?? []).map(({ author, institutions }) => ({
      id: openAlexShortId(author?.id, /^A\d+$/u),
      name: author?.display_name ?? null,
      orcid: externalId(author?.orcid, /^https?:\/\/orcid\.org\//iu, /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u),
      institutions: (institutions ?? []).map((institution) => ({
        name: institution.display_name ?? null,
        ror: externalId(institution.ror, /^https?:\/\/ror\.org\//iu, /^0[0-9a-hj-km-np-tv-z]{6}\d{2}$/u),
        country: institution.country_code ?? null,
      })),
    })),
    referenced_works: [...new Set((references ?? []).flatMap((id) => openAlexShortId(id, /^W\d+$/u) ?? []))],
    openalex_source_id: openAlexShortId(source?.id, /^S\d+$/u),
  };
}
