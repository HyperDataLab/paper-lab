import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { analyzeText } from '@/core/text';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { ReportMenu } from '@/shared/report/ReportMenu';
import ReportPage from './ReportPage';
import ComparePage from './ComparePage';
import { buildRevision } from '@/core/revision';

async function setup() {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`report-${crypto.randomUUID()}`));
  const a = await repo.analyses.create({ text: await analyzeText('Results may grow.') });
  const b = await repo.analyses.create({ text: await analyzeText('Results grow.') });
  const fraction = (value: number) => ({ numerator: value, denominator: 100, value: value / 100 });
  for (const [item, value] of [
    [a, 50],
    [b, 75],
  ] as const) {
    await repo.analyses.update(item.id, {
      paragraphMetrics: {
        sentence_role_coverage: fraction(value),
        off_topic_sentence_count: fraction(0),
        stress_to_next_topic_alignment: fraction(0),
        unexplained_topic_shift_count: fraction(0),
        discourse_relation_coverage: fraction(0),
        topic_continuity_pattern: {
          stress_to_topic: fraction(0),
          topic_to_topic: fraction(0),
          derived: fraction(0),
          shift: fraction(0),
        },
        central_point_identifiability: fraction(0),
      },
      scores: {
        rubricVersion: 'test-rubric',
        dimensions: [
          {
            id: 'sentence_structure',
            label: 'Câu',
            weight: 1,
            applicable: true,
            notAssessableReason: null,
            rubric: 2,
            score: value,
            descriptor: 'mixed',
            confidence: 0.8,
            evidence: { issueIds: [], sentenceIds: [] },
            rationale: null,
          },
        ],
        overall: null,
        overallSuppressedReason: 'Thiếu căn cứ',
        coverage: { applicable: 1, total: 5, value: 0.2 },
        confidence: 0.8,
        contextLimited: true,
        issueSnapshot: '',
      },
    });
  }
  return { repo, a, b };
}
it('EV-12 downloads a report JSON with the expected filename', async () => {
  const { repo, a } = await setup();
  const create = vi.fn(() => 'blob:test');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe(
      `paragraph-lab-report-${a.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`,
    );
  });
  render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <ReportMenu id={a.id} />
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xuất báo cáo' }));
  fireEvent.click(screen.getByRole('button', { name: 'JSON (.json)' }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  click.mockRestore();
});
it('EV-12 renders report sections and prints', async () => {
  const { repo, a } = await setup();
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  render(
    <MemoryRouter initialEntries={[`/report/${a.id}`]}>
      <StorageProvider repositories={repo}>
        <Routes>
          <Route path="/report/:id" element={<ReportPage />} />
        </Routes>
      </StorageProvider>
    </MemoryRouter>,
  );
  for (const name of [
    'Thông tin & phiên bản',
    'Văn bản gốc',
    'Câu',
    'Cấu trúc đoạn & mạch',
    'Số liệu',
    'Điểm',
    'Vấn đề',
    'Bản sửa / nguồn soạn',
    'Giới hạn',
  ])
    expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'In / Lưu PDF' }));
  expect(print).toHaveBeenCalledOnce();
  print.mockRestore();
});
it('AC-08 renders metric and score deltas for two analyses', async () => {
  const { repo, a, b } = await setup();
  render(
    <MemoryRouter initialEntries={[`/compare?a=${a.id}&b=${b.id}`]}>
      <StorageProvider repositories={repo}>
        <ComparePage />
      </StorageProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'So sánh phiên bản' })).toBeInTheDocument();
  expect(screen.getByText('↑ 0.25')).toBeInTheDocument();
  expect(screen.getByText('↑ 25.00')).toBeInTheDocument();
  expect(screen.getAllByText(/Rubric test-rubric/)).toHaveLength(2);
  expect(screen.getByText(/Kiểm tra tính lại/)).toBeInTheDocument();
});

it('AC-08 uses saved revision checks, shows unevaluated state and Vietnamese labels', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`revision-report-${crypto.randomUUID()}`));
  const issue = {
    id: 'i',
    type: 'WEAK_MODIFIER' as const,
    category: 'word' as const,
    findingKind: 'review_candidate' as const,
    status: 'confirmed_by_human' as const,
    severity: 'minor' as const,
    spans: [{ start: 0, end: 5, role: 'word' }],
    sentenceIds: ['s1'],
    metric: { name: 'word', value: null, unit: null },
    why: 'Review',
    suggestedFix: null,
    sourcePrinciple: 'Ch. 16',
    confidence: 1,
  };
  const source = await repo.analyses.create({
    text: await analyzeText('Alpha may grow.'),
    issues: [issue],
    versions: { detectors: 'v1' },
  });
  const revision = await buildRevision(
    source,
    { revisedText: 'Plants grow.', changes: [], needsEvidence: [] },
    [issue],
    { preserveClaims: true, preserveHedging: true, noNewFacts: true, preserveTerms: ['Alpha'] },
    { id: crypto.randomUUID(), model: 'test', createdAt: new Date().toISOString() },
  );
  await repo.revisions.create(revision);
  const applied = await repo.revisions.applyRevision(source.id, revision.id);
  const view = render(
    <MemoryRouter initialEntries={[`/compare?a=${source.id}&b=${applied.id}`]}>
      <StorageProvider repositories={repo}>
        <ComparePage />
      </StorageProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Chưa so sánh được/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Mở bản so sánh/ })).toHaveAttribute(
    'href',
    `/evaluate?id=${applied.id}`,
  );
  expect(screen.getByText(/Kiểm tra đã lưu/)).toBeInTheDocument();
  expect(screen.getByTitle('preserve_terms')).toHaveTextContent('Giữ thuật ngữ');
  expect(screen.getByText(/Thiếu: Alpha/)).toHaveTextContent('Không đạt');
  view.unmount();
  await repo.analyses.update(applied.id, { versions: { ...applied.versions, detectors: 'v1' } });
  render(
    <MemoryRouter initialEntries={[`/compare?a=${applied.id}&b=${source.id}`]}>
      <StorageProvider repositories={repo}>
        <ComparePage />
      </StorageProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Kiểm tra đã lưu/)).toBeInTheDocument();
  expect(screen.getByText(/Thiếu: Alpha/)).toHaveTextContent('Không đạt');
  expect(screen.getByTitle('WEAK_MODIFIER')).toHaveTextContent('Từ bổ nghĩa cần xem xét');
  expect(screen.getByTitle('confirmed_by_human')).toHaveTextContent('Đã xác nhận');
  expect(screen.getByTitle('fail').querySelector('svg')).toBeInTheDocument();
});
