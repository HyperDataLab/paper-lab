import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { buildGeneration } from '@/core/generation';
import { createDb } from './db';
import { createRepositories } from './repositories';

it('WR-01 WR-08 accepts a generation only after failed checks are overridden and audits it', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const db = createDb(`generation-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  const value = buildGeneration(
    {
      mainClaim: 'Growth improved',
      evidence: [{ id: 'e1', text: 'Growth improved', citation: null }],
      audience: 'general',
      structure: 'auto',
      preserveTerms: [],
      hedging: 'cautious',
    },
    {
      paragraph: 'Growth improved by 5 percent.',
      sentences: [
        { text: 'Growth improved by 5 percent.', role: 'development', evidenceIds: ['e1'], usesClaim: true },
      ],
      needsEvidence: [],
    },
    { id: crypto.randomUUID(), model: 'fake', createdAt: new Date().toISOString() },
  );
  await repo.generations.create(value);
  expect(await repo.generations.get(value.id)).toEqual(value);
  expect(await repo.generations.list()).toEqual([value]);
  await expect(repo.generations.acceptGeneration(value.id)).rejects.toThrow('failed provenance');
  const analysis = await repo.generations.acceptGeneration(value.id, true);
  expect(analysis.title).toMatch(/^Đoạn soạn: /u);
  expect(analysis).toMatchObject({
    origin: { kind: 'generated', generationId: value.id },
    parentAnalysisId: null,
    text: { sourceText: value.paragraph },
  });
  expect((await repo.audit.listAll()).items.map((event) => event.action)).toEqual([
    'create_generation',
    'accept_generation',
  ]);
  const safe = buildGeneration(
    value.input,
    {
      paragraph: 'Growth improved.',
      sentences: [{ text: 'Growth improved.', role: 'topic_sentence', evidenceIds: ['e1'], usesClaim: true }],
      needsEvidence: [],
    },
    { id: crypto.randomUUID(), model: 'fake', createdAt: value.createdAt },
  );
  await repo.generations.create(safe);
  expect((await repo.generations.acceptGeneration(safe.id)).origin).toEqual({
    kind: 'generated',
    generationId: safe.id,
  });
  await db.delete();
});
it('WR-01 migrates version 2 without altering existing data', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const name = `generation-migration-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(2).stores({
    analyses: 'id, createdAt, updatedAt, text.sourceHash',
    auditEvents: 'id, analysisId, at',
    revisions: 'id, sourceAnalysisId, createdAt',
  });
  const row = { id: crypto.randomUUID(), createdAt: 'old', updatedAt: 'old', text: { sourceHash: 'hash' } };
  await old.table('analyses').add(row);
  old.close();
  const db = createDb(name);
  expect(await db.analyses.get(row.id)).toEqual(row);
  expect(await db.generations.count()).toBe(0);
  await db.delete();
});

it('EV-12 exports and imports generations and their audit events, including legacy packages', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const sourceDb = createDb(`generation-export-${crypto.randomUUID()}`);
  const targetDb = createDb(`generation-import-${crypto.randomUUID()}`);
  const source = createRepositories(sourceDb),
    target = createRepositories(targetDb);
  const value = buildGeneration(
    {
      mainClaim: 'Growth improved',
      evidence: [{ id: 'e1', text: 'Growth improved', citation: null }],
      audience: 'general',
      structure: 'auto',
      preserveTerms: [],
      hedging: 'cautious',
    },
    {
      paragraph: 'Growth improved.',
      sentences: [{ text: 'Growth improved.', role: 'topic_sentence', evidenceIds: ['e1'], usesClaim: true }],
      needsEvidence: [],
    },
    { id: crypto.randomUUID(), model: 'fake', createdAt: new Date().toISOString() },
  );
  await source.generations.create(value);
  const analysis = await source.generations.acceptGeneration(value.id);
  const exported = await source.transfer.exportAll('test');
  expect(exported.generations).toEqual([value]);
  const plan = await target.transfer.previewImport(exported);
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.error);
  expect(plan.generationsToInsert).toHaveLength(1);
  const bad = {
    ...exported,
    generations: [{ ...value, sentences: [{ ...value.sentences[0], span: { start: 1, end: 3 } }] }],
  };
  expect((await target.transfer.previewImport(bad)).ok).toBe(false);
  await target.transfer.applyImport(plan);
  expect(await target.generations.get(value.id)).toEqual(value);
  expect((await target.analyses.get(analysis.id))?.origin).toEqual({
    kind: 'generated',
    generationId: value.id,
  });
  expect((await target.audit.listAll()).items.map((event) => event.action)).toEqual(
    expect.arrayContaining(['create_generation', 'accept_generation']),
  );
  const repeat = await target.transfer.previewImport(exported);
  expect(repeat.ok && repeat.generationsToInsert).toEqual([]);
  const { generations: _generations, ...legacy } = exported;
  void _generations;
  const oldPlan = await target.transfer.previewImport(legacy);
  expect(oldPlan.ok && oldPlan.generationsToInsert).toEqual([]);
  await sourceDb.delete();
  await targetDb.delete();
});
