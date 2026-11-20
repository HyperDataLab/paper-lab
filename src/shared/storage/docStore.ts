import {
  COLLECTIONS,
  docSummary,
  type CollectionDef,
  type DocIndex,
  type DocIndexField,
} from '@/core/storage/collections';
import { StorageConflictError } from './errors';

/**
 * The storage port every repository is written against. Documents are plain JSON-like values; repositories parse
 * them with the collection's schema. `version` counts writes to one document and guards against lost updates.
 * Collections, ids, index fields and summaries come from the central store's registry (core/storage/collections).
 */
export interface Versioned {
  doc: unknown;
  version: number;
}
export interface QueryRow extends Versioned {
  id: string;
}
export interface DocQuery {
  /** Equality on the collection's index projection (`COLLECTIONS[col].index`), as the lab server filters. */
  where?: Partial<Record<DocIndexField, string | null>>;
  whereIn?: { field: DocIndexField; values: readonly string[] };
  /** A field of the body to order by; rows with equal values keep id order. */
  orderBy?: string;
  desc?: boolean;
  limit?: number;
  /** `summary` returns the registry's summary (small top-level scalars plus the collection's extras). */
  select?: 'full' | 'summary';
}
/** `undefined`: let the store resolve the version. `null`: create only. A number: require that version. */
export type ExpectedVersion = number | null | undefined;

export interface DocReader {
  get(collection: string, id: string): Promise<Versioned | null>;
  getMany(collection: string, ids: readonly string[]): Promise<(Versioned | null)[]>;
  query(collection: string, query?: DocQuery): Promise<QueryRow[]>;
}
export interface DocWriter {
  /** Writes a document and returns its new version. */
  put(collection: string, id: string, doc: unknown, expectedVersion?: ExpectedVersion): Promise<number>;
  remove(collection: string, id: string, expectedVersion?: ExpectedVersion): Promise<void>;
}
export type DocTx = DocReader &
  DocWriter & {
    /** Audit attached to the transaction's owning collection. */
    appendAudit?: (id: string, doc: unknown) => Promise<void>;
  };
export interface DocStore extends DocTx {
  /** Accepts a hot checkpoint in memory. Use flush to await persistence. */
  checkpoint?<T>(collection: string, id: string, update: (current: unknown) => T): Promise<T>;
  flush?(collection?: string, id?: string): Promise<void>;
  /**
   * Runs `fn` with tracked reads and buffered writes, then commits every write at once. A read document that
   * changed in the meantime is a conflict: `fn` runs once more, and a second conflict throws StorageConflictError.
   * Declare the collections for transactions routed to the lab. Other transactions default to the browser.
   */
  unitOfWork<R>(fn: (tx: DocTx) => Promise<R>, collections?: readonly string[]): Promise<R>;
}

export function collectionDef(name: string): CollectionDef | undefined {
  return Object.hasOwn(COLLECTIONS, name) ? (COLLECTIONS as Record<string, CollectionDef>)[name] : undefined;
}

/** Keys of the browser-only tables the central store leaves out (pdfFiles, corpusSync). */
const LOCAL_KEYS: Record<string, string> = { pdfFiles: 'sha256', corpusSync: 'id' };

export function pathValue(doc: unknown, path: string): unknown {
  let value: unknown = doc;
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** The document's id in its collection, from the registry's `key`. */
export function docId(collection: string, doc: unknown) {
  const def = collectionDef(collection);
  return def ? def.key(doc) : String(pathValue(doc, LOCAL_KEYS[collection] ?? 'id'));
}

export function docIndex(collection: string, doc: unknown): DocIndex {
  try {
    return collectionDef(collection)?.index(doc) ?? {};
  } catch {
    return {};
  }
}

export function matchesWhere(
  collection: string,
  doc: unknown,
  where: DocQuery['where'],
  whereIn?: DocQuery['whereIn'],
) {
  if (!where && !whereIn) return true;
  const index = docIndex(collection, doc);
  const value = whereIn && index[whereIn.field];
  return (
    (!whereIn || (typeof value === 'string' && whereIn.values.includes(value))) &&
    Object.entries(where ?? {}).every(
      ([field, expected]) => (index[field as DocIndexField] ?? null) === expected,
    )
  );
}

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

/** Orders rows by `orderBy`, then by id, as an IndexedDB index does; `desc` reverses the whole order. */
export function orderRows<T extends QueryRow>(rows: T[], query: DocQuery = {}) {
  const sorted = [...rows].sort(
    (a, b) =>
      (query.orderBy ? compare(pathValue(a.doc, query.orderBy), pathValue(b.doc, query.orderBy)) : 0) ||
      compare(a.id, b.id),
  );
  if (query.desc) sorted.reverse();
  return query.limit === undefined ? sorted : sorted.slice(0, query.limit);
}

export function summarize(collection: string, doc: unknown) {
  const def = collectionDef(collection);
  return def ? docSummary(def, doc) : doc;
}

export function selectRows(collection: string, rows: QueryRow[], query: DocQuery = {}) {
  const ordered = orderRows(rows, query);
  return query.select === 'summary'
    ? ordered.map((row) => ({ ...row, doc: summarize(collection, row.doc) }))
    : ordered;
}

export const keyOf = (collection: string, id: string) => `${collection}\u0000${id}`;

type BufferedWrite = {
  collection: string;
  id: string;
  doc: unknown;
  removed: boolean;
  expectedVersion: ExpectedVersion;
  version: number;
};
type QueryRead = { collection: string; query: DocQuery; rows: { id: string; version: number }[] };

const signatureOf = (rows: Pick<QueryRow, 'id' | 'version'>[]) =>
  JSON.stringify(rows.map(({ id, version }) => [id, version]));

/** A unit of work over a committed store: reads are recorded, writes wait in a buffer until commit. */
export class BufferedTx implements DocTx {
  readonly reads = new Map<string, { collection: string; id: string; version: number | null }>();
  readonly queries: QueryRead[] = [];
  readonly writes = new Map<string, BufferedWrite>();
  constructor(private readonly base: DocReader) {}

  private record(collection: string, id: string, version: number | null) {
    const key = keyOf(collection, id);
    if (!this.reads.has(key) && !this.writes.has(key)) this.reads.set(key, { collection, id, version });
  }
  private buffered(collection: string, id: string): Versioned | null | undefined {
    const write = this.writes.get(keyOf(collection, id));
    if (!write) return undefined;
    return write.removed ? null : { doc: write.doc, version: write.version };
  }
  async get(collection: string, id: string) {
    const buffered = this.buffered(collection, id);
    if (buffered !== undefined) return buffered;
    const row = await this.base.get(collection, id);
    this.record(collection, id, row?.version ?? null);
    return row;
  }
  async getMany(collection: string, ids: readonly string[]) {
    const missing = ids.filter((id) => this.buffered(collection, id) === undefined);
    const rows = await this.base.getMany(collection, missing);
    const byId = new Map(missing.map((id, index) => [id, rows[index] ?? null]));
    return ids.map((id) => {
      const buffered = this.buffered(collection, id);
      if (buffered !== undefined) return buffered;
      const row = byId.get(id) ?? null;
      this.record(collection, id, row?.version ?? null);
      return row;
    });
  }
  async query(collection: string, query: DocQuery = {}) {
    // The whole query goes to the store unless buffered writes to this collection must be merged in first.
    const buffered = [...this.writes.values()].some((write) => write.collection === collection);
    const read: DocQuery = buffered ? { where: query.where, whereIn: query.whereIn } : query;
    const committed = await this.base.query(collection, read);
    this.queries.push({
      collection,
      query: read,
      rows: committed.map(({ id, version }) => ({ id, version })),
    });
    for (const row of committed) this.record(collection, row.id, row.version);
    if (!buffered) return committed;
    const rows = new Map(committed.map((row) => [row.id, row]));
    for (const write of this.writes.values()) {
      if (write.collection !== collection) continue;
      if (write.removed || !matchesWhere(collection, write.doc, query.where, query.whereIn))
        rows.delete(write.id);
      else rows.set(write.id, { id: write.id, doc: write.doc, version: write.version });
    }
    return selectRows(collection, [...rows.values()], query);
  }
  private currentVersion(collection: string, id: string) {
    const key = keyOf(collection, id);
    const write = this.writes.get(key);
    if (write) return write.removed ? 0 : write.version;
    return this.reads.get(key)?.version ?? 0;
  }
  put(collection: string, id: string, doc: unknown, expectedVersion?: ExpectedVersion) {
    const version = this.currentVersion(collection, id) + 1;
    this.buffer({ collection, id, doc, removed: false, expectedVersion, version });
    return Promise.resolve(version);
  }
  remove(collection: string, id: string, expectedVersion?: ExpectedVersion) {
    this.buffer({ collection, id, doc: undefined, removed: true, expectedVersion, version: 0 });
    return Promise.resolve();
  }
  private buffer(write: BufferedWrite) {
    const key = keyOf(write.collection, write.id);
    const previous = this.writes.get(key);
    // Only the first write's guard refers to the stored document; later writes build on the buffer.
    this.writes.set(key, previous ? { ...write, expectedVersion: previous.expectedVersion } : write);
  }
}

export function versionMismatch(expected: ExpectedVersion, current: number | null) {
  if (expected === undefined) return false;
  return expected === null ? current !== null : current !== expected;
}

/** In-memory store for tests, with the same conflict rules as the lab server. */
export class MemoryDocStore implements DocStore {
  private readonly data = new Map<string, Map<string, Versioned>>();

  private table(collection: string) {
    let table = this.data.get(collection);
    if (!table) this.data.set(collection, (table = new Map()));
    return table;
  }
  private copy<T>(value: T): T {
    return structuredClone(value);
  }
  get(collection: string, id: string) {
    const row = this.table(collection).get(id);
    return Promise.resolve(row ? { doc: this.copy(row.doc), version: row.version } : null);
  }
  async getMany(collection: string, ids: readonly string[]) {
    return Promise.all(ids.map((id) => this.get(collection, id)));
  }
  private rows(collection: string, { where, whereIn }: DocQuery) {
    return [...this.table(collection)]
      .filter(([, row]) => matchesWhere(collection, row.doc, where, whereIn))
      .map(([id, row]) => ({ id, doc: this.copy(row.doc), version: row.version }));
  }
  query(collection: string, query: DocQuery = {}) {
    return Promise.resolve(selectRows(collection, this.rows(collection, query), query));
  }
  private check(collection: string, id: string, expected: ExpectedVersion) {
    const current = this.table(collection).get(id)?.version ?? null;
    if (versionMismatch(expected, current)) throw new StorageConflictError(collection, id, current);
  }
  put(collection: string, id: string, doc: unknown, expectedVersion?: ExpectedVersion) {
    try {
      this.check(collection, id, expectedVersion);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    return Promise.resolve(this.write(collection, id, doc));
  }
  remove(collection: string, id: string, expectedVersion?: ExpectedVersion) {
    try {
      this.check(collection, id, expectedVersion);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    this.table(collection).delete(id);
    return Promise.resolve();
  }
  private write(collection: string, id: string, doc: unknown) {
    const table = this.table(collection);
    if (docId(collection, doc) !== id) throw new Error(`${collection}: document key is not ${id}`);
    const version = (table.get(id)?.version ?? 0) + 1;
    table.set(id, { doc: this.copy(doc), version });
    return version;
  }
  /** Checks the read set and every guard, then applies all writes; nothing is applied on a conflict. */
  private commit(tx: BufferedTx) {
    for (const read of tx.reads.values()) {
      const current = this.table(read.collection).get(read.id)?.version ?? null;
      if (current !== read.version) throw new StorageConflictError(read.collection, read.id, current);
    }
    for (const read of tx.queries) {
      const rows = selectRows(read.collection, this.rows(read.collection, read.query), read.query);
      if (signatureOf(rows) !== signatureOf(read.rows))
        throw new StorageConflictError(read.collection, '', null);
    }
    for (const write of tx.writes.values()) this.check(write.collection, write.id, write.expectedVersion);
    const touched = new Set([...tx.writes.values()].map((write) => write.collection));
    const backup = new Map([...touched].map((collection) => [collection, new Map(this.table(collection))]));
    try {
      for (const write of tx.writes.values()) {
        if (write.removed) this.table(write.collection).delete(write.id);
        else this.write(write.collection, write.id, write.doc);
      }
    } catch (error) {
      for (const [collection, table] of backup) this.data.set(collection, table);
      throw error;
    }
  }
  async unitOfWork<R>(fn: (tx: DocTx) => Promise<R>): Promise<R> {
    for (let attempt = 0; ; attempt++) {
      const tx = new BufferedTx(this);
      const result = await fn(tx);
      try {
        this.commit(tx);
        return result;
      } catch (error) {
        if (!(error instanceof StorageConflictError) || attempt > 0) throw error;
      }
    }
  }
}
