import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { transitionFindings, transitionPairs, validateTransitions } from '@/core/paperOverview';
import { analyzeText } from '@/core/text';
import type { Issue, Paper, SentenceAnnotation } from '@/core/schemas';
import type { Scores } from '@/core/schemas/scores';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import type { LlmClient } from '@/shared/llm/client';
import PaperMapPage from './PaperMapPage';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
const at = '2026-01-01T00:00:00.000Z';
async function setup(modelConfirmed = false) {
  let time = Date.parse(at);
  const repo = createRepositories(
    createDb(`overview-ui-${crypto.randomUUID()}`),
    () => new Date((time += 1000)),
  );
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Bài thử',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [
      { id: 's1', heading: 'Introduction', role: 'introduction', level: 1, pageStart: null },
      { id: 's2', heading: 'Results', role: 'results', level: 1, pageStart: null },
    ],
    paragraphs: ['s1', 's1', 's2', 's2'].map((sectionId, order) => ({
      id: `p${order + 1}`,
      sectionId,
      order,
      kind: 'body',
      text: `Paragraph ${order + 1}.`,
      pageStart: null,
      textHash: `h${order}`,
    })),
  };
  await repo.papers.create(paper);
  const issue: Issue = {
    id: 'issue',
    type: 'FUZZY_VERB',
    category: 'word',
    findingKind: 'review_candidate',
    status: modelConfirmed ? 'confirmed_by_model' : 'candidate',
    severity: 'minor',
    spans: [{ start: 0, end: 9, role: 'word' }],
    sentenceIds: ['s1'],
    metric: { name: '', value: null, unit: null },
    why: '',
    suggestedFix: null,
    sourcePrinciple: '',
    confidence: 1,
  };
  const annotation: SentenceAnnotation = {
    sentenceId: 's1',
    topicSpan: { start: 0, end: 9 },
    stressSpan: { start: 0, end: 9 },
    actionSpan: null,
    role: null,
    roleConfidence: null,
    roleRationale: null,
    subjectVerbDistanceTokens: null,
    parseConfidence: null,
    subjectSpan: null,
    verbSpan: null,
    interveningSpan: null,
    subjectHeadTokenIndex: null,
    verbHeadTokenIndex: null,
    voice: null,
    clauseCount: null,
    maxClauseDepth: null,
    preTopicTokens: null,
    topicPositionRatio: null,
    stressEndDistance: null,
    unresolved: [],
  };
  for (const [i, p] of paper.paragraphs.entries()) {
    if (i === 3) continue;
    const scores: Scores = {
      rubricVersion: 'r',
      dimensions: [
        {
          id: 'sentence_structure',
          label: '',
          weight: 1,
          applicable: true,
          notAssessableReason: null,
          rubric: 2,
          score: i === 0 ? 50 : 75,
          descriptor: null,
          confidence: 1,
          evidence: { issueIds: [], sentenceIds: [] },
          rationale: null,
        },
      ],
      overall: null,
      overallSuppressedReason: null,
      coverage: { applicable: 1, total: 5, value: 0.2 },
      confidence: 1,
      contextLimited: true,
      issueSnapshot: '',
    };
    await repo.analyses.create({
      text: await analyzeText(p.text),
      origin: { kind: 'paper', paperId: paper.id, paragraphId: p.id },
      sentenceAnnotations: [annotation],
      issues: [issue],
      scores,
    });
  }
  const analyses = await repo.analyses.listByPaper(paper.id);
  const pairs = transitionPairs(paper, analyses);
  const judgements = validateTransitions(
    {
      pairs: [
        {
          pairId: pairs[0]?.pairId,
          continuity: 'shift',
          discourseRelation: 'none',
          linked: false,
          confidence: 0.8,
          rationale: 'Chuyển ý.',
        },
      ],
    },
    pairs,
  );
  const overview = await repo.paperOverviews.get(paper.id);
  if (!overview || !pairs[0] || !analyses[0]) throw new Error('Missing test data');
  await repo.paperOverviews.save({
    ...overview,
    transitions: {
      pairs,
      judgements,
      findings: transitionFindings(pairs, judgements).map((finding) => ({
        ...finding,
        status: modelConfirmed ? 'confirmed_by_model' : finding.status,
      })),
      model: 'fake',
      promptVersion: 'para-flow-1',
      updatedAt: at,
    },
  });
  await repo.analyses.update(pairs[0].from.analysisId, { title: 'Mới' });
  const client: LlmClient = {
    completeJson: async () => {
      throw new Error('No network in UI test');
    },
  };
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={client}>
          <Routes>
            <Route path="/papers/:id" element={<PaperMapPage />} />
            <Route path="/evaluate" element={<p>Đánh giá</p>} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('tab', { name: 'Đọc bài' });
  return { repo, paper };
}
it('P3 shows distributions, recurring filters, transition review and stale notice', async () => {
  const { repo, paper } = await setup();
  fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chất lượng viết' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Câu và từ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Introduction/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Phân tích câu' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Đánh giá ngữ cảnh' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Cấu trúc đoạn' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chấm điểm' }));
  expect(screen.getByText('Chuyển đoạn: ~1 lượt gọi AI')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chất lượng viết' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Cấu trúc và mạch' }));
  expect(await screen.findByText('Đã phân tích 3/4 đoạn (75 %)')).toBeInTheDocument();
  expect(screen.getByText(/Kết quả chuyển đoạn đã cũ/)).toBeInTheDocument();
  expect(screen.getAllByText('Chưa đủ dữ liệu').length).toBeGreaterThan(0);
  expect(screen.getByText(/Tổng quan chỉ thống kê kết quả/)).toBeInTheDocument();
  expect(screen.queryByText(/tổng điểm|điểm tổng/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Chuyển chủ đề · Không có/)).toHaveTextContent('Không liên kết');
  expect(screen.getByRole('link', { name: 'p1' })).toHaveAttribute(
    'href',
    expect.stringContaining('/evaluate?id='),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText(/Đã xác nhận/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Bỏ qua' }));
  expect(await screen.findByText(/Đã bỏ qua/)).toBeInTheDocument();
  expect(
    (await repo.audit.listByAnalysis(paper.id)).items.filter((e) => e.action === 'review_transition'),
  ).toHaveLength(3);
  fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chất lượng viết' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Câu và từ' }));
  expect(await screen.findByText('62,5 (56,25–68,75, n = 2)')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /Động từ chưa cụ thể · 3 lần/ }));
  expect(screen.getByRole('tab', { name: 'Đọc bài' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Paragraph 1.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('treeitem', { name: /Results/ }));
  expect(screen.getByText('Paragraph 3.')).toBeInTheDocument();
  expect(screen.queryByText('Paragraph 4.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc' }));
  expect(screen.getByText('Paragraph 4.')).toBeInTheDocument();
  expect(within(screen.getByRole('tablist', { name: 'Bài báo' })).getAllByRole('tab')).toHaveLength(4);
});
it('P3 marks a transition unavailable when its annotations disappear', async () => {
  const { repo, paper } = await setup();
  const analyses = await repo.analyses.listByPaper(paper.id);
  const first = analyses.find((item) => item.origin?.kind === 'paper' && item.origin.paragraphId === 'p1');
  if (!first) throw new Error('Missing analysis');
  await repo.analyses.update(first.id, { sentenceAnnotations: [] });
  fireEvent.click(screen.getByRole('tab', { name: 'Hồ sơ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chất lượng viết' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Cấu trúc và mạch' }));
  expect(await screen.findByText('Không còn hợp lệ')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
});

it('R5 decides writing and transition findings from the unified list', async () => {
  const { repo, paper } = await setup();
  fireEvent.click(screen.getByRole('tab', { name: 'Phát hiện' }));
  const list = await screen.findByRole('region', { name: 'Danh sách phát hiện' });
  const analyses = await repo.analyses.listByPaper(paper.id);
  const writing = list.querySelector(`[id="finding-writing:${analyses[0]?.id}:issue"]`);
  const transition = list.querySelector('[id^="finding-transition:"]');
  if (!(writing instanceof HTMLElement) || !(transition instanceof HTMLElement))
    throw new Error('Missing findings');
  fireEvent.click(within(writing).getByRole('button', { name: 'Xác nhận' }));
  await within(writing).findByText('Đã xác nhận');
  expect((await repo.analyses.get(analyses[0]!.id))?.issues[0]?.status).toBe('confirmed_by_human');
  fireEvent.click(within(transition).getByRole('button', { name: 'Xác nhận' }));
  await within(transition).findByText('Đã xác nhận');
  expect((await repo.paperOverviews.get(paper.id))?.transitions?.findings[0]?.status).toBe(
    'confirmed_by_human',
  );
});

it('R5 restores model verdicts after human decisions on writing and transition findings', async () => {
  const { repo, paper } = await setup(true);
  fireEvent.click(screen.getByRole('tab', { name: 'Phát hiện' }));
  const list = await screen.findByRole('region', { name: 'Danh sách phát hiện' });
  const analyses = await repo.analyses.listByPaper(paper.id);
  const analysis = analyses[0];
  if (!analysis) throw new Error('Missing analysis');
  const writing = list.querySelector(`[id="finding-writing:${analysis.id}:issue"]`);
  const transition = list.querySelector('[id^="finding-transition:"]');
  if (!(writing instanceof HTMLElement) || !(transition instanceof HTMLElement))
    throw new Error('Missing findings');
  for (const row of [writing, transition]) {
    fireEvent.click(within(row).getByRole('button', { name: 'Xác nhận' }));
    await within(row).findByText('Đã xác nhận');
    fireEvent.click(within(row).getByRole('button', { name: 'Hoàn tác' }));
    await within(row).findByRole('button', { name: 'Xác nhận' });
  }
  expect((await repo.analyses.get(analysis.id))?.issues[0]?.status).toBe('confirmed_by_model');
  expect((await repo.paperOverviews.get(paper.id))?.transitions?.findings[0]?.status).toBe(
    'confirmed_by_model',
  );
});

it('R5 full reader switches writing marks and shows a margin criterion', async () => {
  await setup();
  fireEvent.click(screen.getByRole('tab', { name: 'Đọc bài' }));
  const layers = await screen.findByRole('group', { name: 'Lớp đánh dấu trên bài' });
  const writing = within(layers).getByRole('button', { name: /Cách viết/ });
  expect(writing).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(writing);
  const paragraph = document.querySelector('#paper-paragraph-p1');
  if (!(paragraph instanceof HTMLElement)) throw new Error('Missing paragraph');
  await within(paragraph).findByRole('button', { name: /Paragraph/ });
  expect(paragraph.querySelector('[class*="gutter"] [data-criterion="writing"]')).toBeInTheDocument();
  fireEvent.click(writing);
  expect(paragraph.querySelector('[class*="gutter"] [data-criterion="writing"]')).toBeNull();
});
