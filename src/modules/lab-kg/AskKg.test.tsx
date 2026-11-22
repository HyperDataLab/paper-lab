import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

beforeEach(revokeConsent);
afterEach(() => vi.unstubAllGlobals());

function ask(question: string, response = Response.json({ error: 'not_found' }, { status: 404 })) {
  const completeJson = vi.fn(async (options: Parameters<LlmClient['completeJson']>[0]) => ({
    data: options.schema.parse({ sql, explanation: 'Sắp xếp các bài theo số citations.' }),
    meta: { model: 'synthetic', promptVersion: options.promptVersion, latencyMs: 1, repaired: false },
  }));
  const worker = vi.fn<typeof fetch>(async () => response);
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
  fireEvent.click(panel.getByRole('button', { name: 'Hỏi KG (AI)' }));
  return { panel, completeJson, worker };
}

it('semantic step 4 sends the approved question to the model, then SQL to the worker, and shows its table', async () => {
  const question = 'Bài nào có nhiều citations nhất?';
  const { panel, completeJson, worker } = ask(
    question,
    Response.json({
      sql,
      columns: ['title'],
      rows: [['Synthetic paper from SQL']],
      truncated: true,
      concepts: ['kg-paper'],
    }),
  );
  const dialog = await screen.findByRole('alertdialog', { name: 'Thông báo quyền riêng tư' });
  expect(completeJson).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đồng ý và tiếp tục' }));

  const table = await panel.findByRole('table', { name: 'Kết quả truy vấn KG' });
  expect(within(table).getByRole('cell', { name: 'Synthetic paper from SQL' })).toBeInTheDocument();
  expect(panel.getByLabelText('SQL được tạo')).toHaveTextContent(sql);
  expect(panel.getByText(/Concept đã dùng · KG paper/u)).toBeInTheDocument();
  expect(panel.getByText(/Đã giới hạn kết quả/u)).toBeInTheDocument();
  expect(completeJson).toHaveBeenCalledWith(
    expect.objectContaining({
      user: question,
      promptVersion: 'kg-sql-1',
      stream: true,
      onStreamStart: expect.any(Function),
    }),
  );
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

it('semantic step 4 makes no LLM or worker call after the reader declines consent', async () => {
  const { panel, completeJson, worker } = ask('Which synthetic paper has the most citations?');
  fireEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));
  await waitFor(() => expect(panel.getByRole('button', { name: 'Hỏi KG (AI)' })).toBeEnabled());
  expect(completeJson).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});

it('semantic step 4 shows the generated SQL and the worker error when the reader already consented', async () => {
  acceptConsent(getConfig());
  const { panel } = ask(
    'Which synthetic paper has the most citations?',
    Response.json({ error: 'sql_timeout' }, { status: 400 }),
  );
  expect(await panel.findByRole('alert')).toHaveTextContent('Truy vấn KG hết thời gian chờ.');
  expect(panel.getByLabelText('SQL được tạo')).toHaveTextContent(sql);
  expect(panel.queryByRole('table')).toBeNull();
});
