import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LENSES, LensSchema } from '@/core/prompts';
import type { Paper } from '@/core/schemas';
import type { LlmClient } from '@/shared/llm/client';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { chooseSelectOption } from '@/test/selectOption';
import PaperMapPage from './PaperMapPage';
import { PaperReview } from './PaperReview';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
async function setup(large = false, waitForAbort = false) {
  const repo = createRepositories(createDb(`review-ui-${crypto.randomUUID()}`));
  const at = '2026-01-01T00:00:00.000Z';
  const paper: Paper = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Bài phản biện',
    createdAt: at,
    updatedAt: at,
    source: { kind: 'text', fileName: '', pageCount: null, sha256: '' },
    sections: [
      { id: 's', heading: 'Methods', role: 'methods', level: 1, pageStart: null },
      { id: 'r', heading: 'References', role: 'references', level: 1, pageStart: null },
    ],
    paragraphs: [
      {
        id: 'p',
        sectionId: 's',
        order: 0,
        text: large ? 'a'.repeat(60001) : '😀 The method was described for all readers.',
        kind: 'body',
        pageStart: null,
        textHash: '',
      },
    ],
  };
  await repo.papers.create(paper);
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    await options.onRequest?.();
    if (waitForAbort)
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    const lens = LensSchema.options.find((item) =>
      options.system.includes(LENSES[item].description.replace(/\.$/u, '')),
    );
    return {
      data: options.schema.parse({
        lens,
        summary: 'Tóm tắt mẫu',
        points: [
          {
            kind: 'weakness',
            dimension: 'soundness',
            paragraphId: 'p',
            quote: 'The method was described for all readers',
            point: 'Cần giải thích phương pháp',
            rationale: 'Thiếu chi tiết',
            severity: 'moderate',
            confidence: 0.8,
          },
        ],
        unanchored: [{ point: 'Không có vị trí', reason: 'thiếu trích dẫn' }],
        cannotJudge: [{ dimension: 'originality', reason: 'thiếu bối cảnh' }],
      }),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  }) as LlmClient['completeJson'];
  render(
    <MemoryRouter initialEntries={[`/papers/${paper.id}`]}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          {large ? (
            <PaperReview paper={paper} onLocation={() => {}} />
          ) : (
            <Routes>
              <Route path="/papers/:id" element={<PaperMapPage />} />
            </Routes>
          )}
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  if (!large) {
    // The AI peer review is part of the Arguments space.
    fireEvent.click(await screen.findByRole('tab', { name: /^Arguments/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mở AI peer review' }));
  }
  await screen.findByLabelText('Nhận xét của bạn trước khi xem AI');
  return { repo, paper, completeJson };
}
it('P5 reveals reviews after skip, filters and audits decisions, and navigates to the quote', async () => {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const { repo, paper, completeJson } = await setup();
  expect(screen.getByRole('button', { name: 'Bỏ qua bước này' })).toBeInTheDocument();
  const setupCard = screen.getByRole('heading', { name: 'Thiết lập phản biện AI' }).closest('section');
  if (!setupCard) throw new Error('missing setup');
  expect(within(setupCard).getByRole('checkbox', { name: /Phương pháp/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(within(setupCard).getByRole('checkbox', { name: /References/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy phản biện (AI)' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('bản thảo');
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() => expect(completeJson).toHaveBeenCalledTimes(5));
  await waitFor(async () => expect((await repo.paperReviews.get(paper.id))?.runs).toHaveLength(1));
  expect(screen.queryByText(/Tỷ lệ neo trích dẫn/)).not.toBeInTheDocument();
  // The reader is told a result exists and how to reveal it, instead of seeing nothing.
  expect(await screen.findByText(/Đã có kết quả phản biện của AI/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua bước này' }));
  expect(await screen.findByText('5/10')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Phản biện AI chỉ mang tính tham khảo: không chấm điểm, không đề xuất chấp nhận hay từ chối.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/Độ trùng ý giữa các góc nhìn/)).toBeInTheDocument();
  expect(screen.getAllByText(/Trùng ý:/).length).toBeGreaterThan(0);
  expect(screen.getByText('Cụm khuôn mẫu')).toBeInTheDocument();
  expect(screen.getByText('Đồng thuận với nhận xét của bạn')).toBeInTheDocument();
  expect(screen.getByText(/Model: fake/)).toHaveTextContent('paper-review-1');
  const results = screen.getByRole('region', { name: 'Kết quả phản biện' });
  expect(within(results).queryByText(/rating/i)).not.toBeInTheDocument();
  expect(within(results).getByRole('heading', { name: 'Không đánh giá được' })).toBeInTheDocument();
  const unanchored = screen.getByRole('heading', { name: 'Chưa xác định vị trí' }).closest('section');
  if (!unanchored) throw new Error('missing section');
  expect(within(unanchored).getAllByText(/Không có vị trí/)).toHaveLength(5);
  expect(within(unanchored).queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Điểm mạnh' }));
  expect(screen.getByText('Không có nhận xét phù hợp.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Điểm yếu' }));
  chooseSelectOption('Khía cạnh', 'Độ rõ ràng');
  expect(screen.getByText('Không có nhận xét phù hợp.')).toBeInTheDocument();
  chooseSelectOption('Khía cạnh', 'Độ vững của khoa học');
  chooseSelectOption('Góc nhìn', 'Phương pháp');
  // The unified list above shows the same points; these are the controls inside the review block.
  const block = within(screen.getByRole('region', { name: 'AI peer review' }));
  expect(block.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
  fireEvent.click(block.getByRole('button', { name: 'Bác bỏ' }));
  await block.findByText('Đã bác bỏ');
  fireEvent.click(block.getByRole('button', { name: 'Hoàn tác' }));
  await block.findByRole('button', { name: 'Bác bỏ' });
  await waitFor(async () =>
    expect(
      (await repo.audit.listByAnalysis(paper.id)).items.filter((event) => event.action === 'review_point'),
    ).toHaveLength(2),
  );
  fireEvent.click(block.getByRole('button', { name: 'Methods' }));
  expect(
    screen.getByText('The method was described for all readers', { selector: 'mark' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mở trong bài' }));
  expect(screen.getByRole('tab', { name: 'Full text' })).toHaveAttribute('aria-selected', 'true');
  expect(scroll).toHaveBeenCalled();
});
it('P5 cancels an in-flight review without saving a run', async () => {
  const { repo, paper, completeJson } = await setup(false, true);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy phản biện (AI)' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() => expect(completeJson).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled());
  expect(await repo.paperReviews.get(paper.id)).toBeUndefined();
});
it('P5 guards large selected sections and retains notes after save', async () => {
  const { completeJson } = await setup(true);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Vui lòng chọn ít phần hơn');
  expect(screen.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Nhận xét của bạn trước khi xem AI'), {
    target: { value: 'Nhận xét riêng' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Bỏ qua bước này' })).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText('Nhận xét của bạn trước khi xem AI')).toHaveValue('Nhận xét riêng');
  expect(completeJson).not.toHaveBeenCalled();
});
