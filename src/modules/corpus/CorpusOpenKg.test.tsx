import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import { buildCorpusKg } from '@/core/openkg';
import type { Paper } from '@/core/schemas';
import type { CorpusMember } from '@/core/schemas/corpus';
import { downloadText } from '@/shared/calibration/download';
import { CompositeDocStore } from '@/shared/storage/compositeDocStore';
import { DexieDocStore } from '@/shared/storage/dexieDocStore';
import { testWorkerData } from '@/shared/storage/remoteTestSupport';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { CorpusOpenKg } from './CorpusOpenKg';
import { CorpusOpenKgView } from './CorpusOpenKgView';

vi.mock('@/shared/calibration/download', () => ({ downloadText: vi.fn() }));

const base = exampleCorpus();
const template = base.members[0];
if (!template) throw new Error('Missing synthetic member');
const at = '2026-01-01T00:00:00.000Z';
const paper: Paper = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000301',
  title: 'Synthetic Alpha',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'text', fileName: 'synthetic.txt', pageCount: null, sha256: '' },
  sections: [],
  paragraphs: [],
};
const member = (memberId: string, overrides: Partial<CorpusMember['identifiers']> = {}): CorpusMember => ({
  ...template,
  memberId,
  title: `Synthetic ${memberId}`,
  identifiers: { paperIds: [], libraryIds: [], sha256: [], ...overrides },
});
const keyword = { id: 'keywords/synthetic', name: 'Synthetic keyword', score: 0.75 };

it.each(['local', 'remote'])(
  'K3 renders the %s corpus graph and updates after keyword backfill',
  async (backend) => {
    const db = createDb(`openkg-ui-${crypto.randomUUID()}`);
    vi.stubGlobal('crypto', webcrypto);
    const worker = backend === 'remote' ? testWorkerData() : null;
    const remote = worker?.connect();
    const repo = createRepositories(
      db,
      undefined,
      undefined,
      new CompositeDocStore(new DexieDocStore(db), remote ?? null),
      remote,
    );
    const corpus = {
      ...base,
      members: [
        { ...member('Alpha', { paperIds: [paper.id], doi: '10.1000/alpha' }), stratum: { year: 2024 } },
        { ...member('Beta', { doi: '10.1000/beta' }), stratum: { year: 2025 } },
      ],
    };
    await repo.papers.create(paper);
    const {
      added: [entry],
    } = await repo.library.addDois(['10.1000/alpha']);
    if (!entry) throw new Error('Missing synthetic lookup');
    await repo.library.update(entry.id, { paper_id: paper.id, keywords: [keyword] });
    const view = render(
      <StorageProvider repositories={repo}>
        <CorpusOpenKg corpus={corpus} />
      </StorageProvider>,
    );
    try {
      const region = screen.getByRole('region', { name: 'Đồ thị tri thức (OpenKG)' });
      const graph = await within(region).findByRole('group', { name: 'Đồ thị tri thức của corpus' });
      expect(within(region).getByText('Bài có mô hình').parentElement).toHaveTextContent('1/2');
      expect(within(region).getByText('Bài có tra cứu OpenAlex').parentElement).toHaveTextContent('1/2');
      expect(within(region).getByText('Bài có kết quả SCG').parentElement).toHaveTextContent('0/2');
      const table = within(region).getByRole('table', { name: 'Số bài theo keyword và năm xuất bản' });
      expect(within(table).getByRole('columnheader', { name: 'Keywords' })).toBeInTheDocument();
      expect(within(table).getByRole('columnheader', { name: '2025' })).toBeInTheDocument();
      expect(
        within(table)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ).toEqual(['1', '1', '0']);

      fireEvent.keyDown(within(graph).getByRole('button', { name: 'Synthetic keyword' }), { key: 'Enter' });
      const inspector = within(region).getByRole('complementary', { name: 'Chi tiết nút' });
      expect(within(inspector).getByRole('heading', { name: 'Synthetic keyword' })).toBeInTheDocument();
      expect(within(inspector).getByText('Keyword')).toBeInTheDocument();
      expect(within(inspector).getByText('có keyword')).toBeInTheDocument();
      expect(within(inspector).getByRole('list', { name: 'Bài báo làm căn cứ' })).toHaveTextContent(
        'Synthetic Alpha · OpenAlex',
      );

      const conceptual = within(region).getByRole('button', { name: 'Khái niệm (1)' });
      fireEvent.click(conceptual);
      expect(conceptual).toHaveAttribute('aria-pressed', 'false');
      expect(within(graph).queryByRole('button', { name: 'Synthetic keyword' })).not.toBeInTheDocument();
      expect(within(inspector).getByRole('heading', { name: 'Chi tiết nút' })).toBeInTheDocument();

      for (const [label, extension] of [
        ['Turtle (.ttl)', 'ttl'],
        ['JSON-LD (.jsonld)', 'jsonld'],
        ['Báo cáo (.md)', 'md'],
      ]) {
        fireEvent.click(within(region).getByRole('button', { name: 'Xuất đồ thị' }));
        fireEvent.click(within(region).getByRole('menuitem', { name: label }));
        expect(downloadText).toHaveBeenLastCalledWith(
          `openkg-corpus-${corpus.id}.${extension}`,
          expect.stringContaining('Synthetic keyword'),
          expect.any(String),
        );
      }

      await act(() =>
        repo.corpusKeywords.saveFetched({ memberId: 'Beta', doi: '10.1000/beta', libraryId: null }, [
          keyword,
        ]),
      );
      await within(region).findByText('2/2');
      expect(
        within(table)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ).toEqual(['2', '1', '1']);
      fireEvent.click(within(region).getByRole('button', { name: 'Khái niệm (2)' }));
      expect(within(inspector).getByRole('heading', { name: 'Synthetic keyword' })).toBeInTheDocument();
      expect(within(inspector).getAllByRole('list', { name: 'Bài báo làm căn cứ' })).toHaveLength(2);
    } finally {
      view.unmount();
      await db.delete();
      vi.unstubAllGlobals();
    }
  },
);

it('K3 caps the diagram by degree and offers a searchable text list for nodes beyond the cap', () => {
  const hub = 'Z hub';
  const outside = 'Z outside';
  const members = [
    ...Array.from({ length: 120 }, (_, i) => member(`A${String(i).padStart(3, '0')}`)),
    member(hub),
    member(outside),
  ];
  const kg = buildCorpusKg({
    papers: [],
    members,
    memberMetadata: new Map([[hub, { keywords: [keyword] }]]),
  });
  render(<CorpusOpenKgView kg={kg} corpusId={base.id} title={base.title} />);
  const graph = screen.getByRole('group', { name: 'Đồ thị tri thức của corpus' });
  expect(within(graph).getAllByRole('button')).toHaveLength(120);
  expect(within(graph).getByRole('button', { name: `Synthetic ${hub}` })).toBeInTheDocument();
  expect(within(graph).queryByRole('button', { name: `Synthetic ${outside}` })).not.toBeInTheDocument();
  expect(screen.getByText(/Hình vẽ hiện 120\/123 nút/u)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Danh sách nút (123)'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm nút theo tên' }), {
    target: { value: outside },
  });
  fireEvent.click(screen.getByRole('button', { name: `Synthetic ${outside} · Bài báo` }));
  expect(screen.getByRole('heading', { name: `Synthetic ${outside}` })).toBeInTheDocument();
});
