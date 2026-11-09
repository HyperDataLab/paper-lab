import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { fixturePaper, PAPER_ID } from '@/core/measurement/testFixture';
import { createDb } from './db';
import { createRepositories } from './repositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
const repos = () => createRepositories(createDb(`library-${crypto.randomUUID()}`));

it('F1 adds new DOIs and counts the ones already present', async () => {
  const repo = repos();
  const first = await repo.library.addDois(['10.1000/a', '10.1000/b']);
  expect(first).toMatchObject({ duplicates: 0 });
  expect(first.added[0]).toMatchObject({ lookup: 'pending', access: 'unknown', paper_id: null });
  const second = await repo.library.addDois(['10.1000/a', '10.1000/c']);
  expect(second.added.map((item) => item.doi)).toEqual(['10.1000/c']);
  expect(second.duplicates).toBe(1);
  expect(await repo.library.list()).toHaveLength(3);
});

it('F1 updates and removes items, and refuses an unknown id', async () => {
  const repo = repos();
  const { added } = await repo.library.addDois(['10.1000/a']);
  const id = added[0]?.id ?? '';
  expect((await repo.library.update(id, { lookup: 'done', title: 'T' })).title).toBe('T');
  await expect(repo.library.update('00000000-0000-4000-8000-000000000009', { title: 'x' })).rejects.toThrow(
    'not found',
  );
  await repo.library.remove([id]);
  expect(await repo.library.get(id)).toBeUndefined();
});

it('F2 clears the file link when the paper is deleted', async () => {
  const repo = repos();
  await repo.papers.create(fixturePaper);
  const { added } = await repo.library.addDois(['10.1000/a']);
  const id = added[0]?.id ?? '';
  await repo.library.update(id, { paper_id: PAPER_ID, file_matches_title: true });
  await repo.papers.delete(PAPER_ID);
  expect(await repo.library.get(id)).toMatchObject({ paper_id: null, file_matches_title: null });
});

it('F1 survives export and import, dropping links to papers that are not there', async () => {
  const source = repos();
  await source.papers.create(fixturePaper);
  const { added } = await source.library.addDois(['10.1000/a']);
  await source.library.update(added[0]?.id ?? '', {
    paper_id: '00000000-0000-4000-8000-0000000000ff',
    title: 'T',
  });
  const backup = JSON.parse(JSON.stringify(await source.transfer.exportAll('test')));
  expect(backup.library).toHaveLength(1);
  const target = repos();
  const plan = await target.transfer.previewImport(backup);
  if (!plan.ok) throw new Error('Import plan failed');
  await target.transfer.applyImport(plan);
  const [item] = await target.library.list();
  expect(item).toMatchObject({ doi: '10.1000/a', title: 'T', paper_id: null });
  const again = await target.transfer.previewImport(backup);
  if (!again.ok) throw new Error('Import plan failed');
  await target.transfer.applyImport(again);
  expect(await target.library.list()).toHaveLength(1);
});
