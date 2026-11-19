import { createDb } from './db';
import { MemoryDocStore, type DocStore } from './docStore';
import { createRepositories } from './repositories';
import type { Repositories } from './types';

/**
 * Repositories over an in-memory DocStore, for tests. Repositories not yet on the port still use a fresh Dexie
 * database, so the test needs `fake-indexeddb/auto`.
 */
export function testRepositories(
  options: { clock?: () => Date; ids?: Parameters<typeof createRepositories>[2]; store?: DocStore } = {},
): Repositories {
  return createRepositories(
    createDb(`test-${crypto.randomUUID()}`),
    options.clock,
    options.ids,
    options.store ?? new MemoryDocStore(),
  );
}
