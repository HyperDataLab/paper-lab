import type { EMBEDDING_MODEL } from '../kg/bindings';
import type { PassageVectorIndex, PassageVectorMetadata } from './bindings';

const DIMENSIONS = 768;
const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 2)
    .map((token) => token.replace(/(?:ing|ed|s)$/u, ''));

/** A deterministic bag-of-words embedding: texts that share words are close in cosine. */
export function fakeEmbedding(text: string) {
  const values = new Array<number>(DIMENSIONS).fill(0);
  for (const token of tokens(text)) {
    let hash = 0;
    for (const char of token) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    values[hash % DIMENSIONS] = (values[hash % DIMENSIONS] ?? 0) + 1;
  }
  const norm = Math.hypot(...values) || 1;
  return values.map((value) => value / norm);
}

/** A Workers AI stand-in that records every embedded text. */
export function fakeAi() {
  const calls: string[][] = [];
  return {
    calls,
    async run(_model: typeof EMBEDDING_MODEL, input: { text: string[] }) {
      calls.push(input.text);
      return { data: input.text.map(fakeEmbedding) };
    },
  };
}

type Filter = Parameters<PassageVectorIndex['query']>[1]['filter'];

function matches(metadata: PassageVectorMetadata, filter: Filter) {
  return Object.entries(filter ?? {}).every(([key, condition]) => {
    const value = metadata[key as keyof PassageVectorMetadata];
    if (typeof condition === 'string') return value === condition;
    if ('$eq' in condition) return value === condition.$eq;
    return condition.$in.includes(value);
  });
}

/** An in-memory Vectorize index. `ignoreFilters` simulates a missing metadata index, to test the D1 guard. */
export function fakeVectors(options: { ignoreFilters?: boolean } = {}) {
  const stored = new Map<string, { values: number[]; metadata: PassageVectorMetadata }>();
  const queries: Filter[] = [];
  const index: PassageVectorIndex = {
    async upsert(vectors) {
      for (const vector of vectors) {
        if (new TextEncoder().encode(vector.id).byteLength > 64) throw new Error('Vector id too long');
        stored.set(vector.id, { values: vector.values, metadata: vector.metadata });
      }
    },
    async deleteByIds(ids) {
      for (const id of ids) stored.delete(id);
    },
    async query(vector, { topK, filter }) {
      queries.push(filter);
      const scored = [...stored.entries()]
        .filter(([, value]) => options.ignoreFilters || matches(value.metadata, filter))
        .map(([id, value]) => ({
          id,
          score: value.values.reduce((sum, item, i) => sum + item * (vector[i] ?? 0), 0),
        }))
        .sort((a, b) => b.score - a.score);
      return { matches: scored.slice(0, topK) };
    },
  };
  return { index, stored, queries };
}
