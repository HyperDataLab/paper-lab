import type { IndexableType, Table } from 'dexie';
import type { DocIndexField } from '@/core/storage/collections';
import type { ParagraphDb } from './db';
import {
  BufferedTx,
  docId,
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

/** Registry index fields that a Dexie index already answers, per collection. Others are filtered in memory. */
const NATIVE_INDEXES: Record<string, Partial<Record<DocIndexField, string>>> = {
  analyses: { sourceSha256: 'text.sourceHash' },
  auditEvents: { refId: 'analysisId' },
  revisions: { refId: 'sourceAnalysisId' },
  paperRuns: { paperId: 'paperId' },
  library: { doi: 'doi', paperId: 'paper_id' },
  corpora: { kind: 'kind' },
  reviewNgrams: { paperId: 'paperId' },
  topicNames: { refId: 'snapshotId' },
  autoresearchRuns: { projectId: 'projectId' },
};

/**
 * The DocStore port over this browser's Dexie tables, kept until the lab server takes over (slice C2).
 * IndexedDB keeps no versions, so they are counted in memory for this tab: a stored document starts at 1.
 * A unit of work runs inside one read-write Dexie transaction, so it cannot conflict with another tab.
 * Ids are the registry's `key`; the two compound Dexie keys are mapped from them.
 */
export class DexieDocStore implements DocStore {
  private readonly versions = new Map<string, number>();
  constructor(private readonly db: ParagraphDb) {}

  private table(collection: string): Table<unknown, IndexableType> {
    const table = this.db.tables.find((item) => item.name === collection);
    if (!table) throw new Error(`Unknown collection ${collection}`);
    return table as Table<unknown, IndexableType>;
  }
  /** The Dexie primary key for a registry id; compound keys are `paperId:hash` and `snapshotId:topicId`. */
  private key(collection: string, id: string): IndexableType {
    const at = id.indexOf(':');
    if (collection === 'reviewNgrams') return [id.slice(at + 1), id.slice(0, at)];
    if (collection === 'topicNames') {
      const last = id.lastIndexOf(':');
      return [id.slice(0, last), Number(id.slice(last + 1))];
    }
    return id;
  }
  private idOf(collection: string, doc: unknown) {
    return docId(collection, doc);
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
    const doc = await this.table(collection).get(this.key(collection, id));
    return doc === undefined ? null : { doc, version: this.versionOf(collection, id) };
  }
  async getMany(collection: string, ids: readonly string[]) {
    const docs = await this.table(collection).bulkGet(ids.map((id) => this.key(collection, id)));
    return docs.map((doc, index) =>
      doc === undefined ? null : { doc, version: this.versionOf(collection, ids[index]!) },
    );
  }
  async query(collection: string, query: DocQuery = {}): Promise<QueryRow[]> {
    const table = this.table(collection);
    const entries = Object.entries(query.where ?? {});
    const native = NATIVE_INDEXES[collection] ?? {};
    const indexed = entries.find(
      ([field, value]) => typeof value === 'string' && native[field as DocIndexField],
    );
    // With no filter, an indexed order and a limit are read straight from the index.
    if (
      !entries.length &&
      !query.whereIn &&
      query.orderBy &&
      query.limit !== undefined &&
      table.schema.idxByName[query.orderBy]
    ) {
      const ordered = table.orderBy(query.orderBy);
      const docs = await (query.desc ? ordered.reverse() : ordered).limit(query.limit).toArray();
      return selectRows(collection, this.rows(collection, docs), query);
    }
    // The native index already holds the equality it was looked up by (DOIs are stored normalised).
    const inIndex = query.whereIn && native[query.whereIn.field];
    const source =
      inIndex && query.whereIn
        ? table.where(inIndex).anyOf([...query.whereIn.values])
        : indexed
          ? table.where(native[indexed[0] as DocIndexField]!).equals(indexed[1] as string)
          : table.toCollection();
    if (inIndex && query.whereIn) {
      const docs = await source.filter((doc) => matchesWhere(collection, doc, query.where)).toArray();
      return selectRows(collection, this.rows(collection, docs), query);
    }
    const rest = Object.fromEntries(entries.filter((entry) => entry !== indexed));
    const docs = await source.filter((doc) => matchesWhere(collection, doc, rest, query.whereIn)).toArray();
    return selectRows(collection, this.rows(collection, docs), query);
  }
  private rows(collection: string, docs: unknown[]): QueryRow[] {
    return docs.map((doc) => {
      const id = this.idOf(collection, doc);
      return { id, doc, version: this.versionOf(collection, id) };
    });
  }
  private async checked(collection: string, id: string, expected: ExpectedVersion) {
    if (expected === undefined) return;
    const stored = await this.table(collection).get(this.key(collection, id));
    const current = stored === undefined ? null : this.versionOf(collection, id);
    if (versionMismatch(expected, current)) throw new StorageConflictError(collection, id, current);
  }
  private assertKey(collection: string, id: string, doc: unknown) {
    const key = this.idOf(collection, doc);
    if (key !== id) throw new Error(`${collection}: document key ${key} is not ${id}`);
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
      await table.delete(this.key(collection, id));
    });
    this.versions.delete(`${collection}\u0000${id}`);
  }
  async unitOfWork<R>(fn: (tx: DocTx) => Promise<R>): Promise<R> {
    const touched: { collection: string; id: string; removed: boolean }[] = [];
    const result = await this.db.transaction('rw', this.db.tables, async () => {
      const tx = new BufferedTx(this);
      const value = await fn(tx);
      for (const write of tx.writes.values()) {
        await this.checked(write.collection, write.id, write.expectedVersion);
        const table = this.table(write.collection);
        if (write.removed) await table.delete(this.key(write.collection, write.id));
        else {
          this.assertKey(write.collection, write.id, write.doc);
          await table.put(write.doc);
        }
        touched.push({ collection: write.collection, id: write.id, removed: write.removed });
      }
      return value;
    });
    for (const { collection, id, removed } of touched) {
      if (removed) this.versions.delete(`${collection}\u0000${id}`);
      else this.bump(collection, id);
    }
    return result;
  }
}
