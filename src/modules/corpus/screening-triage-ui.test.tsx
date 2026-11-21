import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { newCorpus } from '@/core/corpus';
import { addMember } from '@/core/corpus/intake';
import { prismaCounts } from '@/core/corpus/prisma';
import type { CandidateSuggestion, Corpus } from '@/core/schemas';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { chooseSelectOption } from '@/test/selectOption';
import { ScreeningList } from './ScreeningList';

const at = '2026-01-01T00:00:00.000Z';
const scored = (i: number, relevance: number, matched: string[] = []): CandidateSuggestion => ({
  decision: relevance >= 0.7 ? 'included' : relevance < 0.3 ? 'excluded' : 'uncertain',
  reason: `Lý do ${i}`,
  relevance,
  quality: 0.4,
  matched,
  model: 'm',
  promptVersion: 'screening-triage-1',
});

function setup() {
  let corpus = newCorpus({
    id: 'c',
    kind: 'topic',
    title: 'Synthetic',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: {
          researchQuestion: 'Độ trễ edge?',
          inclusion: ['edge computing'],
          exclusion: ['simulation only'],
          years: [],
        },
      },
    ],
  });
  const scores = [scored(1, 0.9, ['I1']), scored(2, 0.85, ['E1']), scored(3, 0.1), scored(4, 0.5), null];
  scores.forEach((suggestion, index) => {
    const added = addMember(
      corpus,
      { doi: `10.1000/ui${index + 1}`, title: `Paper ${index + 1}`, year: 2020 },
      at,
    );
    corpus = added.corpus;
    if (suggestion && 'memberId' in added)
      corpus = {
        ...corpus,
        members: corpus.members.map((member) =>
          member.memberId === added.memberId
            ? { ...member, suggestions: { 'title-abstract': suggestion } }
            : member,
        ),
      };
  });
  const saves: Corpus[] = [];
  const initial = corpus;
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <ScreeningList
        corpus={value}
        save={async (next) => {
          saves.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(
    <MemoryRouter>
      <LlmProvider innerClient={{ completeJson: vi.fn() }}>
        <Host />
      </LlmProvider>
    </MemoryRouter>,
  );
  return saves;
}

it('R1 corpus:shows the corpus triage summary, scores, matched criteria and the estimate', () => {
  setup();
  expect(screen.getByText('AI đề xuất: Chọn 1 · Loại 2 · Chưa chắc 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Gợi ý sàng lọc (AI) · 1 lượt gọi' })).toBeEnabled();
  const second = screen.getByText('Paper 2').closest('li') as HTMLElement;
  expect(within(second).getByText(/Relevance 0\.85 · Quality 0\.40 · AI m/)).toBeInTheDocument();
  expect(within(second).getByText('Khớp tiêu chí loại E1: simulation only')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'AI: Loại (2)' }));
  expect(screen.getAllByText(/^Paper \d$/).map((node) => node.textContent)).toEqual(['Paper 2', 'Paper 3']);
  fireEvent.click(screen.getByRole('button', { name: 'Mọi đề xuất' }));
  fireEvent.change(screen.getByLabelText('Ngưỡng chọn (relevance ≥)'), { target: { value: '0.4' } });
  expect(screen.getByText('AI đề xuất: Chọn 2 · Loại 2 · Chưa chắc 0')).toBeInTheDocument();
});

it('R1 corpus:bulk apply on the corpus needs the confirmation, a person and a reason, and updates PRISMA', async () => {
  const saves = setup();
  const apply = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng đề xuất cho 2 bài Loại' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Xác nhận 2 bài' }));
  };
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng đề xuất cho 2 bài Loại' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Huỷ' }));
  apply();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Người quyết định'), { target: { value: 'An' } });
  apply();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(saves).toHaveLength(0);

  chooseSelectOption('Lý do loại', 'Sai chủ đề');
  apply();
  await waitFor(() => expect(saves).toHaveLength(1));
  const saved = saves[0]!;
  expect(prismaCounts(saved)).toMatchObject({ recordsScreened: 2, excludedTitleAbstract: 2 });
  expect(saved.members[1]?.decisions[0]).toMatchObject({
    decision: 'exclude',
    reasonCode: 'wrong_topic',
    decider: { kind: 'person', name: 'An' },
    acceptedSuggestion: { decision: 'exclude', reason: 'Lý do 2' },
  });
  expect(await screen.findByText('AI đề xuất: Chọn 1 · Loại 0 · Chưa chắc 1')).toBeInTheDocument();
  expect(screen.getAllByText(/theo đề xuất AI/)).toHaveLength(2);

  // One member: accepting its bucket needs no dialog.
  const first = screen.getByText('Paper 1').closest('li') as HTMLElement;
  fireEvent.click(within(first).getByRole('button', { name: 'Nhận đề xuất: Chọn' }));
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(prismaCounts(saves[1]!)).toMatchObject({ recordsScreened: 3, reportsSought: 1 });
});
