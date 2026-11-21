import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExtractionProject } from '@/core/schemas';
import { contentHash } from '@/core/researchDesign/bank/release';
import { snapshot } from '@/core/researchDesign/bank/testSupport';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { ResearchDesignConflictError } from '@/shared/storage/errors';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { ResearchDesignProvider } from '../ResearchDesignProvider';
import BankSection from '../sections/BankSection';
import { testRepositories } from '@/shared/storage/testRepositories';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-01-01T00:00:00.000Z';
const project: ExtractionProject = {
  schemaVersion: 1,
  id,
  paperId: null,
  title: 'Synthetic project',
  researchQuestion: '',
  createdAt: at,
  updatedAt: at,
  papers: [],
  fields: [],
  runs: [],
  cells: [],
  deep: null,
};

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
function file(text: string, size?: number) {
  const f = new File([text], 'test.json');
  Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes(text) });
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
}
async function cut(extra: Record<string, unknown> = {}) {
  const raw = { ...snapshot, release: '2031.02.1', ...extra };
  return { ...raw, contentHash: await contentHash(raw) };
}

async function setup({ token = 'token' as string | null, bank = null as unknown, referenced = false } = {}) {
  const repo = testRepositories();
  await repo.extraction.save(project);
  if (bank) {
    await repo.researchDesigns.importBank(id, 0, bytes(JSON.stringify(bank)), 'tester@example.org');
    const record = await repo.researchDesigns.get(id);
    const pinned = await repo.researchDesigns.getBank(id);
    if (!record || !pinned) throw new Error('seed failed');
    if (referenced)
      await repo.researchDesigns.save(
        {
          ...record,
          draft: {
            ...record.draft,
            design: {
              name: 'Test',
              assignment: null,
              bank: { id: 'rd.test-benchmark', release: pinned.release },
            },
          },
        },
        record.version,
      );
  }
  const getIdToken = vi.fn(async () => token);
  const auth: AuthValue = {
    user: token ? { uid: 'u-1', email: 'tester@example.org', name: null } : null,
    ready: true,
    error: '',
    signIn: async () => {},
    signOut: async () => {},
    getIdToken,
  };
  const importBank = vi.spyOn(repo.researchDesigns, 'importBank');
  const view = render(
    <StorageProvider repositories={repo}>
      <AuthContext.Provider value={auth}>
        <ResearchDesignProvider project={project}>
          <BankSection />
        </ResearchDesignProvider>
      </AuthContext.Provider>
    </StorageProvider>,
  );
  const input = () => {
    const element = view.container.querySelector('input[type=file]');
    if (!element) throw new Error('no file input');
    return element;
  };
  const choose = (f: File) => fireEvent.change(input(), { target: { files: [f] } });
  return { repo, importBank, getIdToken, choose };
}

it('BK-04 imports bytes with a content hash and refuses invalid files', async () => {
  const { repo, importBank, choose } = await setup();
  await screen.findByText('Chưa có bản chụp');
  choose(file('x', 2 * 1024 * 1024 + 1));
  expect(await screen.findByText('Tệp vượt quá giới hạn 2 MiB.')).toBeInTheDocument();
  choose(file('{'));
  expect(await screen.findByText('Tệp không phải JSON.')).toBeInTheDocument();
  const text = JSON.stringify(snapshot);
  choose(file(text));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  expect(await screen.findByText('sha256:' + hash)).toBeInTheDocument();
  expect(importBank).toHaveBeenCalledTimes(1);
  expect((await repo.researchDesigns.getBank(id))?.release).toBe('sha256:' + hash);
  expect((await repo.researchDesigns.get(id))?.bankRelease).toBe('sha256:' + hash);
  expect(screen.getByText('Người nhập: tester@example.org', { exact: false })).toBeInTheDocument();
});

it('BK-05 re-applies an import once after a version conflict, then reports the conflict', async () => {
  const { importBank, choose } = await setup();
  await screen.findByText('Chưa có bản chụp');
  importBank
    .mockRejectedValueOnce(new ResearchDesignConflictError('changed'))
    .mockRejectedValueOnce(new ResearchDesignConflictError('changed'));
  choose(file(JSON.stringify(snapshot)));
  expect(await screen.findByText('Bản chụp đã thay đổi; vui lòng thử lại.')).toBeInTheDocument();
  expect(importBank).toHaveBeenCalledTimes(2);
  importBank.mockRejectedValueOnce(new ResearchDesignConflictError('changed'));
  choose(file(JSON.stringify(snapshot)));
  await waitFor(() => expect(importBank).toHaveBeenCalledTimes(4));
  expect(await screen.findByText(/^sha256:/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('BK-06 shows empty state and refused file', async () => {
  const { choose } = await setup();
  await screen.findByText('Chưa có bản chụp');
  expect(screen.getByRole('button', { name: 'Nhập bản chụp' })).toBeInTheDocument();
  choose(file(JSON.stringify({ format: 'other' })));
  expect(await screen.findByText('Tệp không phải bản chụp Writing Bank.')).toBeInTheDocument();
});

it('BK-08 confirms replacement when referenced', async () => {
  const { repo, importBank, choose } = await setup({ bank: snapshot, referenced: true });
  await screen.findByRole('button', { name: 'Thay bản chụp' });
  const pinned = await repo.researchDesigns.getBank(id);
  expect(
    screen.getByText(new RegExp(new Date(pinned?.importedAt ?? '').toLocaleString('vi-VN'))),
  ).toBeInTheDocument();
  importBank.mockClear();
  choose(file('{'));
  await screen.findByText('Tệp không phải JSON.');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  choose(file(JSON.stringify(await cut())));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Bản nháp đang tham chiếu bản chụp hiện tại. Thay bản chụp?');
  expect(importBank).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(importBank).not.toHaveBeenCalled();
  choose(file(JSON.stringify(await cut())));
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Thay bản chụp' }),
  );
  await waitFor(() => expect(importBank).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('2031.02.1')).toBeInTheDocument();
});

it('BK-08 replaces without asking when the draft has no references', async () => {
  const { importBank, choose } = await setup({ bank: snapshot });
  await screen.findByRole('button', { name: 'Thay bản chụp' });
  importBank.mockClear();
  choose(file(JSON.stringify(await cut())));
  expect(await screen.findByText('2031.02.1')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(importBank).toHaveBeenCalledTimes(1);
});

it('BK-09 asks before replacement when draft cannot be loaded', async () => {
  const { repo, importBank, choose } = await setup({ bank: snapshot });
  await screen.findByRole('button', { name: 'Thay bản chụp' });
  importBank.mockClear();
  vi.spyOn(repo.researchDesigns, 'get').mockRejectedValueOnce(new Error('unreadable'));
  choose(file(JSON.stringify(snapshot)));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(importBank).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(importBank).not.toHaveBeenCalled();
});

it('D51 imports a verified bank release and displays its date and draft warning', async () => {
  const { repo, choose } = await setup();
  await screen.findByText('Chưa có bản chụp');
  const raw = await cut({
    date: '2031-02-01T00:00:00Z',
    notes: 'Test',
    includesDrafts: true,
    aliases: { 'rd.alpha': 'rd.beta' },
  });
  choose(file(JSON.stringify(raw)));
  expect(await screen.findByText('2031.02.1')).toBeInTheDocument();
  expect(
    screen.getByText(`Ngày phát hành: ${new Date('2031-02-01T00:00:00Z').toLocaleDateString('vi-VN')}`),
  ).toBeInTheDocument();
  expect(screen.getByText('Có mục bản nháp')).toBeInTheDocument();
  expect(screen.getByText(/Bản phát hành này gồm cả các mục Writing Bank chưa xuất bản/)).toBeInTheDocument();
  expect(screen.queryByText(/^Nguồn:/)).toBeInTheDocument();
  expect(await repo.researchDesigns.getBank(id)).toMatchObject({
    release: '2031.02.1',
    releaseDate: '2031-02-01T00:00:00Z',
    contentHash: raw.contentHash,
    includesDrafts: true,
    aliases: { 'rd.alpha': 'rd.beta' },
  });
  const counts = [
    ['2', 'Research design'],
    ['1', 'Threats to validity'],
    ['3', 'loại claim'],
    ['2', 'metric'],
    ['1', 'protocol'],
    ['1', 'benchmark'],
  ];
  for (const [value, label] of counts)
    expect(screen.getByText(label ?? '').parentElement).toHaveTextContent(`${value}${label}`);
});

it('D51 hides an empty source line', async () => {
  await setup({ bank: { ...(await cut()), source: '' } });
  await screen.findByText('2031.02.1');
  expect(screen.queryByText(/^Nguồn:/)).not.toBeInTheDocument();
});

it('D51 shows the hash refusal and does not write the snapshot', async () => {
  const { importBank, choose } = await setup();
  await screen.findByText('Chưa có bản chụp');
  choose(file(JSON.stringify({ ...snapshot, release: '2031.02.1', contentHash: '0'.repeat(64) })));
  expect(
    await screen.findByText(
      'Tệp không khớp mã băm nội dung mà nó tự khai; hãy tải lại bản phát hành từ Writing Bank.',
    ),
  ).toBeInTheDocument();
  expect(importBank).not.toHaveBeenCalled();
});

it('D53 makes no bank calls on open, and asks a signed-out person to sign in', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await setup({ token: null });
  await screen.findByText('Chưa có bản chụp');
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra bản mới' }));
  expect(await screen.findByText('Cần đăng nhập tài khoản lab để đọc Writing Bank.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lấy bản mới' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Cần đăng nhập tài khoản lab để đọc Writing Bank.'),
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it('D31 checks a release only on request without storing it', async () => {
  const response = { release: '2031.02.1', date: '2031-02-01T00:00:00Z', notes: '', includesDrafts: false };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(response)));
  vi.stubGlobal('fetch', fetcher);
  const { importBank, getIdToken } = await setup();
  await screen.findByText('Chưa có bản chụp');
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra bản mới' }));
  await screen.findByText(
    `Writing Bank có bản 2031.02.1, phát hành ${new Date('2031-02-01T00:00:00Z').toLocaleDateString('vi-VN')}.`,
  );
  expect(getIdToken).toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledWith(
    'https://writingbank-worker.hyperdatalab.workers.dev/bank/v1/release',
    { method: 'GET', headers: { Authorization: 'Bearer token' } },
  );
  expect(importBank).not.toHaveBeenCalled();
});

it('D31 reports when the stored release is current, by body or by 304', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ release: '2031.02.1', date: '2031-02-01T00:00:00Z', notes: '' })),
    )
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }));
  vi.stubGlobal('fetch', fetcher);
  const { importBank } = await setup({ bank: await cut() });
  await screen.findByText('2031.02.1');
  importBank.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra bản mới' }));
  await screen.findByText('Dự án đang dùng bản mới nhất (2031.02.1).');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { 'If-None-Match': '"2031.02.1"' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra bản mới' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await screen.findByText('Dự án đang dùng bản mới nhất (2031.02.1).');
  fireEvent.click(screen.getByRole('button', { name: 'Lấy bản mới' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await screen.findByText('Dự án đang dùng bản mới nhất (2031.02.1).');
  expect(importBank).not.toHaveBeenCalled();
});

it('D51 fetch validates a release, refuses missing release and hash mismatch, then stores it', async () => {
  const valid = await cut();
  const answers = [
    snapshot,
    { ...snapshot, release: '2031.02.1', contentHash: '0'.repeat(64) },
    { ...valid, formatVersion: 99 },
    valid,
  ];
  const fetcher = vi.fn(async () => new Response(JSON.stringify(answers.shift())));
  vi.stubGlobal('fetch', fetcher);
  const { repo, importBank } = await setup();
  await screen.findByText('Chưa có bản chụp');
  const fetchOnce = async (message: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Lấy bản mới' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  };
  await fetchOnce('Bản chụp không hợp lệ.');
  expect(screen.getByText('release: Required')).toBeInTheDocument();
  await fetchOnce('Tệp không khớp mã băm nội dung');
  await fetchOnce('Phiên bản bản chụp không được hỗ trợ.');
  expect(importBank).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Lấy bản mới' }));
  expect(await screen.findByText('2031.02.1')).toBeInTheDocument();
  expect((await repo.researchDesigns.getBank(id))?.release).toBe('2031.02.1');
  expect(fetcher).toHaveBeenLastCalledWith(
    'https://writingbank-worker.hyperdatalab.workers.dev/bank/v1/snapshot?collections=designs,threats,claim-types,metrics,protocols,benchmarks',
    expect.anything(),
  );
});

it('D31 confirms a fetched replacement when the draft references the current snapshot', async () => {
  const valid = await cut();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(valid))),
  );
  const { repo, importBank } = await setup({ bank: snapshot, referenced: true });
  await screen.findByRole('button', { name: 'Lấy bản mới' });
  importBank.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Lấy bản mới' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(importBank).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Thay bản chụp' }));
  await waitFor(() => expect(importBank).toHaveBeenCalledTimes(1));
  expect((await repo.researchDesigns.getBank(id))?.release).toBe('2031.02.1');
});

it.each([
  [401, 'Writing Bank chưa chấp nhận tài khoản của ứng dụng này.'],
  [403, 'Writing Bank chưa chấp nhận tài khoản của ứng dụng này.'],
  [429, 'Writing Bank đang giới hạn số lần gọi; thử lại sau.'],
  [0, 'Không thể nhập bản chụp. Vui lòng thử lại.'],
])('D53 shows bank error %s for both actions', async (status, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (!status) throw new Error('offline');
      return new Response(JSON.stringify({ error: 'error', message: 'Error' }), { status });
    }),
  );
  const { importBank } = await setup();
  await screen.findByText('Chưa có bản chụp');
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra bản mới' }));
  await screen.findByText(message);
  fireEvent.click(screen.getByRole('button', { name: 'Lấy bản mới' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  expect(importBank).not.toHaveBeenCalled();
});
