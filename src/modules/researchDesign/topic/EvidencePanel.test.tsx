import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyTopicCheck, type TopicCheck } from '@/core/schemas/topicCheck';
import { LabResearchError } from '@/shared/labResearch';
import { EvidencePanel } from './EvidencePanel';
const mocks = vi.hoisted(() => ({ callTool: vi.fn() }));
vi.mock('@/shared/labResearch', async (original) => ({
  ...(await original<typeof import('@/shared/labResearch')>()),
  createLabResearchClient: () => ({ callTool: mocks.callTool }),
}));
const paper = { id: 'W1', cited_by_count: 1, counts_by_year: {}, url: 'https://example.test' };
beforeEach(() => {
  mocks.callTool.mockReset();
});
it('TC-23 stores all four runs, query metadata and individual impact failures', async () => {
  const check = emptyTopicCheck();
  check.statement = 'A topic';
  check.neighbours = [
    { ref: 'W1', label: '', difference: '', source: 'researcher' },
    { ref: 'W2', label: '', difference: '', source: 'researcher' },
  ];
  const change = vi.fn((fn: (c: TopicCheck) => TopicCheck) => Object.assign(check, fn(check)));
  mocks.callTool.mockImplementation(async (name: string, input: { id?: string }) => {
    if (name === 'get_paper') {
      if (input.id === 'W2') throw new Error('missing');
      return paper;
    }
    const meta = { query_used: 'broadened', broadened_from: 'original' };
    if (name === 'run_duplication_test') return { ...meta, mode: 'sr', neighbours: [] };
    if (name === 'check_gap_saturation')
      return { ...meta, window: '2020-2026', counts_by_year: {}, total_estimate: 10, closest_recent: [] };
    return { ...meta, window: '2024-2026', records_in_window: 1, recent: [], common_ancestors: [] };
  });
  const view = render(<EvidencePanel check={check} change={change} />);
  for (const [label, kind] of [
    ['Tìm bài gần nhất', 'duplication'],
    ['Đếm nghiên cứu theo năm', 'saturation'],
    ['Bản đồ tranh luận', 'debate'],
    ['Quỹ đạo trích dẫn bài gần nhất', 'impact'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(check.evidence.some((e) => e.kind === kind)).toBe(true));
    view.rerender(<EvidencePanel check={check} change={change} />);
  }
  expect(check.evidence.find((e) => e.kind === 'duplication')).toMatchObject({
    queryUsed: 'broadened',
    broadenedFrom: 'original',
    input: { question: 'A topic', mode: 'sr', limit: 10 },
  });
  expect(check.evidence.find((e) => e.kind === 'impact')?.result).toMatchObject({
    papers: [
      { ref: 'W1', ok: true },
      { ref: 'W2', ok: false, error: 'missing' },
    ],
  });
  expect(screen.getAllByText(/đã nới truy vấn từ original/)).toHaveLength(3);
});
it.each([
  ['not_configured', 'Máy chủ nghiên cứu của lab chưa được cấu hình.'],
  ['signed_out', 'Đăng nhập tài khoản lab để chạy công cụ.'],
  ['network', 'Không thể kết nối máy chủ nghiên cứu.'],
  ['rate_limited', 'Quá nhiều yêu cầu. Thử lại sau 30 giây.'],
  ['invalid_input', 'Dữ liệu gửi tới công cụ không hợp lệ.'],
  ['upstream', 'Dịch vụ nghiên cứu đang gặp sự cố.'],
  ['failed', 'Không thể chạy công cụ nghiên cứu.'],
] as const)('TC-24 displays %s errors with technical details', async (code, message) => {
  mocks.callTool.mockRejectedValue(new LabResearchError(400, code, 'technical', 30));
  render(<EvidencePanel check={{ ...emptyTopicCheck(), statement: 'topic' }} change={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tìm bài gần nhất' }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByText('technical')).toBeInTheDocument();
});
it('TC-25 searches with the English keywords when given, else the statement', async () => {
  mocks.callTool.mockResolvedValue({ mode: 'general', neighbours: [] });
  const check = { ...emptyTopicCheck(), track: 'study' as const, statement: 'Đề tài bằng tiếng Việt' };
  const view = render(<EvidencePanel check={check} change={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tìm bài gần nhất' }));
  await waitFor(() => expect(mocks.callTool).toHaveBeenCalledTimes(1));
  expect(mocks.callTool.mock.calls[0]?.[1]).toMatchObject({ question: 'Đề tài bằng tiếng Việt' });
  view.rerender(<EvidencePanel check={{ ...check, searchQuery: 'llm screening' }} change={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tìm bài gần nhất' }));
  await waitFor(() => expect(mocks.callTool).toHaveBeenCalledTimes(2));
  expect(mocks.callTool.mock.calls[1]?.[1]).toMatchObject({ question: 'llm screening', mode: 'general' });
});
it('saves and searches the current keyword draft without changing query syntax', async () => {
  const check = { ...emptyTopicCheck(), statement: 'Fallback topic' };
  const change = vi.fn((update: (current: TopicCheck) => TopicCheck) => update(check));
  mocks.callTool.mockResolvedValue({ mode: 'general', neighbours: [] });
  render(<EvidencePanel check={check} change={change} />);

  const query = '(large language models OR LLMs) AND screening';
  fireEvent.change(screen.getByLabelText('Từ khoá tìm kiếm (tiếng Anh)'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Tìm bài gần nhất' }));

  await waitFor(() => expect(mocks.callTool).toHaveBeenCalledTimes(1));
  expect(mocks.callTool.mock.calls[0]?.[1]).toMatchObject({ question: query });
  expect(change).toHaveBeenCalled();
  expect(screen.getByLabelText('Từ khoá tìm kiếm (tiếng Anh)')).toHaveValue(query);
});
