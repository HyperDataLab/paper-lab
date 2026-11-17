import { z } from 'zod';
import type { LibraryItem, OaSource, Taxonomy } from '../schemas/library';

const named = z.object({ display_name: z.string().nullish() }).nullish();
const level = z.object({ id: z.string().nullish(), display_name: z.string().nullish() }).nullish();
const location = z.object({
  landing_page_url: z.string().nullish(),
  pdf_url: z.string().nullish(),
  license: z.string().nullish(),
  version: z.string().nullish(),
  is_oa: z.boolean().nullish(),
  source: named,
});
const OpenAlexSchema = z.object({
  id: z.string().nullish(),
  doi: z.string().nullish(),
  title: z.string().nullish(),
  publication_year: z.number().int().nullish(),
  authorships: z.array(z.object({ author: named })).nullish(),
  primary_location: location.nullish(),
  best_oa_location: location.nullish(),
  locations: z.array(location).nullish(),
  open_access: z.object({ is_oa: z.boolean().nullish(), oa_url: z.string().nullish() }).nullish(),
  primary_topic: z
    .object({
      display_name: z.string().nullish(),
      score: z.number().nullish(),
      subfield: level,
      field: level,
      domain: level,
    })
    .nullish(),
});
const CrossrefSchema = z.object({
  message: z.object({
    title: z.array(z.string()).nullish(),
    author: z
      .array(
        z.object({ given: z.string().nullish(), family: z.string().nullish(), name: z.string().nullish() }),
      )
      .nullish(),
    issued: z.object({ 'date-parts': z.array(z.array(z.number().nullable())).nullish() }).nullish(),
    'container-title': z.array(z.string()).nullish(),
  }),
});
const UnpaywallSchema = z.object({
  is_oa: z.boolean().nullish(),
  best_oa_location: z
    .object({
      url_for_landing_page: z.string().nullish(),
      url_for_pdf: z.string().nullish(),
      license: z.string().nullish(),
      version: z.string().nullish(),
    })
    .nullish(),
});
const EuropePmcSchema = z.object({
  resultList: z
    .object({
      result: z
        .array(
          z.object({
            doi: z.string().nullish(),
            pmcid: z.string().nullish(),
            isOpenAccess: z.string().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

export type LookupPatch = Pick<
  LibraryItem,
  'title' | 'authors' | 'year' | 'venue' | 'access' | 'oa_sources' | 'arxiv_id' | 'taxonomy' | 'openalex_id'
>;
export interface OpenAlexLookup {
  metadata: Pick<
    LookupPatch,
    'title' | 'authors' | 'year' | 'venue' | 'taxonomy' | 'openalex_id' | 'arxiv_id'
  >;
  is_open: boolean;
  sources: OaSource[];
}
export interface CrossrefLookup {
  title: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
}
export interface OaLookup {
  is_open: boolean;
  sources: OaSource[];
}

const stripTags = (text: string) =>
  text
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:v\d+)?(?:\.pdf)?(?:[?#]|$)/iu;
const ARXIV_DOI = /10\.48550\/arxiv\.(.+)$/iu;

export function arxivIdFrom(urls: (string | null | undefined)[], doi: string | null | undefined) {
  const fromDoi = doi ? ARXIV_DOI.exec(doi)?.[1] : undefined;
  if (fromDoi) return fromDoi.toLowerCase();
  for (const url of urls) {
    const match = url ? ARXIV_URL.exec(url)?.[1] : undefined;
    if (match) return match;
  }
  return null;
}

/** `https://openalex.org/subfields/1702` → `subfields/1702` (the key shared with the Writing Bank); null otherwise. */
export function openAlexLevelId(id: string | null | undefined, kind: 'domains' | 'fields' | 'subfields') {
  const short = (id ?? '').trim().replace(/^https?:\/\/openalex\.org\//iu, '');
  return new RegExp(`^${kind}/\\d+$`, 'u').test(short) ? short : null;
}

export function mapOpenAlex(raw: unknown): OpenAlexLookup {
  const work = OpenAlexSchema.parse(raw);
  const locations = [work.best_oa_location, ...(work.locations ?? [])].flatMap((item) => item ?? []);
  const topic = work.primary_topic;
  const taxonomy: Taxonomy | null = topic
    ? {
        domain: topic.domain?.display_name ?? null,
        field: topic.field?.display_name ?? null,
        subfield: topic.subfield?.display_name ?? null,
        topic: topic.display_name ?? null,
        score: topic.score ?? null,
        domainId: openAlexLevelId(topic.domain?.id, 'domains'),
        fieldId: openAlexLevelId(topic.field?.id, 'fields'),
        subfieldId: openAlexLevelId(topic.subfield?.id, 'subfields'),
      }
    : null;
  return {
    metadata: {
      title: work.title ? stripTags(work.title) : null,
      authors: (work.authorships ?? []).flatMap((item) => item.author?.display_name ?? []),
      year: work.publication_year ?? null,
      venue: work.primary_location?.source?.display_name ?? null,
      taxonomy,
      openalex_id: work.id ?? null,
      arxiv_id: arxivIdFrom(
        locations.flatMap((item) => [item.landing_page_url, item.pdf_url]),
        work.doi,
      ),
    },
    is_open: work.open_access?.is_oa ?? false,
    sources: locations
      .filter((item) => item.is_oa !== false && (item.pdf_url || item.landing_page_url))
      .map((item) => ({
        source: 'openalex',
        landing_url: item.landing_page_url ?? null,
        pdf_url: item.pdf_url ?? null,
        license: item.license ?? null,
        version: item.version ?? null,
      })),
  };
}

export function mapCrossref(raw: unknown): CrossrefLookup {
  const { message } = CrossrefSchema.parse(raw);
  return {
    title: message.title?.[0] ? stripTags(message.title[0]) : null,
    authors: (message.author ?? []).flatMap((author) => {
      const name = author.name ?? [author.given, author.family].filter(Boolean).join(' ');
      return name ? [name] : [];
    }),
    year: message.issued?.['date-parts']?.[0]?.[0] ?? null,
    venue: message['container-title']?.[0] ?? null,
  };
}

export function mapUnpaywall(raw: unknown): OaLookup {
  const data = UnpaywallSchema.parse(raw);
  const best = data.best_oa_location;
  return {
    is_open: data.is_oa ?? false,
    sources: best
      ? [
          {
            source: 'unpaywall',
            landing_url: best.url_for_landing_page ?? null,
            pdf_url: best.url_for_pdf ?? null,
            license: best.license ?? null,
            version: best.version ?? null,
          },
        ]
      : [],
  };
}

export function mapEuropePmc(raw: unknown, doi: string): OaLookup {
  const results = EuropePmcSchema.parse(raw).resultList?.result ?? [];
  const match = results.find(
    (item) => item.doi?.toLowerCase() === doi && item.pmcid && item.isOpenAccess === 'Y',
  );
  if (!match?.pmcid) return { is_open: false, sources: [] };
  return {
    is_open: true,
    sources: [
      {
        source: 'europepmc',
        landing_url: `https://europepmc.org/article/PMC/${match.pmcid}`,
        pdf_url: null,
        license: null,
        version: null,
      },
    ],
  };
}

export function mergeLookups(input: {
  openalex: OpenAlexLookup | null;
  crossref: CrossrefLookup | null;
  oa: OaLookup[];
  /** An optional source could not be reached, so "nothing found" would overstate what was checked. */
  incomplete: boolean;
}): LookupPatch {
  const { openalex, crossref, oa, incomplete } = input;
  const seen = new Set<string>();
  const sources = [...(openalex?.sources ?? []), ...oa.flatMap((item) => item.sources)].filter((item) => {
    const key = (item.pdf_url ?? item.landing_url ?? '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const open = (openalex?.is_open ?? false) || oa.some((item) => item.is_open);
  return {
    title: openalex?.metadata.title ?? crossref?.title ?? null,
    authors: openalex?.metadata.authors.length ? openalex.metadata.authors : (crossref?.authors ?? []),
    year: openalex?.metadata.year ?? crossref?.year ?? null,
    venue: openalex?.metadata.venue ?? crossref?.venue ?? null,
    taxonomy: openalex?.metadata.taxonomy ?? null,
    openalex_id: openalex?.metadata.openalex_id ?? null,
    arxiv_id: openalex?.metadata.arxiv_id ?? null,
    oa_sources: sources,
    access: open ? 'open' : incomplete ? 'unknown' : 'none_found',
  };
}

/** Rough check that an attached file is this paper; it warns and never blocks. */
export function titleMatchesText(title: string | null, text: string) {
  const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const wanted = [...new Set(words(title ?? ''))];
  if (wanted.length < 2) return null;
  const present = new Set(words(text));
  return wanted.filter((word) => present.has(word)).length / wanted.length >= 0.6;
}
