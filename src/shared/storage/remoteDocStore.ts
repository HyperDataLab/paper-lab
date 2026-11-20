import { CheckpointQueue } from './checkpointQueue';
import {
  BufferedTx,
  keyOf,
  type DocQuery,
  type DocStore,
  type DocTx,
  type QueryRow,
  type Versioned,
} from './docStore';
import { StorageConflictError } from './errors';
import { RemoteDataClient, type DocRef, type RemoteDataOptions } from './remoteDataClient';

const PAGE_SIZE = 100;

function filters(query: DocQuery) {
  return { where: query.where, whereIn: query.whereIn, orderBy: query.orderBy ?? 'id', desc: query.desc };
}

export class RemoteDocStore implements DocStore {
  private readonly api: RemoteDataClient;
  private readonly cache = new Map<string, Versioned | null>();
  private readonly checkpoints = new CheckpointQueue(
    (collection, id) => this.readForWrite(collection, id),
    (collection, id, expected, snapshot, onSend) => this.write(collection, id, snapshot, expected, onSend),
  );

  constructor(options: RemoteDataOptions) {
    this.api = new RemoteDataClient(options);
  }

  getSaveStatus = this.checkpoints.getStatus;
  subscribe = this.checkpoints.subscribe;

  checkpoint<T>(collection: string, id: string, update: (current: unknown) => T) {
    return this.checkpoints.checkpoint(collection, id, update);
  }

  flush(collection?: string, id?: string) {
    return this.checkpoints.flush(collection, id);
  }

  async discard(collection: string, id: string) {
    await this.checkpoints.discard(collection, id);
    this.cache.delete(keyOf(collection, id));
  }

  async get(collection: string, id: string) {
    const key = keyOf(collection, id);
    const cached = this.cache.get(key);
    const row = await this.api.get(collection, id, cached?.version);
    if (row === undefined) return structuredClone(cached ?? null);
    if (row || this.cache.get(key) === cached) this.remember(collection, id, row);
    return structuredClone(row);
  }

  async getMany(collection: string, ids: readonly string[]) {
    const found = new Map<string, Versioned>();
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += PAGE_SIZE) {
      let pending = unique.slice(start, start + PAGE_SIZE);
      while (pending.length) {
        const page = await this.api.batch(collection, pending);
        for (const { id, body, version } of page.items) {
          const row = this.bodyRow(collection, id, body, version);
          found.set(id, row);
        }
        // A missing batch row can race a newer GET or PUT, so it leaves the cache alone.
        pending = page.deferred;
      }
    }
    return ids.map((id) => structuredClone(found.get(id) ?? null));
  }

  async getBatch(refs: DocRef[]) {
    const found = new Map<string, Versioned>();
    const unique = [...new Map(refs.map((ref) => [keyOf(ref.collection, ref.id), ref])).values()];
    for (let start = 0; start < unique.length; start += PAGE_SIZE) {
      let pending = unique.slice(start, start + PAGE_SIZE);
      while (pending.length) {
        const page = await this.api.batchRefs(pending);
        for (const { collection, id, body, version } of page.items)
          found.set(keyOf(collection, id), this.bodyRow(collection, id, body, version));
        pending = page.deferred;
      }
    }
    return refs.map(({ collection, id }) => structuredClone(found.get(keyOf(collection, id)) ?? null));
  }

  async query(collection: string, query: DocQuery = {}) {
    const rows: QueryRow[] = [];
    let cursor: string | null = null;
    const max = query.limit ?? Infinity;
    while (rows.length < max) {
      const summary = query.select === 'summary';
      const page = await this.api.query({
        collection,
        ...filters(query),
        limit: Math.min(PAGE_SIZE, max - rows.length),
        cursor,
        include: summary ? 'summary' : 'body',
      });
      for (const item of page.items) {
        const row = summary
          ? { version: item.version, doc: item.summary }
          : this.bodyRow(collection, item.id, item.body, item.version);
        rows.push({ id: item.id, ...row });
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return rows;
  }

  private bodyRow(collection: string, id: string, doc: unknown, version: number) {
    if (doc === undefined || doc === null) throw new Error(`Missing document body for ${collection}/${id}`);
    const row = { doc, version };
    this.remember(collection, id, row);
    return row;
  }

  private remember(collection: string, id: string, row: Versioned | null) {
    const key = keyOf(collection, id);
    const previous = this.cache.get(key);
    if (!row || !previous || row.version >= previous.version) this.cache.set(key, structuredClone(row));
  }

  cachedVersion(collection: string, id: string) {
    const row = this.cache.get(keyOf(collection, id));
    return row && { doc: structuredClone(row.doc), version: row.version };
  }

  private readForWrite(collection: string, id: string) {
    const cached = this.cache.get(keyOf(collection, id));
    return cached === undefined ? this.get(collection, id) : Promise.resolve(cached);
  }

  async put(collection: string, id: string, doc: unknown, expected?: number | null) {
    const snapshot = structuredClone(doc);
    await this.flush(collection, id);
    return this.write(collection, id, () => snapshot, expected);
  }

  private async write(
    collection: string,
    id: string,
    snapshot: () => unknown,
    expected?: number | null,
    onSend?: () => void,
  ) {
    const base =
      expected === undefined ? ((await this.readForWrite(collection, id))?.version ?? null) : expected;
    let sent: unknown;
    const version = await this.api.put(collection, id, () => (sent = snapshot()), base, onSend);
    this.remember(collection, id, { doc: sent, version });
    return version;
  }

  async remove(collection: string, id: string, expected?: number | null) {
    await this.flush(collection, id);
    const base =
      expected === undefined ? ((await this.readForWrite(collection, id))?.version ?? null) : expected;
    if (base === null) {
      await this.unitOfWork(async (tx) => {
        await tx.remove(collection, id, null);
      });
      return;
    }
    await this.api.remove(collection, id, base);
    this.remember(collection, id, null);
  }

  async unitOfWork<R>(fn: (tx: DocTx) => Promise<R>): Promise<R> {
    const blindVersions = new Map<string, number | null>();
    for (let attempt = 0; ; attempt++) {
      const audit: { collection: string; id: string; body: unknown }[] = [];
      const tx = new BufferedTx({
        get: async (collection, id) => {
          await this.flush(collection, id);
          return this.get(collection, id);
        },
        getMany: async (collection, ids) => {
          await Promise.all(ids.map((id) => this.flush(collection, id)));
          return this.getMany(collection, ids);
        },
        query: async (collection, query) => {
          await this.flush(collection);
          return this.query(collection, query);
        },
      });
      const result = await fn({
        get: tx.get.bind(tx),
        getMany: tx.getMany.bind(tx),
        query: tx.query.bind(tx),
        put: tx.put.bind(tx),
        remove: tx.remove.bind(tx),
        appendAudit: async (id, body) => {
          audit.push({ collection: 'auditEvents', id, body });
        },
      });
      try {
        await this.commit(tx, audit, blindVersions);
        return result;
      } catch (error) {
        if (!(error instanceof StorageConflictError) || attempt > 0) throw error;
      }
    }
  }

  private async commit(
    tx: BufferedTx,
    audit: { collection: string; id: string; body: unknown }[],
    blindVersions: Map<string, number | null>,
  ) {
    const guards = new Map(
      [...tx.reads].map(([key, { collection, id, version }]) => [
        key,
        { collection, id, expectedVersion: version },
      ]),
    );
    const queryGuards = tx.queries.map(({ collection, query, rows }) => {
      for (const { id, version } of rows) {
        const key = keyOf(collection, id);
        if (guards.get(key)?.expectedVersion === version) guards.delete(key);
      }
      return {
        collection,
        ...filters(query),
        limit: query.limit,
        rows: rows.map(({ id, version }) => [id, version]),
      };
    });
    const ops = [];
    for (const [key, write] of tx.writes) {
      const { collection, id, removed, doc } = write;
      await this.flush(collection, id);
      const read = tx.reads.get(key);
      let expectedVersion = write.expectedVersion;
      if (expectedVersion === undefined) {
        if (read) expectedVersion = read.version;
        else {
          // Retrying a blind write must not silently rebase an unchanged caller snapshot.
          expectedVersion = blindVersions.get(key);
          if (expectedVersion === undefined) {
            expectedVersion = (await this.readForWrite(collection, id))?.version ?? null;
            blindVersions.set(key, expectedVersion);
          }
        }
      }
      if (read && read.version !== expectedVersion)
        throw new StorageConflictError(collection, id, read.version);
      guards.delete(key);
      if (removed && expectedVersion === null) guards.set(key, { collection, id, expectedVersion });
      else ops.push({ collection, id, expectedVersion, op: removed ? 'delete' : 'put', body: doc });
    }
    if (!ops.length && !guards.size && !audit.length && !queryGuards.length) return;
    const versions = await this.api.commit({ ops, guards: [...guards.values()], audit, queryGuards });
    const byKey = new Map(versions.map(({ collection, id, version }) => [keyOf(collection, id), version]));
    for (const op of ops) {
      const version = byKey.get(keyOf(op.collection, op.id));
      if (version !== undefined)
        this.remember(op.collection, op.id, op.op === 'delete' ? null : { doc: op.body, version });
    }
  }
}
