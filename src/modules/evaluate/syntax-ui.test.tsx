import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SentenceSyntaxOutput } from '@/core/prompts';
import { analyzeText } from '@/core/text';
import { detectCandidates, DETECTOR_VERSION } from '@/core/detectors';
import type { LlmClient } from '@/shared/llm';
import { LlmConfigError } from '@/shared/llm/errors';
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
  expect(screen.getAllByText(/context_limited/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByRole('button', { name: 'Đánh giá theo ngữ cảnh (AI)' })).toBeInTheDocument();
  expect(screen.getByText(/Thiếu ngữ cảnh: chỉ phân tích đoạn văn này/)).toHaveTextContent('context_limited');
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('EV-11 saved annotations reopen without calling the model', async () => {
  const repo = createRepositories(createDb(`syntax-${crypto.randomUUID()}`));
  const first = fakeClient();
  const view = renderEvaluate(repo, first.client);
  await splitAndAnalyze();
  await screen.findByText(/Khoảng cách chủ–vị: 9 token/);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu vào lịch sử' }));
  await screen.findByRole('button', { name: 'Đã lưu' }, { timeout: 10000 });
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

it('AC-03 EV-11 judges local candidates with consent and reopens saved decisions without a call', async () => {
  const repo = createRepositories(createDb(`judge-${crypto.randomUUID()}`));
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    const id = /WEAK_MODIFIER:s1:\d+-\d+/.exec(options.user)?.[0];
    return {
      data: options.schema.parse({
        judgements: [
          { id, verdict: 'acceptable', severity: null, confidence: 0.9, why: 'Phù hợp.', suggestedFix: null },
        ],
        passive: [],
      }),
      meta: { model: 'judge-model', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  const client = { completeJson } as unknown as LlmClient;
  const view = renderEvaluate(repo, client);
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), {
    target: { value: 'Very clear results.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: /Từ ngữ.*Very/ }));
  expect(screen.getByTitle('weak_modifier_candidates').closest('li')).toHaveTextContent('1 ứng viên');
  fireEvent.click(screen.getByRole('button', { name: 'Đánh giá theo ngữ cảnh (AI)' }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findAllByText(/AI: chấp nhận được/)).not.toHaveLength(0);
  expect(screen.getByText('Phù hợp.').closest('li')).toHaveTextContent('Thông tin');
  expect(screen.getByText('Phù hợp.')).toBeInTheDocument();
  expect(screen.queryByText(/^Gợi ý:/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu vào lịch sử' }));
  await screen.findByRole('button', { name: 'Đã lưu' }, { timeout: 10000 });
  const [item] = (await repo.analyses.list()).items;
  expect((await repo.analyses.get(item!.id))?.versions).toMatchObject({
    detectors: 'det-1',
    judgePrompt: 'cand-judge-1',
    model: 'judge-model',
  });
  view.unmount();
  completeJson.mockClear();
  renderEvaluate(repo, client, `/evaluate?id=${item!.id}`);
  expect(await screen.findByText(/AI: chấp nhận được/)).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
});

it('EV-11 reopening a pre-S6 analysis computes candidates locally', async () => {
  const repo = createRepositories(createDb(`legacy-${crypto.randomUUID()}`));
  const saved = await repo.analyses.create({ text: await analyzeText('Very clear results.') });
  const { client, completeJson } = fakeClient();
  renderEvaluate(repo, client, `/evaluate?id=${saved.id}`);
  expect(await screen.findByRole('heading', { name: 'Gợi ý (1)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Từ ngữ.*Very/ }));
  expect(screen.getByText(/^Gợi ý:/)).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
});

it('EV-11 AC-05 AC-06 AC-12 audits unsaved and later saved decisions and restores the previous status', async () => {
  const repo = createRepositories(createDb(`review-${crypto.randomUUID()}`));
  const spy = vi.spyOn(repo.analyses, 'reviewIssue');
  const { client } = fakeClient();
  const view = renderEvaluate(repo, client);
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), {
    target: { value: 'Very clear results.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: /Từ ngữ.*Very/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu vào lịch sử' }));
  await screen.findByRole('button', { name: 'Đã lưu' }, { timeout: 10000 });
  const [item] = (await repo.analyses.list()).items;
  if (!item) throw new Error('missing analysis');
  const original = await repo.analyses.get(item.id);
  expect(original?.issues[0]?.status).toBe('confirmed_by_human');
  expect((await repo.audit.listByAnalysis(item.id)).items.map((event) => event.action)).toEqual([
    'create_analysis',
    'confirm',
  ]);
  fireEvent.click(screen.getByRole('tab', { name: /Đã xử lý/ }));
  expect(await screen.findByText('Chưa hiệu chuẩn (n=1)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Từ ngữ.*Very/ }));
  fireEvent.change(screen.getByLabelText('Mức độ'), { target: { value: 'major' } });
  await waitFor(async () => expect((await repo.analyses.get(item.id))?.issues[0]?.severity).toBe('major'));
  expect(spy).toHaveBeenCalledWith(item.id, expect.any(String), { severity: 'major' });
  view.unmount();
  renderEvaluate(repo, client, `/evaluate?id=${item.id}`);
  await screen.findByRole('heading', { name: 'Gợi ý (0)' });
  fireEvent.click(screen.getByRole('tab', { name: /Đã xử lý/ }));
  fireEvent.click(screen.getByRole('button', { name: /Từ ngữ.*Very/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
  await waitFor(async () => expect((await repo.analyses.get(item.id))?.issues[0]?.status).toBe('candidate'));
  const after = await repo.analyses.get(item.id);
  expect(after?.text).toEqual(original?.text);
  expect(after?.issues[0]?.spans).toEqual(original?.issues[0]?.spans);
  expect((await repo.audit.listByAnalysis(item.id)).items.map((event) => event.action)).toEqual([
    'create_analysis',
    'confirm',
    'edit_severity',
    'reopen',
  ]);
});

it('EV-11 AC-05 AC-06 calls reviewIssue for saved confirm, undo, dismiss and severity changes', async () => {
  const repo = createRepositories(createDb(`saved-review-${crypto.randomUUID()}`));
  const text = await analyzeText('Very clear results.');
  const candidates = detectCandidates(text, null);
  const saved = await repo.analyses.create({
    text,
    issues: candidates,
    versions: { detectors: DETECTOR_VERSION },
  });
  const spy = vi.spyOn(repo.analyses, 'reviewIssue');
  const { client } = fakeClient();
  renderEvaluate(repo, client, `/evaluate?id=${saved.id}`);
  fireEvent.click(await screen.findByRole('button', { name: /Từ ngữ.*Very/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(async () =>
    expect((await repo.analyses.get(saved.id))?.issues[0]?.status).toBe('confirmed_by_human'),
  );
  fireEvent.click(screen.getByRole('tab', { name: /Đã xử lý/ }));
  fireEvent.click(screen.getByRole('button', { name: /Từ ngữ.*Very/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
  await waitFor(async () => expect((await repo.analyses.get(saved.id))?.issues[0]?.status).toBe('candidate'));
  fireEvent.click(screen.getByRole('tab', { name: /Cần xem/ }));
  fireEvent.click(screen.getByRole('button', { name: /Từ ngữ.*Very/ }));
  fireEvent.change(screen.getByLabelText('Mức độ'), { target: { value: 'moderate' } });
  await waitFor(async () =>
    expect((await repo.analyses.get(saved.id))?.issues[0]?.severity).toBe('moderate'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua' }));
  await waitFor(async () =>
    expect((await repo.analyses.get(saved.id))?.issues[0]?.status).toBe('dismissed_by_human'),
  );
  expect(spy).toHaveBeenCalledTimes(4);
  expect((await repo.audit.listByAnalysis(saved.id)).items.map((event) => event.action)).toEqual([
    'create_analysis',
    'confirm',
    'reopen',
    'edit_severity',
    'dismiss',
  ]);
  expect((await repo.analyses.get(saved.id))?.text).toEqual(text);
});

it('shows the missing API key message and a Settings link', async () => {
  const repo = createRepositories(createDb(`key-${crypto.randomUUID()}`));
  const client = {
    completeJson: vi.fn().mockRejectedValue(new LlmConfigError('API key is required')),
  } as unknown as LlmClient;
  renderEvaluate(repo, client);
  fireEvent.change(screen.getByLabelText('Dán một đoạn văn tiếng Anh'), { target: { value: 'A sentence.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Phân tích câu (AI)' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findByText(/Chưa nhập khoá API. Mở Cài đặt để nhập khoá./)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Cài đặt' })).toHaveAttribute('href', '/settings');
});
