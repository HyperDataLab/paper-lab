import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createDb } from './db';
import { createRepositories } from './repositories';

it('P7 migrates existing databases and round trips imported labels and audit in backups', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const name = `calibration-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(9).stores({
    analyses: 'id, createdAt, updatedAt, text.sourceHash',
    auditEvents: 'id, analysisId, at',
    paperProbes: 'paperId',
  });
  await old.open();
  old.close();
  const db = createDb(name);
  const repo = createRepositories(db);
  expect(await repo.calibrationLabels.list()).toEqual([]);
  expect(db.verno).toBe(19);
  const data = {
    format: 'paragraph-lab-labels',
    version: 1,
    labels: [
      { rater: 'A', target: { kind: 'issue', type: 'x', textHash: 'h', quote: 'q' }, label: 'correct' },
    ],
  };
  const imported = await repo.calibrationLabels.import('labels.json', data);
  expect((await repo.audit.listByAnalysis(imported.id)).items[0]?.action).toBe('import_labels');
  await expect(repo.calibrationLabels.import('bad.json', {})).rejects.toThrow();
  const backup = await repo.transfer.exportAll('test');
  const second = createDb(`calibration-${crypto.randomUUID()}`);
  const restored = createRepositories(second);
  const plan = await restored.transfer.previewImport(backup);
  if (!plan.ok) throw new Error(plan.error);
  await restored.transfer.applyImport(plan);
  expect(await restored.calibrationLabels.list()).toEqual([imported]);
  expect((await restored.audit.listByAnalysis(imported.id)).items[0]?.action).toBe('import_labels');
  await restored.calibrationLabels.delete(imported.id);
  expect(await restored.calibrationLabels.list()).toEqual([]);
  db.close();
  second.close();
});
