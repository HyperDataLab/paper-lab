import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { exampleInsights, examplePaper, exampleStance } from '@/core/paperModel/contract';
import type { Corpus } from '@/core/schemas/corpus';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LabelReview } from './LabelReview';
import { LABEL_VERSIONS, labelSections } from './labelPlan';

it('C4b a review decision updates precision', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`label-review-${crypto.randomUUID()}`));
  const paper = examplePaper();
  const stance = exampleStance(paper);
  const run = stance.runs[0];
  if (!run) throw new Error('missing run');
  Object.assign(run, { promptVersion: LABEL_VERSIONS.stance, sectionIds: labelSections(paper, 'stance') });
  const base = exampleCorpus();
  const member = base.members[0];
  if (!member) throw new Error('missing member');
  const items = [{ memberId: member.memberId, paper, insights: exampleInsights(paper), stance }];
  function Harness() {
    const [corpus, setCorpus] = useState<Corpus>(base);
    const save = async (value: Corpus) => setCorpus(await repo.corpora.save(value));
    return <LabelReview corpus={corpus} items={items} save={save} />;
  }
  await repo.corpora.save(base);
  render(
    <StorageProvider repositories={repo}>
      <Harness />
    </StorageProvider>,
  );
  expect(screen.getByText(/Một người trong lab kiểm tra mẫu này/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lấy mẫu kiểm tra' }));
  const sample = screen.getByRole('region', { name: 'Mẫu Giọng văn' });
  expect(within(sample).getByText(/seed .*:stance/)).toBeInTheDocument();
  fireEvent.click(within(sample).getByRole('radio', { name: 'Đúng' }));
  expect(await screen.findByText('100% (1/1; KTC 95 %: 21%–100%)')).toBeInTheDocument();
  expect((await repo.corpora.get(base.id))?.labelChecks).toMatchObject([
    { scheme: 'stance', label: 'boosters', verdict: 'correct', checker: 'local' },
  ]);
  // Changing the decision replaces it rather than counting the label twice.
  fireEvent.click(within(sample).getByRole('radio', { name: 'Sai' }));
  expect(await screen.findByText('0% (0/1; KTC 95 %: 0%–79%)')).toBeInTheDocument();
});
