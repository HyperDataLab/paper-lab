import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { LlmClient } from '@/shared/llm';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import Evaluate from './Page';
import { testRepositories } from '@/shared/storage/testRepositories';

it('EV-09 AC-10 gates scoring, shows evidence and stale scores, and reopens without a call', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  const repo = testRepositories();
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    const input = JSON.parse(options.user) as { packages: { issues: { id: string }[] }[] };
    const id = input.packages.flatMap((item) => item.issues)[0]?.id;
    return {
      data: options.schema.parse({
        dimensions: ['verb_word_choice', 'concision_modifiers'].map((dimension) => ({
          id: dimension,
          rubric: 3,
          confidence: 0.7,
          evidenceIssueIds: id ? [id] : [],
          evidenceSentenceIds: ['s1'],
          rationale: 'Có căn cứ',
        })),
      }),
      meta: { model: 'fake', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  const mount = (entry: string) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <StorageProvider repositories={repo}>
          <LlmProvider innerClient={{ completeJson } as LlmClient}>
            <Routes>
              <Route path="/evaluate" element={<Evaluate />} />
            </Routes>
          </LlmProvider>
        </StorageProvider>
      </MemoryRouter>,
    );
  const view = mount('/evaluate');
  expect(screen.queryByRole('button', { name: 'Chấm điểm (AI)' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Dán một paragraph tiếng Anh'), {
    target: { value: 'This is very important. Results followed in order to grow.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chấm điểm (AI)' }));
  expect(completeJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  await waitFor(() => expect(completeJson).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('tab', { name: 'Điểm' }));
  expect(await screen.findByText('2/5')).toBeInTheDocument();
  expect(screen.getByText('70 %')).toBeInTheDocument();
  expect(screen.getByText(/schimel-paragraph-v1/)).toBeInTheDocument();
  expect(screen.getByText(/Không tính điểm tổng: 3 tiêu chí/)).toBeInTheDocument();
  const row = screen.getByText(/Tính súc tích và từ bổ nghĩa/).closest('details');
  expect(row).toBeTruthy();
  if (!row) return;
  fireEvent.click(within(row).getByText(/Tính súc tích và từ bổ nghĩa/));
  const issueChip = within(row)
    .getAllByRole('button')
    .find((button) => button.textContent !== 's1');
  expect(issueChip).toBeDefined();
  if (!issueChip) return;
  const issueId = issueChip.getAttribute('data-issue') ?? '';
  fireEvent.click(issueChip);
  const firstCard = document.getElementById(`card-${issueId}`);
  expect(firstCard).not.toBeNull();
  const otherCard = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-card]')).find(
    (button) => !firstCard?.contains(button),
  );
  expect(otherCard).toBeDefined();
  if (!otherCard || !firstCard) return;
  fireEvent.click(otherCard);
  expect(within(firstCard).queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Điểm' }));
  fireEvent.click(row.querySelector(`[data-issue="${issueId}"]`) as HTMLElement);
  expect(within(firstCard).getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Điểm' }));
  const scroll = vi.fn();
  const sentence = document.getElementById('sentence-s1');
  expect(sentence).not.toBeNull();
  if (!sentence) return;
  sentence.scrollIntoView = scroll;
  fireEvent.click(within(row).getByRole('button', { name: 's1' }));
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  expect(sentence).toHaveAttribute('aria-current', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Văn bản' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Điểm' }));
  expect(screen.getByText(/Điểm có thể đã cũ/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lưu vào lịch sử' }));
  await screen.findByText('Đã lưu.', {}, { timeout: 10000 });
  const saved = (await repo.analyses.list()).items[0];
  expect(saved).toBeDefined();
  view.unmount();
  mount(`/evaluate?id=${saved?.id}`);
  fireEvent.click(await screen.findByRole('tab', { name: 'Điểm' }));
  expect(await screen.findByText('2/5')).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(1);
});

it('EV-09 cancelling scoring shows no error or scores', async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  const repo = testRepositories();
  const completeJson = vi.fn(
    (options: Parameters<LlmClient['completeJson']>[0]) =>
      new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  ) as LlmClient['completeJson'];
  render(
    <MemoryRouter initialEntries={['/evaluate']}>
      <StorageProvider repositories={repo}>
        <LlmProvider innerClient={{ completeJson }}>
          <Routes>
            <Route path="/evaluate" element={<Evaluate />} />
          </Routes>
        </LlmProvider>
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Dán một paragraph tiếng Anh'), {
    target: { value: 'Cells grow.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tách câu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Chấm điểm (AI)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý và tiếp tục' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Chấm điểm (AI)' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Điểm' }));
  expect(screen.getByText(/Chưa có điểm/)).toBeInTheDocument();
});
