import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { startLabelQueue } from '@/core/corpus/labelQueue';
import { exampleInsights, examplePaper, exampleStance } from '@/core/paperModel/contract';
import type { Paper, StanceRun } from '@/core/schemas';
import type { Corpus, CorpusMember } from '@/core/schemas/corpus';
import { getConfig } from '@/shared/llm/config';
import type { Repositories } from '@/shared/storage/repositories';
import { LABEL_VERSIONS, labelSections } from './labelPlan';
import { DEFAULT_RUNNERS, labelMember, runLabelQueue, type LabelRunners } from './labelRun';
import { labelCoverage } from './machineLabels';
import { testRepositories } from '@/shared/storage/testRepositories';

const inputs: NonNullable<CorpusMember['inputs']> = {
  textHashes: [],
  metadataDigest: 'sha256:0',
  insightRunIds: [],
  stanceRunIds: [],
  segmenterVersion: 'x',
  sentenceKeyVersion: 'x',
};
const at = '2026-11-12T00:00:00.000Z';

function member(paperId: string, title: string): CorpusMember {
  const base = exampleCorpus().members[0];
  if (!base) throw new Error('missing example member');
  return {
    ...base,
    memberId: crypto.randomUUID(),
    title,
    retrieval: 'retrieved',
    identifiers: { ...base.identifiers, paperIds: [paperId] },
    inputs,
  };
}

/** A stance run as the real runner would return it for the current prompt. */
function currentStanceRun(paper: Paper): StanceRun {
  const run = exampleStance(paper).runs[0];
  if (!run) throw new Error('missing stance run');
  return {
    ...run,
    id: crypto.randomUUID(),
    promptVersion: LABEL_VERSIONS.stance,
    sectionIds: labelSections(paper, 'stance'),
    failedSectionIds: [],
  };
}

function mockedRunners(): LabelRunners & { stance: ReturnType<typeof vi.fn> } {
  const stance = vi.fn(async (_client: unknown, paper: Paper) => ({
    run: currentStanceRun(paper),
    state: { sectionIds: [], callsUsed: 0, model: null, chunks: {} },
    incomplete: false,
  }));
  return { ...DEFAULT_RUNNERS, stance } as unknown as LabelRunners & { stance: typeof stance };
}

let repo: Repositories;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  repo = testRepositories();
});

describe('C4b corpus labelling run', () => {
  it('C4b resumes after a reload at the next member', async () => {
    const one = member('p1', 'One');
    const two = member('p2', 'Two');
    const corpus: Corpus = startLabelQueue(
      { ...exampleCorpus(), members: [one, two] },
      {
        schemes: ['stance'],
        memberIds: [one.memberId, two.memberId],
        model: 'm',
        promptVersions: { stance: LABEL_VERSIONS.stance },
        now: at,
      },
    );
    await repo.corpora.save(corpus);
    let state: 'run' | 'pause' = 'run';
    const first = vi.fn(async () => {
      // The tab closes while the first member is being labelled; its checkpoint still lands.
      state = 'pause';
      return { outcomes: { stance: { status: 'done' as const } }, inputs: null };
    });
    const io = {
      load: () => repo.corpora.get(corpus.id),
      save: async (value: Corpus) => void (await repo.corpora.save(value)),
    };
    await runLabelQueue({ ...io, label: first, control: () => state });
    const paused = await repo.corpora.get(corpus.id);
    expect(paused?.labelQueue).toMatchObject({ status: 'paused', pending: [two.memberId] });
    expect(paused?.runs).toHaveLength(0);

    // After the reload: "Tiếp tục" marks the queue running again and starts at the next member.
    if (!paused?.labelQueue) throw new Error('missing queue');
    await repo.corpora.save({ ...paused, labelQueue: { ...paused.labelQueue, status: 'running' } });
    const second = vi.fn(async () => ({ outcomes: { stance: { status: 'done' as const } }, inputs }));
    await runLabelQueue({ ...io, label: second, control: () => 'run' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]).toMatchObject([{ memberId: two.memberId }, ['stance']]);
    const done = await repo.corpora.get(corpus.id);
    expect(done?.labelQueue?.status).toBe('complete');
    expect(done?.runs).toMatchObject([
      { scheme: 'stance', model: 'm', promptVersion: LABEL_VERSIONS.stance, done: 2, failed: 0, skipped: 0 },
    ]);
  });

  it('C4b re-runs a member labelled by another prompt version and skips it once current', async () => {
    const paper = examplePaper();
    await repo.papers.create(paper);
    // The stored stance run used an older prompt.
    await repo.stance.saveRun(paper.id, { ...currentStanceRun(paper), promptVersion: 'older-prompt' });
    const runners = mockedRunners();
    const deps = { repo, client: { completeJson: vi.fn() }, config: getConfig(), runners };
    const target = member(paper.id, 'Paper');
    const first = await labelMember(target, ['stance'], deps);
    expect(first.outcomes.stance).toEqual({ status: 'done' });
    expect(runners.stance).toHaveBeenCalledTimes(1);
    expect((await repo.stance.get(paper.id))?.runs.at(-1)?.promptVersion).toBe(LABEL_VERSIONS.stance);
    expect(first.inputs?.stanceRunIds).toHaveLength(1);
    const again = await labelMember(target, ['stance'], deps);
    expect(again.outcomes.stance).toEqual({ status: 'skipped' });
    expect(runners.stance).toHaveBeenCalledTimes(1);
  });

  it('C4b reports coverage per scheme and per section role', () => {
    const paper = examplePaper();
    const insights = exampleInsights(paper);
    const rhetoric = insights.rhetoricRuns[0];
    if (!rhetoric) throw new Error('missing rhetoric run');
    rhetoric.promptVersion = LABEL_VERSIONS.rhetoric;
    const stance = { ...exampleStance(paper), runs: [currentStanceRun(paper)] };
    const covered = { memberId: 'one', paper, insights, stance };
    const bare = { memberId: 'two', paper: { ...paper, id: 'other' } };
    const result = labelCoverage([covered, bare], ['rhetoric', 'stance', 'arguments']);
    expect(result.members).toEqual([
      { scheme: 'rhetoric', covered: 1, built: 2 },
      { scheme: 'stance', covered: 1, built: 2 },
      { scheme: 'arguments', covered: 0, built: 2 },
    ]);
    const byRole = Object.fromEntries(result.roles.map((row) => [row.role, row.schemes]));
    expect(byRole).toEqual({
      abstract: { rhetoric: { sentences: 2, labelled: 1 }, stance: { sentences: 2, labelled: 0 } },
      methods: { rhetoric: { sentences: 1, labelled: 0 }, stance: { sentences: 1, labelled: 0 } },
      results: { rhetoric: { sentences: 1, labelled: 1 }, stance: { sentences: 1, labelled: 1 } },
    });
  });
});
