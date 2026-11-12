import { CorpusSchema, type Corpus } from '../schemas/corpus';
import { sourceHash } from '../text/hash';

/** All identity and time inputs come from the caller. */
export function newCorpus(input: Pick<Corpus, 'id' | 'kind' | 'title' | 'createdAt' | 'protocol'>): Corpus {
  return CorpusSchema.parse({
    ...input,
    format: 'paperlab-corpus',
    schemaVersion: 1,
    updatedAt: input.createdAt,
    searches: [],
    members: [],
    runs: [],
    releases: [],
    aliases: [],
  });
}

export function exportIdOf(memberId: string): string {
  return `p${memberId}`;
}

/** Canonicalise JSON values recursively; callers choose which timestamps to exclude. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical digest requires JSON values');
}
export function canonicalDigest(value: unknown): Promise<string> {
  return sourceHash(canonical(value));
}
