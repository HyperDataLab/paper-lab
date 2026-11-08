import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { sourceHash } from '@/core/text/hash';
import { planRun } from '@/core/batch';
import type { Paper, PaperRun } from '@/core/schemas';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { createPaperParagraphAnalyzer } from './paperParagraphAnalyzer';
import type { LlmClient } from './client';

it('P2 creates paper analyses and keeps human decisions on a detector rerun', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const at = '2026-01-01T00:00:00.000Z';
  const text = 'This is very important.';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [{ id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: null }],
    paragraphs: [
      {
        id: 'p',
        sectionId: 's',
        order: 0,
        text,
        textHash: await sourceHash(text),
        kind: 'body',
        pageStart: null,
      },
    ],
  };
  const repositories = createRepositories(createDb(`p2-${crypto.randomUUID()}`));
  const client: LlmClient = { completeJson: vi.fn() };
  const analyzer = createPaperParagraphAnalyzer(client, repositories, paper);
  const paragraph = paper.paragraphs[0];
  if (!paragraph) throw new Error('missing paragraph');
  const context = {
    role: 'methods' as const,
    heading: 'Methods',
    previousLast: 'Before.',
    nextFirst: 'After.',
  };
  const id = await analyzer.analyze(paragraph, context, 'detectors', null);
  const first = await repositories.analyses.get(id);
  expect(first?.origin).toEqual({ kind: 'paper', paperId: paper.id, paragraphId: 'p' });
  expect(first?.title).toBe('Methods · p');
  expect(first?.contextLimited).toBe(false);
  expect(first?.context.before).toBe('Before.');
  const issue = first?.issues[0];
  if (!issue) throw new Error('missing candidate');
  await repositories.analyses.reviewIssue(id, issue.id, { status: 'dismissed_by_human' });
  expect(await analyzer.analyze(paragraph, context, 'detectors', null)).toBe(id);
  expect((await repositories.analyses.get(id))?.issues[0]?.status).toBe('dismissed_by_human');
  const plan = planRun(paper, { sectionIds: ['s'], steps: [], budget: 0 });
  const run: PaperRun = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    paperId: paper.id,
    createdAt: at,
    updatedAt: at,
    status: 'idle',
    plan,
    budget: 0,
    callsUsed: 0,
    promptVersions: {},
    model: 'm',
    items: [],
  };
  expect(await analyzer.findCached(paragraph, run)).toBe(id);
  expect(client.completeJson).not.toHaveBeenCalled();
});

it('P2 applies paper syntax, judgement, structure and scoring to an existing analysis', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const at = '2026-01-01T00:00:00.000Z';
  const text = 'This is very important. Results were obtained.';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [{ id: 's', heading: 'Results', role: 'results', level: 1, pageStart: null }],
    paragraphs: [
      {
        id: 'p',
        sectionId: 's',
        order: 0,
        text,
        textHash: await sourceHash(text),
        kind: 'body',
        pageStart: null,
      },
    ],
  };
  const repositories = createRepositories(createDb(`p2-${crypto.randomUUID()}`));
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    const answers: Record<string, unknown> = {
      sentence_syntax: { sentences: [] },
      candidate_judgement: { judgements: [], passive: [] },
      paragraph_structure: {
        type: 'LD',
        typeScores: { 'TS-D': 0.1, LD: 0.8, LDR: 0.2, OCAR: 0.1, UNKNOWN: 0.1 },
        centralPointSentenceId: 's1',
        identifiability: 3,
        evidence: '',
        roles: [],
        offTopicSentenceIds: [],
        unityRationale: '',
        pairs: [],
        rationale: '',
      },
      scoring: { dimensions: [] },
    };
    return {
      data: options.schema.parse(answers[options.schemaName]),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as LlmClient['completeJson'];
  const analyzer = createPaperParagraphAnalyzer({ completeJson }, repositories, paper);
  const paragraph = paper.paragraphs[0];
  if (!paragraph) throw new Error('missing paragraph');
  const context = { role: 'results' as const, heading: 'Results', previousLast: null, nextFirst: null };
  const id = await analyzer.analyze(paragraph, context, 'detectors', null);
  for (const step of ['syntax', 'judge', 'structure', 'score'] as const) {
    expect(await analyzer.analyze(paragraph, context, step, id)).toBe(id);
  }
  const analysis = await repositories.analyses.get(id);
  expect(analysis?.versions).toMatchObject({
    syntaxProvider: 'sent-syntax-paper-1',
    judgePrompt: 'cand-judge-paper-1',
    structurePrompt: 'para-struct-paper-1',
    scoringPrompt: 'score-paper-1',
  });
  expect(analysis?.contextLimited).toBe(true);
  expect(completeJson).toHaveBeenCalledTimes(4);
  const candidate = analysis?.issues[0];
  if (!analysis || !candidate) throw new Error('missing candidate');
  const flow = {
    ...candidate,
    id: 'retained-flow',
    category: 'flow' as const,
    status: 'dismissed_by_human' as const,
  };
  await repositories.analyses.update(id, { issues: [...analysis.issues, flow] });
  await analyzer.analyze(paragraph, context, 'detectors', id);
  await analyzer.analyze(paragraph, context, 'syntax', id);
  const refreshed = await repositories.analyses.get(id);
  expect(refreshed?.issues.find((issue) => issue.id === flow.id)?.status).toBe('dismissed_by_human');
  expect(refreshed?.scores).toEqual(analysis.scores);
  const plan = planRun(paper, { sectionIds: ['s'], steps: ['syntax'], budget: 5 });
  const run: PaperRun = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    paperId: paper.id,
    createdAt: at,
    updatedAt: at,
    status: 'idle',
    plan,
    budget: 5,
    callsUsed: 0,
    promptVersions: { syntax: 'sent-syntax-paper-1' },
    model: 'fake',
    items: [],
  };
  expect(await analyzer.findCached(paragraph, run)).toBe(id);
  expect(await analyzer.findCached(paragraph, { ...run, model: 'different' })).toBeNull();
  const changed = createPaperParagraphAnalyzer({ completeJson }, repositories, {
    ...paper,
    sections: paper.sections.map((section) => ({ ...section, role: 'discussion' })),
  });
  expect(await changed.findCached(paragraph, run)).toBeNull();
});

it('P2 uses one syntax request for a long paragraph and reports repair', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const at = '2026-01-01T00:00:00.000Z';
  const text = Array(41).fill('This works.').join(' ');
  const paragraph = {
    id: 'p',
    sectionId: 's',
    order: 0,
    text,
    textHash: await sourceHash(text),
    kind: 'body' as const,
    pageStart: null,
  };
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: '',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [{ id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: null }],
    paragraphs: [paragraph],
  };
  const repositories = createRepositories(createDb(`p2-${crypto.randomUUID()}`));
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    await options.onRequest?.();
    return {
      data: options.schema.parse({ sentences: [] }),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: true },
    };
  }) as LlmClient['completeJson'];
  const analyzer = createPaperParagraphAnalyzer({ completeJson }, repositories, paper);
  const onRepair = vi.fn(async () => {});
  await analyzer.analyze(
    paragraph,
    {
      role: 'methods',
      heading: 'Methods',
      previousLast: null,
      nextFirst: null,
    },
    'syntax',
    null,
    onRepair,
  );
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(onRepair).toHaveBeenCalledOnce();
});
