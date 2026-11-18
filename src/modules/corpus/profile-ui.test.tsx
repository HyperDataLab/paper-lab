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
  const view = render(
    <StorageProvider repositories={repo}>
      <CorpusProfileCard corpus={journal} />
    </StorageProvider>,
  );
  expect(await screen.findByDisplayValue('Synthetic control')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tính profile' }));
  expect(await screen.findByText('Thăm dò', {}, { timeout: 10_000 })).toBeInTheDocument();
  expect(screen.getByText(/6 bài tạp chí, 6 bài đối chứng/)).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'Tỷ lệ từ · Introduction' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Cụm từ đặc trưng' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tải corpus-profile.json' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trên tập giữ riêng' }));
  expect(await screen.findByText(/AUC/)).toBeInTheDocument();
  const backup = await repo.transfer.exportAll('test');
  const restored = createRepositories(createDb(`profile-restored-${crypto.randomUUID()}`));
  const plan = await restored.transfer.previewImport(backup);
  if (!plan.ok) throw new Error(plan.error);
  await restored.transfer.applyImport(plan);
  expect((await restored.corpusProfiles.get(journal.id))?.profile.holdout).toBeDefined();
  view.unmount();
  const reload = (corpus: Corpus) =>
    render(
      <StorageProvider repositories={repo}>
        <CorpusProfileCard corpus={corpus} />
      </StorageProvider>,
    );
  const reopened = reload(journal);
  expect(await screen.findByText(/Đã tính:/)).toBeInTheDocument();
  expect(await screen.findByText(/AUC/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tính lại' })).toBeInTheDocument();
  reopened.unmount();
  const changed = { ...journal, members: journal.members.slice(1) };
  await repo.corpora.save(changed);
  reload(changed);
  expect(await screen.findByText('Corpus đã thay đổi kể từ lần tính')).toBeInTheDocument();
}, 20_000);

it('P2 exports the draft profile v2 next to v1 without storing it', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`profile-v2-ui-${crypto.randomUUID()}`));
  const { target, control } = exampleProfileInputs();
  const withPapers = async (corpus: Corpus, journal: boolean): Promise<Corpus> => ({
    ...corpus,
    members: await Promise.all(
      corpus.members.map(async (member, i) => {
        const paper = syntheticPaper(i, journal);
        await repo.papers.create(paper);
        return { ...member, identifiers: { ...member.identifiers, paperIds: [paper.id] } };
      }),
    ),
  });
  const journal = await withPapers(target, true);
  await repo.corpora.save(journal);
  await repo.corpora.save(await withPapers(control, false));
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:profile';
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(
    <StorageProvider repositories={repo}>
      <CorpusProfileCard corpus={journal} />
    </StorageProvider>,
  );
  expect(await screen.findByDisplayValue('Synthetic control')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tải profile v2 (nháp)' }));
  await vi.waitFor(() => expect(click).toHaveBeenCalled(), { timeout: 10_000 });
  const exported = JSON.parse(await (blobs[0] as Blob).text()) as Record<string, unknown>;
  expect(exported).toMatchObject({ schemaVersion: 2, draft: true, scope: 'signature' });
  expect(await repo.corpusProfiles.get(journal.id)).toBeUndefined();
  click.mockRestore();
}, 20_000);
