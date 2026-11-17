import { expect, it } from 'vitest';
import type { Paper } from '@/core/schemas';
import { papersByPublishedId } from './localPapers';

const paper = (id: string, sha256: string) => ({ id, title: id, source: { sha256 } }) as unknown as Paper;

it('matches papers by the id they are published under, sha256-<hex> or the lowercase local id', () => {
  const hex = 'd'.repeat(64);
  const index = papersByPublishedId([
    paper('with-file', `sha256:${hex}`),
    paper('ABCDEF00-0000-4000-8000-000000000002', ''),
    paper('bad-hash', 'not-a-sha'),
  ]);
  expect(index.get(`sha256-${hex}`)?.id).toBe('with-file');
  expect(index.get('abcdef00-0000-4000-8000-000000000002')?.id).toBe('ABCDEF00-0000-4000-8000-000000000002');
  expect([...index.values()].map((item) => item.id)).not.toContain('bad-hash');
});
