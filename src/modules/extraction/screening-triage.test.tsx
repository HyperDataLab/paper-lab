import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { candidateFromWork, newProject } from '@/core/extraction';
import type { Candidate, ExtractionProject } from '@/core/schemas';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { DeepResearch } from './DeepResearch';

const at = '2026-01-01T00:00:00.000Z';
const paper = (i: number, relevance: number | null, matched: string[] = []): Candidate => ({
  ...(candidateFromWork({ id: `https://openalex.org/W${i}`, display_name: `Paper ${i}` }, 'q') as Candidate),
  suggestion:
    relevance === null
      ? null
      : {
          decision: relevance >= 0.7 ? 'included' : relevance < 0.3 ? 'excluded' : 'uncertain',
          reason: `Lý do ${i}`,
          relevance,
          quality: 0.4,
          matched,
          model: 'm',
          promptVersion: 'screening-triage-1',
        },
});

function setup() {
  const base = newProject({ id: 'p1', title: 'Edge', researchQuestion: 'Độ trễ edge?', now: at });
  const initial: ExtractionProject = {
    ...base,
    deep: {
      plan: {
        concepts: [],
        queries: ['edge'],
        inclusion: ['edge computing'],
        exclusion: ['simulation only'],
        fromYear: null,
        toYear: null,
        perQuery: 15,
        approvedAt: at,
      },
      rounds: [],
      candidates: [
        paper(1, 0.9, ['I1']),
        paper(2, 0.85, ['E1']),
        paper(3, 0.1),
        paper(4, 0.2),
        paper(5, 0.5),
        paper(6, null),
      ],
      syntheses: [],
    },
  };
  const saves: { project: ExtractionProject; event: unknown }[] = [];
  function Host() {
    const [project, setProject] = useState(initial);
    return (
      <DeepResearch
        project={project}
        onSave={async (next, event) => {
          saves.push({ project: next, event });
          setProject(next);
        }}
      />
    );
  }
  render(
    <MemoryRouter initialEntries={['/?workspace=auto&searchStep=screen']}>
      <LlmProvider innerClient={{ completeJson: vi.fn() }}>
        <Host />
      </LlmProvider>
    </MemoryRouter>,
  );
  return saves;
}

it('R1 shows the triage summary, scores, matched criteria, and the estimate before running', () => {
  setup();
  expect(screen.getByText('AI đề xuất: Chọn 1 · Loại 3 · Chưa chắc 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Gợi ý sàng lọc (AI) · 1 lượt gọi' })).toBeEnabled();
  expect(screen.getByText(/1 bài chưa được chấm điểm · khoảng/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Paper 1'));
  expect(screen.getByText('AI gợi ý: Chọn')).toBeInTheDocument();
  const second = screen.getByText('Paper 2').closest('li') as HTMLElement;
  fireEvent.click(within(second).getByText('Paper 2'));
  expect(
    within(second).getByText(/Relevance 0\.85 · Quality 0\.40 · AI m · screening-triage-1/),
  ).toBeInTheDocument();
  expect(within(second).getByText('Khớp tiêu chí loại E1: simulation only')).toBeInTheDocument();
  expect(within(second).getByText('AI gợi ý: Loại')).toBeInTheDocument();
});

it('R1 filters and sorts by score, and moves the buckets live with the thresholds', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'AI: Loại (3)' }));
  const titles = () => screen.getAllByText(/^Paper \d$/).map((node) => node.textContent);
  expect(titles()).toEqual(['Paper 2', 'Paper 3', 'Paper 4']);
  fireEvent.click(screen.getByRole('button', { name: 'Mọi đề xuất' }));
  fireEvent.change(screen.getByLabelText('Ngưỡng chọn (relevance ≥)'), { target: { value: '0.4' } });
  expect(screen.getByText('AI đề xuất: Chọn 2 · Loại 3 · Chưa chắc 0')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Kiểm tra ngẫu nhiên/ }));
  expect(screen.getAllByText('Cần xem trước').length).toBeGreaterThan(0);
});

it('R1 bulk apply waits for the confirmation and records the decisions as AI-accepted', async () => {
  const saves = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng đề xuất cho 3 bài Loại' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText('Áp dụng Loại cho 3 bài?')).toBeInTheDocument();
  expect(within(dialog).getByText('Paper 3')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
  expect(saves).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng đề xuất cho 3 bài Loại' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Xác nhận 3 bài' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  const candidates = saves[0]!.project.deep!.candidates;
  expect(candidates.filter((item) => item.status === 'excluded').map((item) => item.key)).toEqual([
    'W2',
    'W3',
    'W4',
  ]);
  expect(candidates.find((item) => item.key === 'W2')?.decidedBy).toBe('ai_accepted');
  expect(saves[0]!.event).toMatchObject({
    action: 'review_extraction',
    after: { applied: 3, source: 'ai_accepted' },
  });
  expect(await screen.findByRole('button', { name: 'Loại (3)' })).toBeInTheDocument();
  expect(screen.getByText('AI đề xuất: Chọn 1 · Loại 0 · Chưa chắc 1')).toBeInTheDocument();

  // One paper: accepting its suggestion needs no dialog, and overriding stays a person's decision.
  const first = screen.getByText('Paper 1').closest('li') as HTMLElement;
  fireEvent.click(within(first).getByText('Paper 1'));
  fireEvent.click(within(first).getByRole('button', { name: 'Nhận đề xuất: Chọn' }));
  await waitFor(() => expect(saves).toHaveLength(2));
  const fifth = screen.getByText('Paper 5').closest('li') as HTMLElement;
  fireEvent.click(within(fifth).getByText('Paper 5'));
  fireEvent.click(within(fifth).getByRole('button', { name: 'Loại' }));
  await waitFor(() => expect(saves).toHaveLength(3));
  expect(saves[2]!.project.deep!.candidates.find((item) => item.key === 'W5')).toMatchObject({
    status: 'excluded',
    decidedBy: 'person',
  });
});
