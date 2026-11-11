import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleInsights, examplePaper, exampleStance } from '@/core/paperModel/contract';
import { PaperModelSchema } from '@/core/schemas';
import { downloadJson } from '@/shared/calibration/download';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperMetadata } from './PaperMetadata';

vi.mock('@/shared/calibration/download', () => ({ downloadJson: vi.fn(), downloadText: vi.fn() }));

async function setup() {
  vi.stubGlobal('crypto', webcrypto);
  const db = createDb(`metadata-${crypto.randomUUID()}`);
  const repo = createRepositories(db);
  const paper = examplePaper();
  await repo.papers.create(paper);
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
    const { db, paper } = await setup();
    await db.paperInsights.put(exampleInsights(paper));
    await db.stance.put(exampleStance(paper));
    expect(await screen.findByText('4 câu · 1 tài liệu tham khảo')).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Edited synthetic title' } });
    fireEvent.change(screen.getByLabelText('Tác giả'), { target: { value: 'Ann Lee\n\n Bo Wu \n' } });
    fireEvent.change(screen.getByLabelText('Từ khoá'), { target: { value: 'keys, models ,' } });
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
    expect(screen.getByText('Edited synthetic title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tải paper-model.json' }));
    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
    const [name, value] = vi.mocked(downloadJson).mock.calls[0]!;
    expect(name).toBe('edited-synthetic-title-paper-model.json');
    expect(PaperModelSchema.parse(value).document.metadata).toMatchObject({ source: 'manual', year: 2024 });
  });

  it('Huỷ leaves the record untouched', async () => {
    const { repo, paper } = await setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thông tin' }));
    fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'Not saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByLabelText('Tên')).not.toBeInTheDocument();
    expect(await repo.paperContext.get(paper.id)).toBeUndefined();
  });
});
