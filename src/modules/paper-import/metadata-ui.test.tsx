import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleInsights, examplePaper, exampleStance } from '@/core/paperModel/contract';
import { PaperModelSchema } from '@/core/schemas';
import { downloadJson, downloadText } from '@/shared/calibration/download';
import { MemoryDocStore } from '@/shared/storage/docStore';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperMetadata } from './PaperMetadata';
import { testRepositories } from '@/shared/storage/testRepositories';

vi.mock('@/shared/calibration/download', () => ({ downloadJson: vi.fn(), downloadText: vi.fn() }));

async function setup(
  seed?: (db: MemoryDocStore, paper: ReturnType<typeof examplePaper>) => Promise<unknown>,
) {
  vi.stubGlobal('crypto', webcrypto);
  const db = new MemoryDocStore();
  const repo = testRepositories({ store: db });
  const paper = examplePaper();
  await repo.papers.create(paper);
  await seed?.(db, paper);
  render(
    <StorageProvider repositories={repo}>
      <PaperMetadata paper={paper} />
    </StorageProvider>,
  );
  return { db, repo, paper };
}

describe('R17a Publication info: metadata form and paper model', () => {
  beforeEach(() => vi.mocked(downloadJson).mockClear());

  it('downloads a valid paper-model.json carrying the stored labels', async () => {
    await setup(async (db, paper) => {
      await db.put('paperInsights', paper.id, exampleInsights(paper));
      await db.put('stance', paper.id, exampleStance(paper));
    });
    expect(await screen.findByText(/4 câu · 1 reference/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tải paper-model.json' }));
    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
    const [name, value] = vi.mocked(downloadJson).mock.calls[0]!;
    expect(name).toBe('synthetic-paper-paper-model.json');
    const model = PaperModelSchema.parse(value);
    expect(model.sentences).toHaveLength(4);
    expect(model.document.metadata.source).toBe('parsed');
    expect(new Set(model.annotations.map((a) => a.scheme))).toEqual(
      new Set(['paperlab-rhetoric', 'paperlab-stance']),
    );
  });

  it('edits metadata by hand for a paper with no DOI and no record', async () => {
    const { repo, paper } = await setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thông tin' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited synthetic title' } });
    fireEvent.change(screen.getByLabelText('Tác giả'), { target: { value: 'Ann Lee\n\n Bo Wu \n' } });
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'keys, models ,' } });
    fireEvent.change(screen.getByLabelText('Năm'), { target: { value: '20.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Năm phải là số nguyên');
    expect(await repo.paperContext.get(paper.id)).toBeUndefined();

    fireEvent.change(screen.getByLabelText('Năm'), { target: { value: '2024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/Nguồn: Nhập tay/u)).toBeInTheDocument();
    const saved = await repo.paperContext.get(paper.id);
    expect(saved?.metadata).toMatchObject({
      source: 'manual',
      title: 'Edited synthetic title',
      authors: ['Ann Lee', 'Bo Wu'],
      keywords: ['keys', 'models'],
      year: 2024,
      doi: null,
    });
    expect(saved?.paperDoi).toBeNull();
    // Once in the "Tiêu đề đầy đủ" block above the sheet and once in its Title row.
    expect(screen.getAllByText('Edited synthetic title')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Tải paper-model.json' }));
    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
    const [name, value] = vi.mocked(downloadJson).mock.calls[0]!;
    expect(name).toBe('edited-synthetic-title-paper-model.json');
    expect(PaperModelSchema.parse(value).document.metadata).toMatchObject({ source: 'manual', year: 2024 });
  });

  it('Huỷ leaves the record untouched', async () => {
    const { repo, paper } = await setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thông tin' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Not saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(await repo.paperContext.get(paper.id)).toBeUndefined();
  });
});

it('R17d downloads article.xml from the publication info', async () => {
  vi.mocked(downloadText).mockClear();
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Tải article.xml (JATS)' }));
  await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1));
  const [name, xml, type] = vi.mocked(downloadText).mock.calls[0]!;
  expect(name).toBe('synthetic-paper-paper-model.jats.xml');
  expect(type).toBe('application/xml');
  expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('article')).not.toBeNull();
});
