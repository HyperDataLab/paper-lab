import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyTopicCheck } from '@/core/schemas/topicCheck';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import { fixturePaper, fixtureRun } from '@/core/measurement/testFixture';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { loadLocalData } from '@/modules/researchDesign/localData';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { CompositeDocStore } from '@/shared/storage/compositeDocStore';
import { DexieDocStore } from '@/shared/storage/dexieDocStore';
import { testWorkerData } from '@/shared/storage/remoteTestSupport';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-01-01T00:00:00.000Z';
async function setup(backend = 'Dexie') {
  const db = createDb(`research-design-${crypto.randomUUID()}`);
  const remote = backend === 'remote' ? testWorkerData().connect() : null;
  const repo = createRepositories(
    db,
    undefined,
    undefined,
    new CompositeDocStore(new DexieDocStore(db), remote),
  );
  const project = await repo.extraction.save({
    schemaVersion: 1,
    id,
    paperId: null,
    title: 'Synthetic',
    researchQuestion: '',
    createdAt: at,
    updatedAt: at,
    papers: [
      {
        key: 'project-paper',
        source: { kind: 'paper', paperId: fixturePaper.id },
        title: 'Synthetic paper',
        authors: [],
        year: null,
        venue: null,
        doi: null,
        access: 'FULL_TEXT',
        abstract: null,
        revision: '1',
        screening: 'included',
      },
    ],
    fields: [],
    runs: [],
    cells: [],
    deep: null,
  });
  await repo.papers.create(fixturePaper);
  return { repo, project };
}
it('M2 saves with a version, rejects stale edits, and deletes with the project', async () => {
  const { repo } = await setup();
  const initial = emptyResearchDesign(id);
  const saved = await repo.researchDesigns.save(initial, 0);
  expect(await repo.researchDesigns.get(id)).toEqual(saved);
  await expect(repo.researchDesigns.save(initial, 0)).rejects.toThrow('changed');
  await repo.extraction.remove(id);
  expect(await repo.researchDesigns.get(id)).toBeUndefined();
});
it('M2 maps project keys and supplies facts only after a measurement run', async () => {
  const { repo, project } = await setup();
  expect((await loadLocalData(project, repo)).facts).toEqual({});
  await repo.measurements.saveRun(fixturePaper.id, fixtureRun());
  const data = await loadLocalData(project, repo);
  expect(data.papers.papers[0]?.id).toBe('project-paper');
  expect(data.facts['project-paper']?.facts.modelEtag).toBe(data.papers.papers[0]?.model?.paperlab?.etag);
});
it('M2 exports and imports a research design', async () => {
  const { repo } = await setup();
  await repo.researchDesigns.save(emptyResearchDesign(id), 0);
  const exported = await repo.transfer.exportAll('test');
  const target = createRepositories(createDb(`research-design-${crypto.randomUUID()}`));
  const plan = await target.transfer.previewImport(exported);
  if (!plan.ok) throw new Error(plan.error);
  await target.transfer.applyImport(plan);
  expect(await target.researchDesigns.get(id)).toEqual(await repo.researchDesigns.get(id));
});

it('M2 verifies snapshot bytes again on import', async () => {
  const { repo } = await setup();
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).buffer;
  await repo.researchDesigns.importBank(id, 0, bytes, 'local');
  const exported = await repo.transfer.exportAll('test');
  const target = createRepositories(createDb(`research-design-${crypto.randomUUID()}`));
  const plan = await target.transfer.previewImport(exported);
  if (!plan.ok) throw new Error(plan.error);
  await target.transfer.applyImport(plan);
  expect(await target.researchDesigns.getBank(id)).toEqual(await repo.researchDesigns.getBank(id));
  const tampered = structuredClone(exported);
  if (!tampered.researchDesignBanks[0]) throw new Error('Bank missing');
  tampered.researchDesignBanks[0].bank.source = 'tampered';
  const invalid = await target.transfer.previewImport(tampered);
  if (!invalid.ok) throw new Error(invalid.error);
  await expect(target.transfer.applyImport(invalid)).rejects.toThrow('Invalid research design bank snapshot');
});

it('C2 imports a bank and its research design version together on the worker', async () => {
  const { repo } = await setup('remote');
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).buffer;
  const saved = await repo.researchDesigns.importBank(id, 0, bytes, 'lab');
  expect(saved.version).toBe(1);
  expect(await repo.researchDesigns.get(id)).toEqual(saved);
  expect(await repo.researchDesigns.getBank(id)).toMatchObject({ release: saved.bankRelease });
});

it.each(['Dexie', 'remote'])('M2 freezes and protects versions over %s', async (backend) => {
  const { repo } = await setup(backend);
  const design = emptyResearchDesign(id);
  design.draft.hypotheses = [
    {
      id: 'h-1',
      statement: 'Hypothesis',
      kind: 'exploratory',
      question: null,
      claim: null,
      independent: [],
      dependent: ['v-1'],
    },
  ];
  design.draft.variables = [
    { id: 'v-1', name: 'Variable', role: 'dependent', construct: '', metric: 'm-1', levels: [] },
  ];
  design.draft.metrics = [
    {
      id: 'm-1',
      name: 'Metric',
      key: 'score',
      unit: 'points',
      goal: 'maximize',
      aggregation: 'mean',
      protocol: 'Measure',
      bank: null,
      protocolBank: null,
    },
  ];
  design.draft.datasets = [
    {
      id: 'd-1',
      name: 'Dataset',
      source: 'Source',
      version: null,
      split: null,
      sha256: null,
      benchmark: null,
    },
  ];
  design.draft.conditions = [{ id: 'c-1', name: 'Condition', baseline: true, params: {} }];
  design.draft.runMatrix = {
    mlflowExperiment: 'Experiment',
    conditions: ['c-1'],
    datasets: ['d-1'],
    seeds: [1],
    sampleSizeJustification: 'Prior work',
  };
  const saved = await repo.researchDesigns.save(design, 0);
  const papers = { schemaVersion: 1 as const, papers: [], log: [] };
  const frozen = await repo.researchDesigns.freeze(id, saved.version, 1, 'local', null, papers, '1');
  expect(await repo.researchDesigns.listFrozenVersions(id)).toHaveLength(1);
  await expect(
    repo.researchDesigns.freeze(id, frozen.version, 1, 'local', null, papers, '1'),
  ).rejects.toThrow();
  await expect(repo.researchDesigns.save({ ...frozen, frozenPlans: [] }, frozen.version)).rejects.toThrow(
    'immutable',
  );
  await expect(
    repo.researchDesigns.freeze(id, frozen.version, 2, 'local', 'Changes', papers, '1'),
  ).rejects.toThrow();
  const changed = await repo.researchDesigns.save(
    { ...frozen, draft: { ...frozen.draft, planTitle: 'Revised plan' } },
    frozen.version,
  );
  const second = await repo.researchDesigns.freeze(id, changed.version, 2, 'local', 'New title', papers, '1');
  expect(second.frozenPlans).toHaveLength(2);
  expect(second.frozenPlans[0]).toEqual(frozen.frozenPlans[0]);

  // SRD-PUB-07: which versions the lab's server holds is kept beside the frozen plans and survives later saves.
  expect(second.publishedPlans).toBeUndefined();
  const marked = await repo.researchDesigns.save(
    { ...second, publishedPlans: { '1': { publishedAt: at } } },
    second.version,
  );
  expect((await repo.researchDesigns.get(id))?.publishedPlans).toEqual({ '1': { publishedAt: at } });
  expect(marked.frozenPlans).toEqual(second.frozenPlans);
  await expect(
    repo.researchDesigns.save({ ...marked, publishedPlans: { '3': { publishedAt: at } } }, marked.version),
  ).rejects.toThrow();
});

it('TC storage preserves topic check through save, reload and export/import', async () => {
  const { repo } = await setup();
  const design = emptyResearchDesign(id);
  design.topicCheck = { ...emptyTopicCheck(), statement: 'Synthetic topic.' };
  await repo.researchDesigns.save(design, 0);
  expect((await repo.researchDesigns.get(id))?.topicCheck).toEqual(design.topicCheck);
  const backup = await repo.transfer.exportAll('test');
  const target = createRepositories(createDb(`topic-${crypto.randomUUID()}`));
  const plan = await target.transfer.previewImport(JSON.parse(JSON.stringify(backup)));
  if (!plan.ok) throw new Error(plan.error);
  await target.transfer.applyImport(plan);
  expect((await target.researchDesigns.get(id))?.topicCheck).toEqual(design.topicCheck);
});
