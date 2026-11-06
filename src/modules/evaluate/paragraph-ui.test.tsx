import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { LlmClient } from '@/shared/llm';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories, type Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Evaluate from './Page';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
function mount(repo: Repositories, client: LlmClient, entry = '/evaluate') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={client}>
          <Routes>
            <Route path="/evaluate" element={<Evaluate />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
}
function fakeCompleteJson() {
  return vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    const answer =
      options.schemaName === 'sentence_syntax'
        ? {
            sentences: [
              {
                sentenceId: 's1',
                topic: { start: 0, end: 1 },
                action: null,
                stress: { start: 1, end: 2 },
                subject: null,
                subjectHead: null,
                mainVerb: null,
                mainVerbHead: null,
                voice: 'active',
                clauseCount: 1,
                maxClauseDepth: 0,
                confidence: 0.9,
              },
              {
                sentenceId: 's2',
                topic: { start: 3, end: 4 },
                action: null,
                stress: { start: 4, end: 5 },
                subject: null,
                subjectHead: null,
                mainVerb: null,
                mainVerbHead: null,
                voice: 'active',
                clauseCount: 1,
                maxClauseDepth: 0,
                confidence: 0.9,
              },
            ],
          }
        : {
            type: 'LD',
            typeScores: { 'TS-D': 0.1, LD: 0.8, LDR: 0.1, OCAR: 0.1, UNKNOWN: 0.1 },
            centralPointSentenceId: 's1',
            identifiability: 3,
            evidence: 'Ý chính rõ',
            roles: [
              { sentenceId: 's1', role: 'lead', confidence: 0.8, rationale: 'Dẫn dắt' },
              { sentenceId: 's2', role: 'development', confidence: 0.8, rationale: 'Phát triển' },
            ],
            offTopicSentenceIds: [],
            unityRationale: '',
            pairs: [
              {
                fromSentenceId: 's1',
                toSentenceId: 's2',
                continuity: 'shift',
                discourseRelation: 'none',
                linked: false,
                confidence: 0.8,
                rationale: '',
              },
            ],
            rationale: '',
          };
    return {
      data: options.schema.parse(answer),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  });
}

it('EV-07 EV-08 AC-05 analyzes after syntax, shows the chain, and reopens without a call', async () => {
  const repo = createRepositories(createDb(`paragraph-${crypto.randomUUID()}`));
  const completeJson = fakeCompleteJson();
  const client = { completeJson } as unknown as LlmClient;
  const view = mount(repo, client);
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), {
    target: { value: 'Cells grow. Roots spread.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  expect(await screen.findByRole('button', { name: 'Phân tích cấu trúc đoạn (AI)' })).toBeDisabled();
  expect(screen.getByText('Cần phân tích câu trước')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích câu (AI)' }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Phân tích cấu trúc đoạn (AI)' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích cấu trúc đoạn (AI)' }));
  await screen.findByText(/S1 → S2 ·/);
  expect(screen.getByText(/grow → Roots/)).toBeInTheDocument();
  const rect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 20,
    bottom: 10,
    width: 20,
    height: 10,
    toJSON: () => ({}),
  };
  const rectangles = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([rect] as unknown as DOMRectList);
  fireEvent.click(screen.getByText(/grow → Roots/).closest('button')!);
  await waitFor(() =>
    expect(document.querySelector('svg[aria-hidden="true"] marker#flow-arrow')).toBeInTheDocument(),
  );
  rectangles.mockRestore();
  fireEvent.click(screen.getByRole('tab', { name: 'Cấu trúc đoạn' }));
  expect(screen.getByText('độ tin cậy 80 %')).toBeInTheDocument();
  const pair = screen.getByText('S1 → S2', { selector: 'strong' }).closest('li')!;
  expect(pair).toHaveTextContent('Chuyển chủ đề');
  expect(pair).toHaveTextContent('Không có');
  expect(pair).toHaveTextContent('Chưa liên kết');
  expect(pair).not.toHaveTextContent('shift');
  const structurePanel = within(screen.getByRole('tabpanel', { name: 'Cấu trúc đoạn' }));
  const alignment = structurePanel.getByTitle('stress_to_next_topic_alignment');
  expect(alignment).toHaveTextContent('Cặp nối Stress → Topic');
  expect(alignment).toHaveTextContent('0/1 cặp (0 %)');
  expect(structurePanel.getByTitle('central_point_identifiability')).toHaveTextContent('3/4 (Khá rõ)');
  // G1/G3: the unlinked, unexplained shift is a flow break with a specific explanation.
  fireEvent.click(screen.getByRole('tab', { name: 'Văn bản' }));
  fireEvent.click(screen.getByText(/grow → Roots/).closest('button')!);
  expect(
    await screen.findByText(/Phần nhấn cuối câu S1 không dẫn sang chủ đề đầu câu S2/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Không nối Stress → Topic/)).toBeInTheDocument();
  expect(screen.getAllByText(/Đứt mạch giữa hai câu/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('tab', { name: 'Cấu trúc đoạn' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu vào lịch sử' }));
  await screen.findByRole('button', { name: 'Đã lưu' });
  const [saved] = (await repo.analyses.list()).items;
  expect((await repo.analyses.get(saved!.id))?.versions.structurePrompt).toBe('para-struct-2');
  view.unmount();
  completeJson.mockClear();
  mount(repo, client, `/evaluate?id=${saved!.id}`);
  fireEvent.click(await screen.findByRole('tab', { name: 'Cấu trúc đoạn' }));
  expect(await screen.findByText('độ tin cậy 80 %')).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
});

it('EV-07 editing the text or re-running sentence syntax clears the structure result', async () => {
  const repo = createRepositories(createDb(`paragraph-${crypto.randomUUID()}`));
  const completeJson = fakeCompleteJson();
  mount(repo, { completeJson } as unknown as LlmClient);
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), {
    target: { value: 'Cells grow. Roots spread.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Phân tích câu (AI)' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Phân tích cấu trúc đoạn (AI)' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích cấu trúc đoạn (AI)' }));
  await screen.findByText(/grow → Roots/);
  fireEvent.click(screen.getByRole('tab', { name: 'Cấu trúc đoạn' }));
  expect(screen.getByText('độ tin cậy 80 %')).toBeInTheDocument();
  // Re-running sentence syntax drops the structure result and its flow issue.
  fireEvent.click(screen.getByRole('button', { name: 'Phân tích lại (AI)' }));
  await waitFor(() => expect(screen.queryByText('độ tin cậy 80 %')).not.toBeInTheDocument());
  expect(screen.queryByText(/grow → Roots/)).not.toBeInTheDocument();
  // Back to the textarea: everything is cleared.
  fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa văn bản' }));
  expect(screen.queryByRole('tab', { name: 'Cấu trúc đoạn' })).not.toBeInTheDocument();
});
