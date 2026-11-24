import { CONCEPTS, type Concept, type ConceptRelation } from './concepts';
import { PAGES, type Page } from './pages';

export { CONCEPTS } from './concepts';
export { PAGES } from './pages';
export type { Page, PageAction, PageParam, PageTab } from './pages';
export type {
  Concept,
  ConceptField,
  ConceptRelation,
  ConceptStore,
  RelationKind,
  SchemaRef,
} from './concepts';

const BY_ID = new Map(CONCEPTS.map((concept) => [concept.id, concept]));

/** Lowercase, strip diacritics (Vietnamese and others) and fold `đ`, which NFD does not decompose. */
export function normalizeTerm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const words = (text: string) => normalizeTerm(text).split(' ').filter(Boolean);

interface IndexedConcept {
  concept: Concept;
  /** Name, Vietnamese label and synonyms: the terms a person would type. */
  labels: string[];
  fields: string[];
  description: string;
}

const INDEX: IndexedConcept[] = CONCEPTS.map((concept) => ({
  concept,
  labels: [concept.name, concept.labelVi, concept.id.replace(/-/gu, ' '), ...concept.synonyms].map(
    normalizeTerm,
  ),
  fields: concept.fields.flatMap((field) => [normalizeTerm(field.name), normalizeTerm(field.description)]),
  description: normalizeTerm(concept.description),
}));

const containsPhrase = (haystack: string, phrase: string) => ` ${haystack} `.includes(` ${phrase} `);

function score(entry: IndexedConcept, phrase: string, tokens: string[]): number {
  let total = 0;
  for (const label of entry.labels) {
    if (label === phrase) total = Math.max(total, 100);
    else if (containsPhrase(label, phrase)) total = Math.max(total, 60);
  }
  if (entry.fields.some((field) => containsPhrase(field, phrase))) total += 15;
  if (containsPhrase(entry.description, phrase)) total += 10;
  // Partial credit for each query word, so multi-word queries still rank concepts that share most words.
  // Folded short words ("nó" -> "no", "là" -> "la") are too common to count outside labels.
  for (const token of tokens) {
    if (entry.labels.some((label) => containsPhrase(label, token))) total += 6;
    else if (token.length < 3) continue;
    else if (entry.fields.some((field) => containsPhrase(field, token))) total += 2;
    else if (containsPhrase(entry.description, token)) total += 1;
  }
  return total;
}

export interface TermMatch {
  concept: Concept;
  score: number;
}

/**
 * Accent-insensitive keyword search over names, Vietnamese labels, synonyms, descriptions and fields.
 * Exact label matches rank first; ties keep registry order.
 */
export function searchTerms(query: string, { limit = 10 }: { limit?: number } = {}): TermMatch[] {
  const phrase = normalizeTerm(query);
  if (!phrase) return [];
  const tokens = words(query);
  return INDEX.map((entry, order) => ({ concept: entry.concept, score: score(entry, phrase, tokens), order }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ concept, score }) => ({ concept, score }));
}

export function getTerm(id: string): Concept | undefined {
  return BY_ID.get(id);
}

export interface RelatedTerm {
  concept: Concept;
  relation: ConceptRelation;
  /** `out` when `id` declares the relation; `in` when the other concept declares it. */
  direction: 'out' | 'in';
}

/** Concepts linked to `id` by its own relations, by relations pointing at it, and by nesting. */
export function relatedTerms(id: string): RelatedTerm[] {
  const self = BY_ID.get(id);
  if (!self) return [];
  const related: RelatedTerm[] = [];
  const seen = new Set<string>();
  const add = (concept: Concept | undefined, relation: ConceptRelation, direction: 'out' | 'in') => {
    const key = `${direction}:${concept?.id}:${relation.kind}:${relation.via}`;
    if (!concept || seen.has(key)) return;
    seen.add(key);
    related.push({ concept, relation, direction });
  };
  for (const relation of self.relations) add(BY_ID.get(relation.to), relation, 'out');
  if (self.store.kind === 'nested')
    add(
      BY_ID.get(self.store.parent),
      { to: self.store.parent, kind: 'belongs-to', via: self.store.path },
      'out',
    );
  for (const other of CONCEPTS) {
    if (other.id === id) continue;
    for (const relation of other.relations) if (relation.to === id) add(other, relation, 'in');
    if (other.store.kind === 'nested' && other.store.parent === id)
      add(other, { to: id, kind: 'belongs-to', via: other.store.path }, 'in');
  }
  return related;
}

const pathOnly = (route: string) => {
  const bare = route.split(/[?#]/u)[0] ?? '';
  const trimmed = bare.length > 1 ? bare.replace(/\/+$/u, '') : bare;
  return trimmed || '/';
};

/** Whether a concrete path such as `/corpus/abc` fits a pattern such as `/corpus/:id`. */
export function matchPath(pattern: string, route: string): boolean {
  const want = pathOnly(pattern).split('/');
  const have = pathOnly(route).split('/');
  if (want.length !== have.length) return false;
  return want.every((part, index) => {
    const value = have[index] ?? '';
    return part.startsWith(':') ? value.length > 0 : part === value;
  });
}

/**
 * The page for a page id, a route pattern or a concrete path (query and hash are ignored). Literal routes win
 * over patterns, so `/papers` is the list and `/papers/abc` the paper.
 */
export function describePage(idOrPath: string): Page | undefined {
  const byId = PAGES.find((item) => item.id === idOrPath);
  if (byId) return byId;
  const route = pathOnly(idOrPath);
  return (
    PAGES.find((item) => item.path === route) ??
    PAGES.find((item) => item.path.includes(':') && matchPath(item.path, route))
  );
}

/** The pages that show, read or write a concept, in page-map order. */
export function pagesForConcept(conceptId: string): Page[] {
  return PAGES.filter(
    (item) =>
      item.shows.includes(conceptId) || item.reads.includes(conceptId) || item.writes.includes(conceptId),
  );
}

/** Version 2 added `pages` (step 2, the page map); version 3 the `data-table` store kind (passage index). */
export const SEMANTIC_REGISTRY_VERSION = 3;

/** A stable, JSON-safe export of the registry (registry order, no timestamps), for the MCP server. */
export function toJson() {
  return {
    format: 'paperlab-semantic-concepts',
    version: SEMANTIC_REGISTRY_VERSION,
    concepts: CONCEPTS.map((concept) => ({
      id: concept.id,
      name: concept.name,
      labelVi: concept.labelVi,
      description: concept.description,
      synonyms: [...concept.synonyms],
      store: { ...concept.store },
      fields: concept.fields.map((field) => ({ ...field })),
      relations: concept.relations.map((relation) => ({ ...relation })),
      schema: concept.schema ? { ...concept.schema } : null,
    })),
    pages: PAGES.map((item) => ({
      id: item.id,
      path: item.path,
      module: item.module,
      titleVi: item.titleVi,
      name: item.name,
      purpose: item.purpose,
      params: item.params.map((param) => ({ ...param })),
      query: item.query.map((param) => ({ ...param })),
      shows: [...item.shows],
      reads: [...item.reads],
      writes: [...item.writes],
      actions: item.actions.map((action) => ({
        labelVi: action.labelVi,
        effect: action.effect,
        writes: [...(action.writes ?? [])],
        ai: action.ai ?? false,
      })),
      requiresSignIn: item.requiresSignIn,
      parent: item.parent ?? null,
      tabs: (item.tabs ?? []).map((tab) => ({ ...tab })),
    })),
  };
}
