import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { analyzeText } from '@/core/text';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Page from './Page';

it('P7 previews matched and unmatched labels, imports, downloads a template and deletes', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`calibration-ui-${crypto.randomUUID()}`));
  const text = await analyzeText('Very clear.');
  await repo.analyses.create({
    text,
    issues: [
      {
        id: 'i',
        type: 'WEAK_MODIFIER',
        category: 'word',
        findingKind: 'review_candidate',
        status: 'candidate',
        severity: 'minor',
        spans: [{ start: 0, end: 4, role: 'word' }],
        sentenceIds: ['s1'],
        metric: { name: 'x', value: null, unit: null },
        why: '',
        suggestedFix: null,
        sourcePrinciple: '',
        confidence: 1,
      },
    ],
  });
  const create = vi.fn(() => 'blob:test');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(
    <StorageProvider repositories={repo}>
      <Page />
    </StorageProvider>,
  );
  expect(await screen.findByText('Vấn đề: Từ bổ nghĩa cần xem xét')).toHaveAttribute(
    'title',
    'WEAK_MODIFIER',
  );
  expect(screen.getByText('Chưa hiệu chuẩn (n=0)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tải mẫu nhãn' }));
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
  const label = {
    rater: 'Alice',
    target: { kind: 'issue', type: 'WEAK_MODIFIER', textHash: text.sourceHash, quote: 'Very' },
    label: 'correct',
  };
  const file = new File([], 'labels.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', {
    value: async () =>
      JSON.stringify({
        format: 'paragraph-lab-labels',
        version: 1,
        labels: [label, { ...label, target: { ...label.target, quote: 'absent' } }],
      }),
  });
  fireEvent.change(screen.getByLabelText('Tệp nhãn'), { target: { files: [file] } });
  expect(await screen.findByText(/Khớp: 1 · Không khớp: 1/)).toBeInTheDocument();
  expect(screen.getByText('Alice: n=2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nhập nhãn' }));
  expect(await screen.findByText('Chưa hiệu chuẩn (n=1)')).toBeInTheDocument();
  expect(screen.getByText(/labels.json/)).toBeInTheDocument();
  await repo.calibrationLabels.import('duplicate.json', {
    format: 'paragraph-lab-labels',
    version: 1,
    labels: [label],
  });
  expect(
    (await import('@/shared/calibration/data')).calibrationData(await repo.transfer.exportAll('test'))
      .stats[0]?.n,
  ).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Xoá bộ nhãn' }));
  await waitFor(() => expect(screen.queryByText(/labels.json/)).not.toBeInTheDocument());
  const conflict = new File([], 'conflict.json', { type: 'application/json' });
  Object.defineProperty(conflict, 'text', {
    value: async () =>
      JSON.stringify({
        format: 'paragraph-lab-labels',
        version: 1,
        labels: [{ ...label, label: 'incorrect' }],
      }),
  });
  fireEvent.change(screen.getByLabelText('Tệp nhãn'), { target: { files: [conflict] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận nhập nhãn' }));
  expect(
    await screen.findByText(/Mâu thuẫn giữa các nhãn cùng người đánh giá và mục: 1/),
  ).toBeInTheDocument();
  expect(screen.getByText('Chưa hiệu chuẩn (n=1)')).toBeInTheDocument();
  click.mockRestore();
});
