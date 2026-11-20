import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { latestStyleWarning } from '@/core/probe';
import { PROMPT_VERSIONS } from '@/core/prompts';
import { AnalysisSchema, type Analysis, type Paper } from '@/core/schemas';
import { assessability } from '@/core/scoring/availability';
import { computeScores } from '@/core/scoring/computeScores';
import { DIMENSIONS } from '@/core/scoring/rubric';
import { analyzeText } from '@/core/text';
import { ScoresView } from '@/modules/evaluate';
import type { LlmClient } from '@/shared/llm/client';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import type { Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperOverview } from './PaperOverview';
import { PaperProbe } from './PaperProbe';
import { testRepositories } from '@/shared/storage/testRepositories';

const MODEL = 'cx/gpt-6-luna';
const AT = '2026-01-01T00:00:00.000Z';
const ORIGINALS = [
  'Cells grow fast in warm soil.',
  'Roots spread widely in moist soil.',
  'Leaves fall early in dry years.',
];

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});

const rawScores = (rubric: 0 | 1 | 2 | 3 | 4) => ({
  dimensions: DIMENSIONS.map((dimension) => ({
    id: dimension.id,
    rubric,
    confidence: 0.8,
    evidenceIssueIds: [],
    evidenceSentenceIds: [],
    rationale: 'Lý do',
  })),
});

async function setup(scored = 3) {
  const repo = testRepositories();
  const paragraphs = await Promise.all(
    ORIGINALS.map(async (text, i) => ({
      id: `s${i}_p01`,
      sectionId: `s${i}`,
      order: 0,
      text,
      kind: 'body' as const,
      pageStart: null,
      textHash: (await analyzeText(text)).sourceHash,
    })),
  );
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Bài thử',
    createdAt: AT,
    updatedAt: AT,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: ORIGINALS.map((_, i) => ({
      id: `s${i}`,
      heading: `Mục ${i}`,
      role: 'results' as const,
      level: 1,
      pageStart: null,
    })),
    paragraphs,
  };
  await repo.papers.create(paper);
  const analyses: Analysis[] = await Promise.all(
    paragraphs.slice(0, scored).map(async (paragraph) => {
      const base = AnalysisSchema.parse({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        createdAt: AT,
        updatedAt: AT,
        text: await analyzeText(paragraph.text),
        context: { before: null, after: null, audience: null },
        contextLimited: true,
        versions: {
          rubric: null,
          prompt: null,
          model: MODEL,
          syntaxProvider: null,
          scoringPrompt: PROMPT_VERSIONS.scoringPaper,
          scoringModel: MODEL,
        },
        sentenceAnnotations: [],
        issues: [],
        parentAnalysisId: null,
        origin: { kind: 'paper', paperId: paper.id, paragraphId: paragraph.id },
      });
      return {
        ...base,
        scores: computeScores(rawScores(2), assessability(base), [], {
          sentenceIds: base.text.sentences.map((s) => s.id),
          contextLimited: true,
        }),
      };
    }),
  );
  return { repo, paper, analyses };
}

function fakeClient(rewrite: (text: string) => string) {
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    await options.onRequest?.();
    let data: unknown;
    if (options.schemaName === 'style_probe') {
      const original = ORIGINALS.find((text) => options.user.includes(text)) ?? '';
      data = { rewritten: rewrite(original) };
    } else if (options.schemaName === 'sentence_syntax') data = { sentences: [] };
    else data = rawScores(ORIGINALS.some((text) => options.user.includes(text)) ? 2 : 4);
    return {
      data: options.schema.parse(data),
      meta: { model: MODEL, promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  return { client: { completeJson } as unknown as LlmClient, completeJson };
}

function wrap(repo: Repositories, client: LlmClient, children: React.ReactNode) {
  return render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={client}>{children}</LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
}
const restyle = (text: string) => {
  const [subject, ...rest] = text.replace('.', '').split(' in ');
  return `In ${rest.join(' in ')}, ${(subject ?? '').toLowerCase()}.`;
};
const runButton = () => screen.getByRole('button', { name: 'Chạy kiểm tra độ bền (AI)' });

it('P6 explains the purpose and refuses with fewer than three scored paragraphs', async () => {
  const { repo, paper, analyses } = await setup(2);
  const { client } = fakeClient(restyle);
  wrap(repo, client, <PaperProbe paper={paper} analyses={analyses} />);
  expect(screen.getByText(/Đây không phải công cụ nâng điểm/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Cần chấm điểm ít nhất 3 đoạn trước');
  expect(runButton()).toBeDisabled();
});

it('P6 asks consent, shows the verdict and table, offers no copy or apply, and warns on Overview', async () => {
  const { repo, paper, analyses } = await setup();
  const { client, completeJson } = fakeClient(restyle);
  const view = wrap(repo, client, <PaperProbe paper={paper} analyses={analyses} />);
  expect(screen.getByText(/Ước tính ~12 lượt gọi AI cho 3 đoạn/)).toBeInTheDocument();
  fireEvent.click(runButton());
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findByText('Nhạy với văn phong', {}, { timeout: 10000 })).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(12);
  const dimension = DIMENSIONS.find((d) => d.id === 'verb_word_choice')!;
  const row = screen.getByRole('row', { name: new RegExp(dimension.label) });
  expect(within(row).getByText('↑ +50')).toBeInTheDocument();
  expect(screen.getAllByText('Xem bản viết lại (chỉ để kiểm chứng)')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /Sao chép|Áp dụng/ })).not.toBeInTheDocument();
  const saved = await repo.paperProbes.get(paper.id);
  expect(saved?.runs.at(-1)?.status).toBe('done');
  expect(latestStyleWarning(saved?.runs)).not.toBeNull();
  view.unmount();
  wrap(
    repo,
    client,
    <PaperOverview paper={paper} analyses={[]} run={null} onFilter={vi.fn()} focus="writing" />,
  );
  expect(await screen.findByText(/có thể bị ảnh hưởng bởi văn phong/)).toBeInTheDocument();
});

it('P6 lists discarded rewrites with their reasons and reports insufficient data', async () => {
  const { repo, paper, analyses } = await setup();
  const { client, completeJson } = fakeClient((text) => `${text.replace('.', '')} in 2020.`);
  wrap(repo, client, <PaperProbe paper={paper} analyses={analyses} />);
  fireEvent.click(runButton());
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  expect(await screen.findByText('Chưa đủ dữ liệu', {}, { timeout: 10000 })).toBeInTheDocument();
  expect(screen.getByText('Bản viết lại bị loại')).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(3);
});

it('P6 cancelling keeps the run resumable and shows no error', async () => {
  const { repo, paper, analyses } = await setup();
  const completeJson = vi.fn(
    (options: Parameters<LlmClient['completeJson']>[0]) =>
      new Promise((_resolve, reject) => {
        void options.onRequest?.();
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  wrap(repo, { completeJson } as unknown as LlmClient, <PaperProbe paper={paper} analyses={analyses} />);
  fireEvent.click(runButton());
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() => expect(completeJson).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));
  expect(await screen.findByRole('button', { name: 'Tiếp tục lượt trước' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('P6 latestStyleWarning uses only the latest finished run', () => {
  const run = (status: string, updatedAt: string, verdict: string) => ({
    status,
    updatedAt,
    summary: { verdict },
  });
  expect(latestStyleWarning(undefined)).toBeNull();
  expect(latestStyleWarning([run('running', AT, 'style_sensitive')])).toBeNull();
  expect(latestStyleWarning([run('done', AT, 'style_sensitive')])).toBe(AT);
  expect(
    latestStyleWarning([
      run('done', AT, 'style_sensitive'),
      run('done', '2026-02-01T00:00:00.000Z', 'stable'),
    ]),
  ).toBeNull();
});

it('P6 the score view shows the style warning', async () => {
  const { analyses } = await setup();
  render(
    <ScoresView
      scores={analyses[0]!.scores}
      issues={[]}
      onIssue={vi.fn()}
      onSentence={vi.fn()}
      styleWarning={AT}
    />,
  );
  expect(screen.getByText(/có thể bị ảnh hưởng bởi văn phong/)).toBeInTheDocument();
});
