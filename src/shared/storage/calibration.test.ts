import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { testRepositories } from './testRepositories';

it('P7 round trips imported labels and their audit in backups', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = testRepositories();
  expect(await repo.calibrationLabels.list()).toEqual([]);
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
  const restored = testRepositories();
  const plan = await restored.transfer.previewImport(backup);
  if (!plan.ok) throw new Error(plan.error);
  await restored.transfer.applyImport(plan);
  expect(await restored.calibrationLabels.list()).toEqual([imported]);
  expect((await restored.audit.listByAnalysis(imported.id)).items[0]?.action).toBe('import_labels');
  await restored.calibrationLabels.delete(imported.id);
  expect(await restored.calibrationLabels.list()).toEqual([]);
});
