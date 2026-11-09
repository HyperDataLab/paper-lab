import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { fixturePaper, fixtureRun, PAPER_ID } from '@/core/measurement/testFixture';
import { createDb } from './db';
import { createRepositories } from './repositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
async function setup() {
  const db = createDb(`measurements-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  await repo.papers.create(fixturePaper);
  return { db, repo };
}
const decision = (run_id: string) => ({
  run_id,
  item_id: 'mu-1',
  field: 'unit',
  decision: 'edit' as const,
  previous_value: '%',
  new_value: 'percent',
  note: null,
});
const pending = {
  sectionIds: ['met'],
  callsUsed: 2,
  checkpoint: { classification: null, units: {}, link: null, findings: null, model: null },
};

it('FR-15 stores a run, appends decisions with audit and keeps the AI original', async () => {
  const { repo, db } = await setup();
  const run = fixtureRun();
  await repo.measurements.saveRun(PAPER_ID, run);
  const value = await repo.measurements.decide(PAPER_ID, decision(run.id));
  expect(value.decisions[0]).toMatchObject({ reviewer: 'local', new_value: 'percent' });
  expect(value.runs[0]?.profile.metrics[0]?.unit.value).toBe('%');
  const actions = (await db.auditEvents.toArray()).map((event) => event.action);
  expect(actions).toEqual(expect.arrayContaining(['run_measurement', 'review_measurement']));
});

it('FR-15 rejects decisions on unknown runs and runs of another paper', async () => {
  const { repo } = await setup();
  await expect(repo.measurements.decide(PAPER_ID, decision(fixtureRun().id))).rejects.toThrow('not found');
  const other = fixtureRun();
  other.profile = { ...other.profile, paper_id: '00000000-0000-4000-8000-000000000002' };
  await expect(repo.measurements.saveRun(PAPER_ID, other)).rejects.toThrow('does not belong');
  await expect(
    repo.measurements.savePending('00000000-0000-4000-8000-000000000009', pending),
  ).rejects.toThrow('Paper not found');
});

it('M4 keeps progress for resume and clears it when a run finishes', async () => {
  const { repo } = await setup();
  expect((await repo.measurements.savePending(PAPER_ID, pending)).pending?.callsUsed).toBe(2);
  expect((await repo.measurements.saveRun(PAPER_ID, fixtureRun())).pending).toBeNull();
});

it('M4 deletes with the paper and survives export and import', async () => {
  const { repo } = await setup();
  await repo.measurements.saveRun(PAPER_ID, fixtureRun());
  const exported = await repo.transfer.exportAll('test');
  expect(exported.measurements).toHaveLength(1);
  await repo.papers.delete(PAPER_ID);
  expect(await repo.measurements.get(PAPER_ID)).toBeUndefined();
  const target = createRepositories(createDb(`measurements-${crypto.randomUUID()}`));
  const plan = await target.transfer.previewImport(JSON.parse(JSON.stringify(exported)));
  if (!plan.ok) throw new Error('Import plan failed');
  await target.transfer.applyImport(plan);
  expect((await target.measurements.get(PAPER_ID))?.runs).toHaveLength(1);
});
