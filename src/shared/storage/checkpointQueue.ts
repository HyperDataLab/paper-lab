import { keyOf, type Versioned } from './docStore';
import { RemoteStorageError, StorageConflictError } from './errors';

export const CHECKPOINT_INTERVAL_MS = 2000;

type Entry = {
  collection: string;
  id: string;
  doc: unknown;
  expected: number | null;
  generation: number;
  task?: Promise<void>;
  failure?: { cause: unknown };
};

function retryable(cause: unknown) {
  return (
    !(cause instanceof StorageConflictError) &&
    (!(cause instanceof RemoteStorageError) ||
      cause.status === 0 ||
      cause.status >= 500 ||
      cause.status === 429)
  );
}

export class CheckpointQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly lastStart = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private status: 'idle' | 'saving' | 'error' = 'idle';

  constructor(
    private readonly load: (collection: string, id: string) => Promise<Versioned | null>,
    private readonly send: (
      collection: string,
      id: string,
      expected: number | null,
      snapshot: () => unknown,
      onSend: () => void,
    ) => Promise<number>,
  ) {}

  getStatus = () => this.status;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = true;
  };

  private changed() {
    const next = [...this.entries.values()].some((entry) => entry.failure)
      ? 'error'
      : this.entries.size
        ? 'saving'
        : 'idle';
    if (next === this.status) return;
    if (typeof window !== 'undefined') {
      if (next === 'idle') window.removeEventListener('beforeunload', this.warn);
      else if (this.status === 'idle') window.addEventListener('beforeunload', this.warn);
    }
    this.status = next;
    for (const listener of this.listeners) listener();
  }

  async checkpoint<T>(collection: string, id: string, update: (current: unknown) => T) {
    const key = keyOf(collection, id);
    const stored = this.entries.has(key) ? null : await this.load(collection, id);
    let entry = this.entries.get(key);
    if (entry?.failure) throw entry.failure.cause;
    const doc = update(structuredClone(entry ? entry.doc : stored?.doc));
    const snapshot = structuredClone(doc);
    if (!entry) {
      entry = { collection, id, doc: snapshot, expected: stored?.version ?? null, generation: 0 };
      this.entries.set(key, entry);
    }
    entry.doc = snapshot;
    entry.generation++;
    this.schedule(key, entry);
    this.changed();
    return doc;
  }

  private schedule(key: string, entry: Entry) {
    if (entry.task || entry.failure) return;
    const delay = Math.max(0, CHECKPOINT_INTERVAL_MS - (Date.now() - (this.lastStart.get(key) ?? -Infinity)));
    const ready = delay ? new Promise<void>((resolve) => setTimeout(resolve, delay)) : Promise.resolve();
    entry.task = ready.then(async () => {
      const { expected, collection, id } = entry;
      let sentGeneration = entry.generation;
      try {
        entry.expected = await this.send(
          collection,
          id,
          expected,
          () => {
            sentGeneration = entry.generation;
            return entry.doc;
          },
          () => {
            // Token refresh and JSON serialization can delay the request after the timer fires.
            const started = Date.now();
            this.lastStart.set(key, started);
            setTimeout(() => {
              if (this.lastStart.get(key) === started) this.lastStart.delete(key);
            }, CHECKPOINT_INTERVAL_MS);
          },
        );
        if (entry.generation === sentGeneration) this.entries.delete(key);
      } catch (cause) {
        entry.failure = { cause };
      } finally {
        entry.task = undefined;
        if (this.entries.has(key)) this.schedule(key, entry);
        this.changed();
      }
    });
  }

  async flush(collection?: string, id?: string) {
    const matches = (entry: Entry) =>
      (collection === undefined || collection === entry.collection) && (id === undefined || id === entry.id);
    for (const [key, entry] of this.entries) {
      if (matches(entry) && entry.failure && retryable(entry.failure.cause)) {
        entry.failure = undefined;
        this.schedule(key, entry);
      }
    }
    this.changed();
    let pending: Entry[];
    while ((pending = [...this.entries.values()].filter(matches)).length) {
      await Promise.all(pending.map((entry) => entry.task));
      const failed = pending.find((entry) => entry.failure);
      if (failed?.failure) throw failed.failure.cause;
    }
  }
}
