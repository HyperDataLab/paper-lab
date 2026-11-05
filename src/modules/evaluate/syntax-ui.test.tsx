import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SentenceSyntaxOutput } from '@/core/prompts';
import type { LlmClient } from '@/shared/llm';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories, type Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Evaluate from './Page';

// Tokens: The0 model1 ,2 after3 very4 extensive5 testing6 across7 many8 new9 multiple10 datasets11 ,12 was13 improved14 .15
const TEXT = 'The model, after very extensive testing across many new multiple datasets, was improved.';
const ANSWER: SentenceSyntaxOutput = {
  sentences: [
    {
      sentenceId: 's1',
      subject: { start: 0, end: 2 },
      subjectHead: 1,
      mainVerb: { start: 13, end: 15 },
      mainVerbHead: 14,
      topic: { start: 0, end: 2 },
      action: { start: 13, end: 15 },
      stress: { start: 14, end: 15 },
      voice: 'passive',
      clauseCount: 1,
      maxClauseDepth: 0,
      confidence: 0.9,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});

function fakeClient(pending = false) {
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    if (pending)
      await new Promise((_, reject) =>
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      );
    return {
      data: options.schema.parse(ANSWER),
      meta: { model: 'fake-model', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  return { client: { completeJson } as unknown as LlmClient, completeJson };
}

function renderEvaluate(repo: Repositories, client: LlmClient, entry = '/evaluate') {
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

async function splitAndAnalyze() {
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), { target: { value: TEXT } });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Phân tích câu (AI)' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
}

it('EV-02 EV-03 asks consent, then shows markers, T/A/S and the review label for a gap of 9', async () => {
  const repo = createRepositories(createDb(`syntax-${crypto.randomUUID()}`));
  const { client, completeJson } = fakeClient();
  renderEvaluate(repo, client);
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), { target: { value: TEXT } });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Phân tích câu (AI)' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('Thông báo quyền riêng tư');
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(
    await screen.findByText(/Khoảng cách chủ–vị: 9 token · Cần xem lại \(ngưỡng thử nghiệm ≥ 8\)/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Chủ ngữ')).toHaveTextContent('The model');
  expect(screen.getByLabelText('Động từ chính')).toHaveTextContent('was improved');
  expect(screen.getByLabelText('Phần xen giữa chủ–vị')).toHaveTextContent(
    'after very extensive testing across many new multiple datasets',
  );
  expect(screen.getByText('T: The model')).toBeInTheDocument();
  expect(screen.getByText('Bị động')).toBeInTheDocument();
  expect(screen.getByText(/context_limited/)).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('EV-11 saved annotations reopen without calling the model', async () => {
  const repo = createRepositories(createDb(`syntax-${crypto.randomUUID()}`));
  const first = fakeClient();
  const view = renderEvaluate(repo, first.client);
  await splitAndAnalyze();
  await screen.findByText(/Khoảng cách chủ–vị: 9 token/);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu vào lịch sử' }));
  await screen.findByRole('button', { name: 'Đã lưu' });
  const [item] = (await repo.analyses.list()).items;
  const stored = await repo.analyses.get(item!.id);
  expect(stored?.versions).toMatchObject({
    prompt: 'sent-syntax-1',
    model: 'fake-model',
    syntaxProvider: 'llm/sent-syntax-1',
  });
  expect(stored?.sentenceAnnotations[0]?.subjectVerbDistanceTokens).toBe(9);
  view.unmount();
  const second = fakeClient();
  renderEvaluate(repo, second.client, `/evaluate?id=${item!.id}`);
  expect(await screen.findByText(/Khoảng cách chủ–vị: 9 token/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Phân tích/ })).not.toBeInTheDocument();
  expect(second.completeJson).not.toHaveBeenCalled();
});

it('cancelling a running analysis shows no error', async () => {
  const repo = createRepositories(createDb(`syntax-${crypto.randomUUID()}`));
  const { client } = fakeClient(true);
  renderEvaluate(repo, client);
  await splitAndAnalyze();
  fireEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Phân tích câu (AI)' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
