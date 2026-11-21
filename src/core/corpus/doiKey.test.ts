import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { doiKey } from './doiKey';
// Sourced from paper-fetch-hub/shared/doi-vectors.json.
import vectors from './doi-vectors.json';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it.each(vectors.valid)('matches the Hub key for $doi', async (vector) => {
  expect(await doiKey(vector.input)).toBe(vector.doiKey);
});

it.each(vectors.invalid)('rejects the same invalid DOI as the Hub (%j)', async (input) => {
  expect(await doiKey(input)).toBeNull();
});
