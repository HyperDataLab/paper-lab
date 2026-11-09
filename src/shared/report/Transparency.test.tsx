import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { downloadJson } from '@/shared/calibration/download';
import { Transparency } from './Transparency';
vi.mock('@/shared/calibration/download', () => ({ downloadJson: vi.fn() }));
it('P7 transparency uses planned sections, excludes skipped items, identifies cached sections and exports snapshots', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`transparency-${crypto.randomUUID()}`));
  const at = '2026-01-01T00:00:00.000Z';
  const paper = {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    title: 'Paper',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text' as const, fileName: '', pageCount: null, sha256: '' },
    sections: ['s1', 's2', 's3'].map((id) => ({
      id,
      heading: id,
      role: 'methods' as const,
      level: 1,
      pageStart: null,
    })),
    paragraphs: [],
  };
  await repo.papers.create(paper);
  const paragraphs = ['s1', 's2', 's3'].map((sectionId, i) => ({
    paragraphId: `p${i}`,
    sectionId,
    textHash: `h${i}`,
  }));
  await repo.paperRuns.create({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    paperId: paper.id,
    createdAt: at,
    updatedAt: at,
    status: 'done',
    budget: 10,
    callsUsed: 2,
    callsByStep: { score: 2 },
    calibrationSnapshots: { score: [{ kind: 'issue', type: 'FUZZY_VERB', n: 30, status: 'reliable' }] },
    model: 'm',
    promptVersions: { score: 'v1' },
    plan: {
      sectionIds: ['s1', 's2', 's3'],
      steps: ['score'],
      budget: 10,
      paragraphs,
      skipped: [{ paragraphId: 'p2', reason: 'skip' }],
      calls: { syntax: 0, judge: 0, structure: 0, score: 2 },
      total: 2,
      withinBudget: true,
    },
    items: paragraphs.map((p, i) => ({
      paragraphId: p.paragraphId,
      textHash: p.textHash,
      analysisId: null,
      status: i === 0 ? ('done' as const) : i === 1 ? ('cached' as const) : ('skipped' as const),
      stepsDone: [],
      calls: 0,
      error: null,
    })),
  });
  render(
    <StorageProvider repositories={repo}>
      <Transparency paper={paper} />
    </StorageProvider>,
  );
  fireEvent.click(screen.getByText('Minh bạch'));
  expect(await screen.findByText(/Mục gửi đến model: s1, s2/)).toHaveTextContent(
    'Mục có đoạn dùng bộ nhớ đệm: s2',
  );
  expect(screen.getByText(/Hiệu chuẩn tại thời điểm chạy/)).toHaveTextContent('Đáng tin (n=30)');
  fireEvent.click(screen.getByRole('button', { name: 'Tải bản ghi minh bạch JSON' }));
  expect(downloadJson).toHaveBeenCalledWith(
    'paperlab-transparency.json',
    expect.objectContaining({
      steps: [
        expect.objectContaining({
          sections: ['s1', 's2'],
          cachedSections: ['s2'],
          calls: 2,
          calibration: [expect.objectContaining({ status: 'reliable', n: 30 })],
        }),
      ],
    }),
  );
});
