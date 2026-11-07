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
