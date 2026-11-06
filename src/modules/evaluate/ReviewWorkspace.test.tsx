import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { analyzeText } from '@/core/text';
import type { Issue } from '@/core/schemas';
import { ReviewWorkspace } from './ReviewWorkspace';
import { mergeHumanDecisions } from './useCandidateJudge';

const issue: Issue = {
  id: 'one',
  type: 'WEAK_MODIFIER',
  category: 'word',
  findingKind: 'review_candidate',
  status: 'candidate',
  severity: 'minor',
  spans: [{ start: 2, end: 6, role: 'word' }],
  sentenceIds: ['s1'],
  metric: { name: 'count', value: 1, unit: 'candidate' },
  why: 'First explanation',
  suggestedFix: 'Replace it',
  sourcePrinciple: 'Ch. 16',
  confidence: 0.8,
};

it('EV-10 uses code point offsets, labels, overlap cycling and card synchronization', async () => {
  const text = await analyzeText('😀 Very clear results.');
  const second: Issue = {
    ...issue,
    id: 'two',
    type: 'FUZZY_VERB',
    severity: 'major',
    why: 'Second explanation',
  };
  render(
    <ReviewWorkspace
      text={text}
      issues={[issue, second, { ...issue, id: 'dismissed', status: 'dismissed_by_human' }]}
      onChange={() => {}}
    />,
  );
  const mark = screen.getByRole('button', { name: /Động từ chưa cụ thể, Lớn, Ứng viên/ });
  expect(mark).toHaveTextContent('Very');
  fireEvent.click(mark);
  expect(screen.getByText('First explanation')).toBeInTheDocument();
  const expandedCard = screen.getByText('First explanation').closest('li');
  expect(expandedCard).not.toBeNull();
  if (!expandedCard) throw new Error('Expanded card missing');
  expect(within(expandedCard).getAllByText('Từ bổ nghĩa cần xem xét')).toHaveLength(1);
  expect(within(expandedCard).getByRole('combobox', { name: 'Mức độ' }).parentElement?.className).toMatch(
    /fieldInline/,
  );
  fireEvent.click(mark);
  expect(screen.getByText('Second explanation')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Từ ngữ.*Very.*Từ bổ nghĩa/ }));
  expect(screen.getByText('First explanation')).toBeInTheDocument();
  expect(mark.className).toMatch(/selected/);
  expect(screen.getAllByRole('button', { name: /Động từ chưa cụ thể, .*Ứng viên/ })).toHaveLength(1);
});

it('EV-10 filters cards and highlights together and supports keyboard selection', async () => {
  const text = await analyzeText('😀 Very clear results.');
  const low: Issue = {
    ...issue,
    id: 'low',
    type: 'SUBJECT_VERB_GAP',
    category: 'structure',
    status: 'confirmed_by_model',
    confidence: 0.2,
  };
  render(<ReviewWorkspace text={text} issues={[issue, low]} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Cấu trúc câu \(1\)/ }));
  expect(screen.queryByRole('button', { name: /Từ ngữ.*Very.*Từ bổ nghĩa/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Ẩn độ tin cậy thấp'));
  expect(screen.queryByRole('button', { name: /Khoảng cách chủ–vị, / })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Ẩn độ tin cậy thấp'));
  fireEvent.click(screen.getByRole('radio', { name: 'Ứng viên' }));
  expect(screen.queryByRole('button', { name: /Khoảng cách chủ–vị, / })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Đã xác nhận' }));
  const card = screen.getByRole('button', { name: /Cấu trúc câu.*Very/ });
  card.focus();
  fireEvent.keyDown(card, { key: 'ArrowDown' });
  fireEvent.click(card);
  expect(screen.getByText('First explanation')).toBeInTheDocument();
  fireEvent.keyDown(card, { key: 'Escape' });
  expect(screen.queryByText('First explanation')).not.toBeInTheDocument();
});

it('EV-10 stacks a second category and cycles a +n badge while hiding dismissed spans', async () => {
  const text = await analyzeText('😀 Very clear results.');
  const second: Issue = {
    ...issue,
    id: 'two',
    type: 'SUBJECT_VERB_GAP',
    category: 'structure',
    severity: 'moderate',
    why: 'Second',
  };
  const third: Issue = {
    ...issue,
    id: 'three',
    type: 'FLOW_BREAK_CANDIDATE',
    category: 'flow',
    severity: 'major',
    why: 'Third',
  };
  render(
    <ReviewWorkspace
      text={text}
      issues={[issue, second, third, { ...issue, id: 'dismissed', status: 'dismissed_by_human' }]}
      onChange={() => {}}
    />,
  );
  const mark = screen.getByRole('button', { name: /FLOW_BREAK_CANDIDATE, Lớn/ });
  expect(mark).toHaveTextContent('Very');
  expect(mark).toHaveStyle('--second-color: color-mix(in srgb, var(--hl-structure) 60%, transparent)');
  expect(mark.dataset.issues).not.toContain('dismissed');
  const badge = screen.getByRole('button', { name: 'Thêm 1 gợi ý chồng lấp' });
  expect(badge).toHaveTextContent('+1');
  fireEvent.click(badge);
  expect(screen.getByText('First explanation')).toBeInTheDocument();
  fireEvent.click(badge);
  expect(screen.getByText('Second')).toBeInTheDocument();
  fireEvent.click(badge);
  expect(screen.getByText('Third')).toBeInTheDocument();
});

it('EV-10 opens the suggestion drawer at tablet width', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('1023'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const text = await analyzeText('😀 Very clear results.');
  render(<div id="evaluate-toolbar" data-testid="toolbar" />);
  const toolbar = screen.getByTestId('toolbar');
  render(<ReviewWorkspace text={text} issues={[issue]} onChange={() => {}} toolbarTarget={toolbar} />);
  expect(
    within(screen.getByTestId('toolbar')).getByRole('button', { name: 'Gợi ý (1)' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Gợi ý (1)' }));
  expect(within(screen.getByRole('dialog', { name: 'Gợi ý' })).getByText('Cần xem (1)')).toBeInTheDocument();
  vi.unstubAllGlobals();
});

it('EV-11 retains human status and severity when judgement is rerun', () => {
  const current: Issue[] = [
    { ...issue, status: 'confirmed_by_human', severity: 'major' },
    { ...issue, id: 'two', status: 'dismissed_by_human', severity: 'moderate' },
  ];
  const result = mergeHumanDecisions(
    [
      { ...issue, status: 'confirmed_by_model' },
      { ...issue, id: 'two', status: 'confirmed_by_model' },
    ],
    current,
  );
  expect(result.map(({ status, severity }) => ({ status, severity }))).toEqual([
    { status: 'confirmed_by_human', severity: 'major' },
    { status: 'dismissed_by_human', severity: 'moderate' },
  ]);
});
