import { z } from 'zod';
import { normalizeDoi } from '../library/doi';
import { mapOpenAlexKeywords, openAlexLevelId } from '../library/lookup';
import { abstractFromIndex } from '../library/openAlexAbstract';
import { openAlexShortId } from '../library/openAlexGraphMetadata';
import { paperId } from '../schemas/labKg';

const text = z.string().nullish();
const named = { id: text, display_name: text };
const level = z.object(named).nullish();
const topic = z.object({
  ...named,
  score: z.number().nullish(),
  subfield: level,
  field: level,
  domain: level,
});

const WorkSchema = z.object({
  id: z.string().transform(paperId).pipe(z.string()),
  doi: text,
  title: text,
  display_name: text,
  abstract_inverted_index: z.unknown().optional(),
  publication_year: z.number().int().nullish(),
  cited_by_count: z.number().int().nonnegative().nullish(),
  type: text,
  primary_location: z.object({ source: level }).nullish(),
  authorships: z
    .array(
      z.object({
        author: z.object({ ...named, orcid: text }).nullish(),
        institutions: z.array(z.object({ ...named, ror: text, country_code: text })).nullish(),
      }),
    )
    .nullish(),
  keywords: z.unknown().optional(),
  primary_topic: topic.nullish(),
  topics: z.array(topic).nullish(),
  referenced_works: z.array(z.string().nullable()).nullish(),
  related_works: z.array(z.string().nullable()).nullish(),
});

export const OPENALEX_WORK_SELECT = Object.keys(WorkSchema.shape).join(',');

export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

type NamedNode = { id: string; display_name: string | null };

export function mapOpenAlexWorkToKg(raw: unknown) {
  const work = WorkSchema.parse(raw);
  const { id } = work;
  const sourceId = openAlexShortId(work.primary_location?.source?.id, /^S\d+$/u);
  const title = (work.title ?? work.display_name ?? '')
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const keywords = mapOpenAlexKeywords(work.keywords);
  const authors = new Map<string, NamedNode & { orcid: string | null }>();
  const institutions = new Map<string, NamedNode & { ror: string | null; country_code: string | null }>();
  const authored: { paper_id: string; author_id: string; position: number }[] = [];
  const affiliated = new Map<string, { paper_id: string; author_id: string; institution_id: string }>();
  for (const [index, row] of (work.authorships ?? []).entries()) {
    const authorId = openAlexShortId(row.author?.id, /^A\d+$/u);
    if (!authorId) continue;
    if (!authors.has(authorId)) authored.push({ paper_id: id, author_id: authorId, position: index + 1 });
    authors.set(authorId, {
      id: authorId,
      display_name: row.author?.display_name ?? null,
      orcid: row.author?.orcid ?? null,
    });
    for (const institution of row.institutions ?? []) {
      const institutionId = openAlexShortId(institution.id, /^I\d+$/u);
      if (!institutionId) continue;
      institutions.set(institutionId, {
        id: institutionId,
        display_name: institution.display_name ?? null,
        ror: institution.ror ?? null,
        country_code: institution.country_code ?? null,
      });
      affiliated.set(`${authorId}:${institutionId}`, {
        paper_id: id,
        author_id: authorId,
        institution_id: institutionId,
      });
    }
  }
  const hierarchy = mapHierarchy(id, work.primary_topic, work.topics ?? []);
  const linked = (works: (string | null)[] | null | undefined) =>
    [...new Set((works ?? []).flatMap((item) => paperId(item) ?? []))]
      .filter((target) => target !== id)
      .map((target) => ({ paper_id: id, target_id: target }));
  return {
    nodes: {
      paper: {
        id,
        doi: normalizeDoi(work.doi ?? ''),
        title,
        title_normalized: normalizeText(title),
        abstract: abstractFromIndex(work.abstract_inverted_index),
        publication_year: work.publication_year ?? null,
        cited_by_count: work.cited_by_count ?? null,
        type: work.type ?? null,
        source_id: sourceId,
        subfield_id: hierarchy.primarySubfieldId,
      },
      keyword: keywords.map(({ id, name }) => ({ id, text: name, text_normalized: normalizeText(name) })),
      author: [...authors.values()],
      institution: [...institutions.values()],
      source: sourceId
        ? [{ id: sourceId, display_name: work.primary_location?.source?.display_name ?? null }]
        : [],
      ...hierarchy.nodes,
    },
    edges: {
      has_keyword: keywords.map((item) => ({
        paper_id: id,
        keyword_id: item.id,
        relevance_score: item.score,
      })),
      cites: linked(work.referenced_works),
      related_to: linked(work.related_works),
      authored,
      affiliated: [...affiliated.values()],
      ...hierarchy.edges,
    },
  };
}

type Topic = z.infer<typeof topic>;

function mapHierarchy(paper: string, primary: Topic | null | undefined, topics: Topic[]) {
  const topicNodes = new Map<string, NamedNode>();
  const subfields = new Map<string, NamedNode>();
  const fields = new Map<string, NamedNode>();
  const domains = new Map<string, NamedNode>();
  const hasTopic = new Map<string, { paper_id: string; topic_id: string; score: number | null }>();
  const subfieldOf = new Map<string, { topic_id: string; subfield_id: string }>();
  const fieldOf = new Map<string, { subfield_id: string; field_id: string }>();
  const domainOf = new Map<string, { field_id: string; domain_id: string }>();
  // Process the primary topic last so its score and hierarchy take precedence when it is also in topics.
  for (const row of primary ? [...topics, primary] : topics) {
    const id = openAlexShortId(row.id, /^(?:topics\/)?T\d+$/u);
    if (!id) continue;
    const topicId = id.startsWith('topics/') ? id : `topics/${id}`;
    const subfieldId = openAlexLevelId(row.subfield?.id, 'subfields');
    const fieldId = openAlexLevelId(row.field?.id, 'fields');
    const domainId = openAlexLevelId(row.domain?.id, 'domains');
    topicNodes.set(topicId, { id: topicId, display_name: row.display_name ?? null });
    hasTopic.set(topicId, {
      paper_id: paper,
      topic_id: topicId,
      score: row.score ?? hasTopic.get(topicId)?.score ?? null,
    });
    if (subfieldId) {
      subfields.set(subfieldId, { id: subfieldId, display_name: row.subfield?.display_name ?? null });
      subfieldOf.set(topicId, { topic_id: topicId, subfield_id: subfieldId });
    }
    if (fieldId) {
      fields.set(fieldId, { id: fieldId, display_name: row.field?.display_name ?? null });
      if (subfieldId) fieldOf.set(subfieldId, { subfield_id: subfieldId, field_id: fieldId });
    }
    if (domainId) {
      domains.set(domainId, { id: domainId, display_name: row.domain?.display_name ?? null });
      if (fieldId) domainOf.set(fieldId, { field_id: fieldId, domain_id: domainId });
    }
  }
  return {
    primarySubfieldId: openAlexLevelId(primary?.subfield?.id, 'subfields'),
    nodes: {
      topic: [...topicNodes.values()],
      subfield: [...subfields.values()],
      field: [...fields.values()],
      domain: [...domains.values()],
    },
    edges: {
      has_topic: [...hasTopic.values()],
      subfield_of: [...subfieldOf.values()],
      field_of: [...fieldOf.values()],
      domain_of: [...domainOf.values()],
    },
  };
}
