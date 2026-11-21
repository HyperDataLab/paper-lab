import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { examplePaper, exampleStance } from '@/core/paperModel/contract';
import type { Paper } from '@/core/schemas';
import type { Corpus } from '@/core/schemas/corpus';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CorpusLabelling } from './CorpusLabelling';
import { LABEL_VERSIONS, labelSections } from './labelPlan';
import { DEFAULT_RUNNERS, loadLabelPaper, type LabelRunners } from './labelRun';
import { testRepositories } from '@/shared/storage/testRepositories';

it('C4b asks for consent once, runs the members and records the run', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  const repo = testRepositories();
  const paper = examplePaper();
  await repo.papers.create(paper);
  const base = exampleCorpus();
  const first = base.members[0];
  if (!first) throw new Error('missing member');
  const member = {
    ...first,
    retrieval: 'retrieved' as const,
    identifiers: { ...first.identifiers, paperIds: [paper.id] },
    inputs: {
      textHashes: [],
      metadataDigest: 'sha256:0',
      insightRunIds: [],
      stanceRunIds: [],
      segmenterVersion: 'x',
      sentenceKeyVersion: 'x',
    },
  };
  const corpus: Corpus = { ...base, members: [member] };
  await repo.corpora.save(corpus);
  const item = await loadLabelPaper(member, repo);
  if (!item) throw new Error('missing paper');
  const items = [item];
  const stance = vi.fn(async (_client: unknown, p: Paper) => {
    const run = exampleStance(p).runs[0];
    if (!run) throw new Error('missing run');
    return {
      run: {
        ...run,
        id: crypto.randomUUID(),
        promptVersion: LABEL_VERSIONS.stance,
        sectionIds: labelSections(p, 'stance'),
      },
      state: { sectionIds: [], callsUsed: 0, model: null, chunks: {} },
      incomplete: false,
    };
  });
  const runners = { ...DEFAULT_RUNNERS, stance } as unknown as LabelRunners;
  function Harness() {
    const [value, setValue] = useState(corpus);
    const save = async (next: Corpus) => setValue(await repo.corpora.save(next));
    return <CorpusLabelling corpus={value} items={items} save={save} runners={runners} />;
  }
  render(
    <StorageProvider repositories={repo}>
      <LlmProvider innerClient={{ completeJson: vi.fn() }}>
        <Harness />
      </LlmProvider>
    </StorageProvider>,
  );
  // Only stance is chosen, so the run makes no rhetoric call.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Validity và Moves' }));
  expect(screen.getByText(/Ước tính: \d+ lượt gọi AI cho 1\/1 bài/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu gắn nhãn' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(async () => expect((await repo.corpora.get(corpus.id))?.labelQueue?.status).toBe('complete'));
  expect(stance).toHaveBeenCalledTimes(1);
  expect((await repo.corpora.get(corpus.id))?.runs.at(-1)).toMatchObject({
    scheme: 'stance',
    promptVersion: LABEL_VERSIONS.stance,
    done: 1,
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
