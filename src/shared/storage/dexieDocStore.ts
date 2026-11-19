import type { Table } from 'dexie';
import type { ParagraphDb } from './db';
import {
  BufferedTx,
  matchesWhere,
  selectRows,
  versionMismatch,
  type DocQuery,
  type DocStore,
  type DocTx,
  type ExpectedVersion,
  type QueryRow,
  type Versioned,
} from './docStore';
import { StorageConflictError } from './errors';

/**
 * The DocStore port over this browser's Dexie tables, kept until the lab server takes over (slice C2).
 * IndexedDB keeps no versions, so they are counted in memory for this tab: a stored document starts at 1.
 * A unit of work runs inside one read-write Dexie transaction, so it cannot conflict with another tab.
 */
export class DexieDocStore implements DocStore {
  private readonly versions = new Map<string, number>();
  constructor(private readonly db: ParagraphDb) {}

  private table(collection: string): Table<unknown, unknown> {
    const table = this.db.tables.find((item) => item.name === collection);
    if (!table) throw new Error(`Unknown collection ${collection}`);
    return table as Table<unknown, unknown>;
  }
  private keyPath(collection: string) {
    const keyPath = this.table(collection).schema.primKey.keyPath;
    if (typeof keyPath !== 'string') throw new Error(`${collection} has a compound key`);
    return keyPath;
  }
  private versionOf(collection: string, id: string) {
    return this.versions.get(`${collection}\u0000${id}`) ?? 1;
  }
  private bump(collection: string, id: string) {
    const version = this.versionOf(collection, id) + 1;
    this.versions.set(`${collection}\u0000${id}`, version);
    return version;
  }
  async get(collection: string, id: string): Promise<Versioned | null> {
    const doc = await this.table(collection).get(id);
    return doc === undefined ? null : { doc, version: this.versionOf(collection, id) };
  }
  async getMany(collection: string, ids: readonly string[]) {
    const docs = await this.table(collection).bulkGet([...ids]);
    return docs.map((doc, index) =>
      doc === undefined ? null : { doc, version: this.versionOf(collection, ids[index]!) },
    );
  }
  async query(collection: string, query: DocQuery = {}): Promise<QueryRow[]> {
    const table = this.table(collection);
    const keyPath = this.keyPath(collection);
    const entries = Object.entries(query.where ?? {});
    const indexed = entries.find(
      ([field, value]) =>
        (typeof value === 'string' || typeof value === 'number') &&
        (field === keyPath || table.schema.idxByName[field]),
    );
    const source = indexed ? table.where(indexed[0]).equals(indexed[1] as string) : table.toCollection();
    const docs = await source.filter((doc) => matchesWhere(doc, query.where)).toArray();
    const rows = docs.map((doc) => {
      const id = String((doc as Record<string, unknown>)[keyPath]);
      return { id, doc, version: this.versionOf(collection, id) };
    });
    return selectRows(collection, rows, query);
  }
  private async checked(collection: string, id: string, expected: ExpectedVersion) {
    if (expected === undefined) return;
    const current =
      (await this.table(collection).get(id)) === undefined ? null : this.versionOf(collection, id);
    if (versionMismatch(expected, current)) throw new StorageConflictError(collection, id, current);
  }
  private assertKey(collection: string, id: string, doc: unknown) {
    const key = (doc as Record<string, unknown> | null)?.[this.keyPath(collection)];
    if (key !== id) throw new Error(`${collection}: document key ${String(key)} is not ${id}`);
  }
  async put(collection: string, id: string, doc: unknown, expectedVersion?: ExpectedVersion) {
    this.assertKey(collection, id, doc);
    const table = this.table(collection);
    if (expectedVersion === undefined) await table.put(doc);
    else
      await this.db.transaction('rw', table, async () => {
        await this.checked(collection, id, expectedVersion);
        await table.put(doc);
      });
    return this.bump(collection, id);
  }
  async remove(collection: string, id: string, expectedVersion?: ExpectedVersion) {
    const table = this.table(collection);
    await this.db.transaction('rw', table, async () => {
      await this.checked(collection, id, expectedVersion);
      await table.delete(id);
    });
    this.versions.delete(`${collection}\u0000${id}`);
  }
  async unitOfWork<R>(fn: (tx: DocTx) => Promise<R>): Promise<R> {
    const touched: string[][] = [];
    const result = await this.db.transaction('rw', this.db.tables, async () => {
      const tx = new BufferedTx(this);
      const value = await fn(tx);
      for (const write of tx.writes.values()) {
        await this.checked(write.collection, write.id, write.expectedVersion);
        const table = this.table(write.collection);
        if (write.removed) await table.delete(write.id);
        else {
          this.assertKey(write.collection, write.id, write.doc);
          await table.put(write.doc);
        }
        touched.push([write.collection, write.id, write.removed ? 'removed' : 'put']);
      }
      return value;
    });
    for (const [collection, id, kind] of touched) {
      if (kind === 'removed') this.versions.delete(`${collection!}\u0000${id!}`);
      else this.bump(collection!, id!);
    }
    return result;
  }
}
