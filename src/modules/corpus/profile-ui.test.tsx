import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { exampleProfileInputs, syntheticPaper } from '@/core/corpusProfile/contract';
import type { Corpus } from '@/core/schemas/corpus';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CorpusProfileCard } from './CorpusProfileCard';

it('C5a computes the profile from stored papers and offers the download', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`profile-ui-${crypto.randomUUID()}`));
  const { target, control } = exampleProfileInputs();
  const withPapers = async (corpus: Corpus, journal: boolean): Promise<Corpus> => ({
    ...corpus,
    members: await Promise.all(
      corpus.members.map(async (member, i) => {
        const paper = syntheticPaper(i, journal);
        await repo.papers.create(paper);
        return {
          ...member,
          identifiers: { ...member.identifiers, paperIds: [paper.id] },
          inputs: {
            textHashes: [],
            metadataDigest: 'sha256:0',
            insightRunIds: [],
            stanceRunIds: [],
            segmenterVersion: 'x',
            sentenceKeyVersion: 'x',
          },
        };
      }),
    ),
  });
  const journal = await withPapers(target, true);
  await repo.corpora.save(journal);
  await repo.corpora.save(await withPapers(control, false));
  render(
    <StorageProvider repositories={repo}>
      <CorpusProfileCard corpus={journal} />
    </StorageProvider>,
  );
  expect(await screen.findByDisplayValue('Synthetic control')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tính profile' }));
  expect(await screen.findByText('Thăm dò', {}, { timeout: 10_000 })).toBeInTheDocument();
  expect(screen.getByText(/6 bài tạp chí, 6 bài đối chứng/)).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Tỷ lệ từ · Mở đầu' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Cụm từ đặc trưng' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải corpus-profile.json' })).toBeInTheDocument();
}, 20_000);
