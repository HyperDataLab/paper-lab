import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import type { LlmClient } from '@/shared/llm/client';
import { getConfig } from '@/shared/llm/config';
import { acceptConsent, revokeConsent } from '@/shared/llm/consent';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { AskKg } from './AskKg';

vi.mock('@/shared/storage/StorageProvider', () => ({
  useHubProjectId: () => 'rh-test-project',
  useRepositories: () => ({
    papers: { listSummaries: async () => [], getMany: async () => [] },
    paperContext: { list: async () => [] },
    library: { list: async () => [] },
    corpora: { list: async () => [] },
    projects: { list: async () => [] },
  }),
}));

const sql = 'SELECT title FROM paper ORDER BY cited_by_count DESC';
const signedIn: AuthValue = {
  user: { uid: 'u-1', email: 'tester@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};

beforeEach(() => {
  revokeConsent();
  acceptConsent(getConfig());
  acceptConsent(getConfig(), false, false, true);
});
afterEach(() => vi.unstubAllGlobals());

function ask(question: string, columns: string[], rows: (string | number | null)[][]) {
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => {
    const output =
      options.schemaName === 'kg_sql'
        ? { sql, explanation: 'Lấy các thông tin phù hợp từ KG.' }
        : { claims: [{ text: 'Đây là kết quả có dữ liệu hỗ trợ.', sourceIds: ['kg:1'] }] };
    return {
      data: options.schema.parse(output),
      meta: { model: 'synthetic', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
    };
  });
  const worker = vi.fn<typeof fetch>(async () =>
    Response.json({ sql, columns, rows, truncated: false, concepts: ['kg-paper'] }),
  );
  vi.stubGlobal('fetch', worker);
  render(
    <AuthContext.Provider value={signedIn}>
      <LlmProvider innerClient={{ completeJson: completeJson as LlmClient['completeJson'] }}>
        <AskKg />
      </LlmProvider>
    </AuthContext.Provider>,
  );
  const panel = within(screen.getByRole('region', { name: 'Hỏi KG bằng câu hỏi' }));
  fireEvent.change(panel.getByLabelText('Câu hỏi về KG'), { target: { value: question } });
  fireEvent.click(panel.getByRole('button', { name: 'Hỏi KG' }));
  return { panel, completeJson, worker };
}

it('renders paper results as readable rows with DOI copy and internal IDs tucked away', async () => {
  const question = 'Tìm thông tin về bài báo DOI 10.1016/j.comnet.2025.111430';
  const { panel, completeJson, worker } = ask(
    question,
    ['paper_id', 'title', 'doi', 'publication_year', 'cited_by_count', 'type'],
    [
      [
        'paper-internal-1',
        'AsyncDefender: Dynamic trust adaptation and collaborative defense for Byzantine-robust asynchronous federated learning',
        '10.1016/j.comnet.2025.111430',
        2025,
        10,
        'article',
      ],
      ['paper-internal-2', 'A second research paper', '10.1000/example', 2024, 4, 'article'],
    ],
  );

  const results = await panel.findByRole('list', { name: 'Bài báo trong kết quả KG' });
  expect(within(results).getByText(/AsyncDefender: Dynamic trust adaptation/u)).toBeInTheDocument();
  expect(within(results).getByText('10.1016/j.comnet.2025.111430')).toBeInTheDocument();
  expect(within(results).getByText('2025 · 10 trích dẫn · article')).toBeInTheDocument();
  expect(within(results).getByText('A second research paper')).toBeInTheDocument();
  expect(panel.getByText('2 bản ghi')).toBeInTheDocument();
  expect(panel.queryByRole('table')).toBeNull();
  expect(panel.queryByLabelText('SQL được tạo')).toBeNull();
  expect(panel.getByText('Đây là kết quả có dữ liệu hỗ trợ.')).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(worker).toHaveBeenCalledWith(
    expect.stringMatching(/\/v1\/kg\/sql\?projectId=rh-test-project$/u),
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer test-token',
        'X-Project-Id': 'rh-test-project',
      }),
      body: JSON.stringify({ sql }),
    }),
  );
});

it('keeps generic multi-column query results in a scrollable data table', async () => {
  const { panel } = ask(
    'Các liên kết nào đang có trong knowledge graph?',
    ['from_label', 'relationship', 'to_label'],
    [
      ['AsyncDefender', 'has_topic', 'Federated learning'],
      ['AsyncDefender', 'cites', 'A second research paper'],
    ],
  );

  const table = await panel.findByRole('table', { name: 'Bảng kết quả KG' });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(panel.getByText('2 bản ghi')).toBeInTheDocument();
});
