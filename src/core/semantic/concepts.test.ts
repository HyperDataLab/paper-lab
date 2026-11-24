import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { KG_EDGE_TABLES, KG_NODE_TABLES } from '../schemas/labKg';
import { COLLECTION_NAMES, COLLECTIONS } from '../storage/collections';
import { CONCEPTS, type Concept } from './concepts';
import { getTerm, normalizeTerm, relatedTerms, searchTerms, toJson } from './index';

// --- zod v4 introspection -----------------------------------------------------------------------------------

type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  options?: z.ZodType[];
  innerType?: z.ZodType;
  in?: z.ZodType;
  left?: z.ZodType;
  right?: z.ZodType;
  valueType?: z.ZodType;
};
const defOf = (schema: z.ZodType) => (schema as unknown as { def: Def }).def;
const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']);

/** The object schemas a node can be: wrappers, arrays, records, unions and intersections are looked through. */
function objectsOf(schema: z.ZodType): Record<string, z.ZodType>[] {
  const def = defOf(schema);
  if (WRAPPERS.has(def.type) && def.innerType) return objectsOf(def.innerType);
  if (def.type === 'pipe' && def.in) return objectsOf(def.in);
  if (def.type === 'array' && def.element) return objectsOf(def.element);
  if (def.type === 'record' && def.valueType) return objectsOf(def.valueType);
  if ((def.type === 'union' || def.type === 'discriminatedUnion') && def.options)
    return def.options.flatMap(objectsOf);
  if (def.type === 'intersection' && def.left && def.right)
    return [...objectsOf(def.left), ...objectsOf(def.right)];
  if (def.type === 'object' && def.shape) return [def.shape];
  // `lazy` is never entered: the schemas that use it are recursive.
  return [];
}

/** Follow a dotted path (`[]` markers are optional); a key passes when at least one union option has it. */
function resolve(schemas: z.ZodType[], path: string): z.ZodType[] {
  let nodes = schemas;
  for (const key of path.replace(/\[\]/gu, '').split('.').filter(Boolean))
    nodes = nodes
      .flatMap(objectsOf)
      .flatMap((shape) => (Object.hasOwn(shape, key) && shape[key] ? [shape[key]] : []));
  return nodes;
}

const byId = new Map(CONCEPTS.map((concept) => [concept.id, concept]));

/** The schema nodes of a concept, found by walking from its central collection along the nesting paths. */
function nodesOf(concept: Concept): z.ZodType[] {
  const store = concept.store;
  if (store.kind === 'central') return [COLLECTIONS[store.collection].schema];
  if (store.kind !== 'nested') return [];
  const parent = byId.get(store.parent);
  return parent ? resolve(nodesOf(parent), store.path) : [];
}

// --- KG migrations ---------------------------------------------------------------------------------------------

function migrationTables(migrations: Record<string, unknown>) {
  const tables = new Map<string, Set<string>>();
  for (const sql of Object.values(migrations) as string[])
    for (const match of sql.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\)(?: WITHOUT ROWID)?;/gu)) {
      const [, table = '', body = ''] = match;
      const columns = body
        .split(/,\s*(?![^()]*\))/u)
        .map((part) => /^\s*(\w+)\s/u.exec(part)?.[1])
        .filter(
          (name): name is string => !!name && !['PRIMARY', 'FOREIGN', 'CHECK', 'UNIQUE'].includes(name),
        );
      tables.set(table, new Set(columns));
    }
  return tables;
}
const KG_TABLES = migrationTables(
  import.meta.glob('/worker/migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
);
/** Tables of the central store's D1, for `data-table` concepts (the passage index). */
const DATA_TABLES = migrationTables(
  import.meta.glob('/worker/migrations-data/*.sql', { query: '?raw', import: 'default', eager: true }),
);

const schemaModules = import.meta.glob(['/src/core/**/*.ts', '!/src/core/**/*.test.ts']);

// --- registry ------------------------------------------------------------------------------------------------

describe('semantic concept registry', () => {
  it('has unique ids', () => {
    const ids = CONCEPTS.map((concept) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has exactly one concept for every central store collection', () => {
    for (const name of COLLECTION_NAMES) {
      const owners = CONCEPTS.filter((c) => c.store.kind === 'central' && c.store.collection === name);
      expect(
        owners.map((c) => c.id),
        name,
      ).toHaveLength(1);
    }
  });

  it('resolves every nested path in the real zod schema', () => {
    for (const concept of CONCEPTS.filter((c) => c.store.kind === 'nested'))
      expect(nodesOf(concept).length, concept.id).toBeGreaterThan(0);
  });

  it('lists only fields that exist in the zod schema (in at least one union option)', () => {
    const missing: string[] = [];
    for (const concept of CONCEPTS) {
      if (concept.store.kind !== 'central' && concept.store.kind !== 'nested') continue;
      const nodes = nodesOf(concept);
      for (const field of concept.fields)
        if (resolve(nodes, field.name).length === 0) missing.push(`${concept.id}.${field.name}`);
    }
    expect(missing).toEqual([]);
  });

  it('points schema references at exported zod schemas', async () => {
    for (const concept of CONCEPTS) {
      if (!concept.schema) continue;
      const load = schemaModules[`/${concept.schema.file}`];
      expect(load, `${concept.id}: ${concept.schema.file}`).toBeDefined();
      const module = (await load?.()) as Record<string, unknown>;
      const ref = module[concept.schema.export];
      expect(ref, `${concept.id}: ${concept.schema.export}`).toBeInstanceOf(z.ZodType);
      if (!(ref instanceof z.ZodType)) continue;
      if (concept.store.kind === 'central') {
        // The collection schema itself, or one option of it (`paperRuns`, `reviewNgrams`).
        const schema = COLLECTIONS[concept.store.collection].schema;
        const def = defOf(schema);
        const options = [schema, ...(def.type === 'union' && def.options ? def.options : [])];
        expect(options.includes(ref), `${concept.id}: ${concept.schema.export}`).toBe(true);
      } else {
        const missing = concept.fields.filter((field) => resolve([ref], field.name).length === 0);
        expect(missing, `${concept.id}: ${concept.schema.export}`).toEqual([]);
      }
    }
  });

  it('maps every KG concept to a migration table and its real columns', () => {
    for (const concept of CONCEPTS) {
      if (concept.store.kind !== 'kg') continue;
      const columns = KG_TABLES.get(concept.store.table);
      expect(columns, concept.id).toBeDefined();
      for (const field of concept.fields)
        expect(columns?.has(field.name), `${concept.id}.${field.name}`).toBe(true);
    }
  });

  it('maps every data-table concept to a central store migration table and its real columns', () => {
    const concepts = CONCEPTS.filter((c) => c.store.kind === 'data-table');
    expect(concepts.map((c) => c.id)).toContain('passage');
    for (const concept of concepts) {
      if (concept.store.kind !== 'data-table') continue;
      const columns = DATA_TABLES.get(concept.store.table);
      expect(columns, concept.id).toBeDefined();
      for (const field of concept.fields)
        expect(columns?.has(field.name), `${concept.id}.${field.name}`).toBe(true);
    }
  });

  it('covers every KG node and edge table', () => {
    const tables = new Set(CONCEPTS.flatMap((c) => (c.store.kind === 'kg' ? [c.store.table] : [])));
    for (const table of [...KG_NODE_TABLES, ...KG_EDGE_TABLES]) expect(tables.has(table), table).toBe(true);
  });

  it('gives every relation an existing target and a real `via`', () => {
    const bad: string[] = [];
    for (const concept of CONCEPTS)
      for (const relation of concept.relations) {
        if (!byId.has(relation.to)) bad.push(`${concept.id} -> ${relation.to}`);
        const store = concept.store;
        const viaOk =
          store.kind === 'kg'
            ? (KG_TABLES.get(store.table)?.has(relation.via) ?? false) || KG_TABLES.has(relation.via)
            : store.kind === 'data-table'
              ? (DATA_TABLES.get(store.table)?.has(relation.via) ?? false)
              : store.kind === 'r2' || resolve(nodesOf(concept), relation.via).length > 0;
        if (!viaOk) bad.push(`${concept.id} via ${relation.via}`);
      }
    expect(bad).toEqual([]);
  });

  it('points nested concepts at existing parents', () => {
    for (const concept of CONCEPTS)
      if (concept.store.kind === 'nested') expect(byId.has(concept.store.parent), concept.id).toBe(true);
  });

  it('fills in the required text of every concept', () => {
    for (const concept of CONCEPTS) {
      expect(concept.name.trim(), concept.id).not.toBe('');
      expect(concept.labelVi.trim(), concept.id).not.toBe('');
      expect(concept.description.trim(), concept.id).not.toBe('');
      expect(concept.synonyms.length, concept.id).toBeGreaterThan(0);
    }
  });
});

// --- helpers -------------------------------------------------------------------------------------------------

describe('semantic helpers', () => {
  const top = (query: string) => searchTerms(query, { limit: 3 })[0]?.concept.id;

  it('folds Vietnamese diacritics, including đ', () => {
    expect(normalizeTerm('Đoạn văn')).toBe('doan van');
    expect(normalizeTerm('khoảng  trống, nghiên cứu')).toBe('khoang trong nghien cuu');
  });

  it('finds Paragraph for "đoạn văn", with or without accents', () => {
    expect(top('đoạn văn')).toBe('paragraph');
    expect(top('doan van')).toBe('paragraph');
    expect(top('Paragraph')).toBe('paragraph');
  });

  it('finds the Research question (which owns `gap`) for research gap queries', () => {
    expect(top('khoảng trống nghiên cứu')).toBe('research-question');
    expect(top('research gap')).toBe('research-question');
    expect(top('Research Gap')).toBe('research-question');
  });

  it('finds the screening decision for "sàng lọc"', () => {
    expect(top('sàng lọc')).toBe('screening-decision');
    expect(top('screening')).toBe('screening-decision');
  });

  it('finds KG concepts and respects the limit', () => {
    expect(top('trích dẫn')).toBeDefined();
    expect(top('citation graph')).toBe('kg-cites');
    expect(searchTerms('paper', { limit: 2 })).toHaveLength(2);
    expect(searchTerms('   ')).toEqual([]);
    expect(searchTerms('zzzqqq')).toEqual([]);
    // Folded short words such as "no" (from "nó") do not match descriptions.
    expect(searchTerms('zzzz no such term')).toEqual([]);
  });

  it('gets a term by id', () => {
    expect(getTerm('corpus-member')?.name).toBe('Corpus member');
    expect(getTerm('nope')).toBeUndefined();
  });

  it('lists related terms in both directions and through nesting', () => {
    const member = relatedTerms('corpus-member');
    const ids = (dir: 'in' | 'out') => member.filter((r) => r.direction === dir).map((r) => r.concept.id);
    expect(ids('out')).toEqual(expect.arrayContaining(['kg-paper', 'screening-decision', 'corpus']));
    expect(ids('in')).toEqual(expect.arrayContaining(['corpus', 'screening-decision']));
    expect(
      member.some(
        (r) =>
          r.concept.id === 'kg-paper' &&
          r.relation.kind === 'refers-to' &&
          r.relation.via === 'identifiers.doi',
      ),
    ).toBe(true);
    expect(relatedTerms('nope')).toEqual([]);
  });

  it('exports stable JSON', () => {
    const json = toJson();
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(toJson()).toEqual(json);
    expect(json.concepts.map((c) => c.id)).toEqual(CONCEPTS.map((c) => c.id));
    expect(JSON.stringify(json)).not.toMatch(/"def"/u);
  });
});
