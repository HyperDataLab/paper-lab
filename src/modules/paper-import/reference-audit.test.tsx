import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { sourceHash } from '@/core/text/hash';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LabResearchError } from '@/shared/labResearch';
import { useReferenceAudit } from './useReferenceAudit';
import { ReferenceAudit } from './ReferenceAudit';

const id = '00000000-0000-4000-8000-000000000001';
const refs = [1, 2, 3].map((n) => ({
  text: `Author. Title ${n}. 2020.`,
  year: 2020,
  doi: null,
  location: null,
}));
const output = { lookup: 'bibliographic', status: 'candidates', candidates: [] };
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
function setup() {
  const repo = createRepositories(createDb(`audit-${crypto.randomUUID()}`));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StorageProvider repositories={repo}>{children}</StorageProvider>
  );
  return { repo, wrapper };
}
it('RA-13 preserves retraction and audit fields in schema storage round trips', async () => {
  const { repo } = setup();
  const base = await repo.paperContext.save({
    schemaVersion: 1,
    paperId: id,
    checkedAt: new Date().toISOString(),
    paperDoi: null,
    checked: 1,
    found: 1,
    retracted: [],
    metadata: null,
  });
  const audit = { schemaVersion: 1 as const, auditedAt: new Date().toISOString(), items: [], reviewed: [] };
  await repo.paperContext.save({ ...base, referenceAudit: audit });
  const current = await repo.paperContext.get(id);
  expect(current?.checked).toBe(1);
  if (!current) throw new Error('missing record');
  await repo.paperContext.save({ ...current, checked: 2 });
  expect((await repo.paperContext.get(id))?.referenceAudit).toEqual(audit);
});
it('RA-14 runs sequentially with injected delay', async () => {
  const { wrapper } = setup();
  let time = 0;
  let active = 0;
  const call = vi.fn(async () => {
    expect(active++).toBe(0);
    await Promise.resolve();
    active--;
    return output;
  });
  const sleep = vi.fn(async (ms: number) => {
    time += ms;
  });
  const { result } = renderHook(
    () => useReferenceAudit(id, refs, undefined, () => {}, { call, sleep, now: () => time }),
    { wrapper },
  );
  await act(() => result.current.run());
  expect(call).toHaveBeenCalledTimes(3);
  expect(call).toHaveBeenNthCalledWith(1, { citation: refs[0]?.text });
  expect(sleep.mock.calls).toEqual([[1100], [1100]]);
});
it('RA-15 resumes by skipping saved hashes', async () => {
  const { wrapper, repo } = setup();
  const call = vi.fn(async () => output);
  const hash = (await sourceHash(refs[0]?.text ?? '')).slice(0, 23);
  await repo.paperContext.save({
    schemaVersion: 1,
    paperId: id,
    checkedAt: new Date().toISOString(),
    paperDoi: null,
    checked: 0,
    found: 0,
    retracted: [],
    metadata: null,
    referenceAudit: {
      schemaVersion: 1,
      auditedAt: new Date().toISOString(),
      reviewed: [],
      items: [
        { index: 0, textHash: hash, verdict: 'matched', lookup: 'bibliographic', mismatches: [], notes: [] },
      ],
    },
  });
  const { result } = renderHook(
    () => useReferenceAudit(id, refs, undefined, () => {}, { call, sleep: async () => {} }),
    { wrapper },
  );
  await act(() => result.current.run());
  expect(call).toHaveBeenCalledTimes(2);
});
it('RA-16 stops before the next request', async () => {
  const { wrapper, repo } = setup();
  let release: () => void = () => {};
  const call = vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        release = () => resolve(output);
      }),
  );
  const { result } = renderHook(
    () => useReferenceAudit(id, refs, undefined, () => {}, { call, sleep: async () => {} }),
    { wrapper },
  );
  let running: Promise<void>;
  act(() => {
    running = result.current.run();
  });
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  act(() => result.current.stop());
  await act(async () => {
    release();
    await running;
  });
  expect(call).toHaveBeenCalledTimes(1);
  expect((await repo.paperContext.get(id))?.referenceAudit?.items).toHaveLength(1);
});
it('RA-17 exposes client errors for the Vietnamese message', async () => {
  const { wrapper } = setup();
  const call = vi.fn(async () => {
    throw new LabResearchError(0, 'network', 'offline');
  });
  const { result } = renderHook(
    () => useReferenceAudit(id, refs.slice(0, 1), undefined, () => {}, { call }),
    { wrapper },
  );
  await act(() => result.current.run());
  expect(result.current.error).toMatchObject({ code: 'network' });
});
it('RA-18 filters results and persists reviewed marks', async () => {
  const { wrapper, repo } = setup();
  const record = await repo.paperContext.save({
    schemaVersion: 1,
    paperId: id,
    checkedAt: new Date().toISOString(),
    paperDoi: null,
    checked: 0,
    found: 0,
    retracted: [],
    metadata: null,
    referenceAudit: {
      schemaVersion: 1,
      auditedAt: new Date().toISOString(),
      reviewed: [],
      items: [
        { index: 0, textHash: 'one', verdict: 'mismatch', lookup: 'doi', mismatches: [], notes: [] },
        {
          index: 1,
          textHash: 'two',
          verdict: 'unresolved',
          lookup: 'bibliographic',
          mismatches: [],
          notes: [],
        },
      ],
    },
  });
  render(<ReferenceAudit paperId={id} references={refs} record={record} onSave={() => {}} />, { wrapper });
  fireEvent.click(screen.getByRole('radio', { name: 'Lệch thông tin' }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(async () =>
    expect((await repo.paperContext.get(id))?.referenceAudit?.reviewed).toEqual(['one']),
  );
});
