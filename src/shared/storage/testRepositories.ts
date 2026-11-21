import { MemoryDocStore, type DocStore } from './docStore';
import { createRepositories } from './repositories';
import type { Repositories } from './types';

/** Repositories backed by a fresh in-memory store unless a test supplies its own store. */
export function testRepositories(
  options: { clock?: () => Date; ids?: Parameters<typeof createRepositories>[2]; store?: DocStore } = {},
): Repositories {
  return createRepositories(options.store ?? new MemoryDocStore(), options.clock, options.ids);
}
