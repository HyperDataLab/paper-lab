import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPaperChecks } from '@/core/paperChecks';
import type { Paper } from '@/core/schemas';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { createDb } from '@/shared/storage/db';
import { createRepositories, type Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { grobidPaper, grobidRecord, grobidTei } from '@/test/grobidFixtures';
import { GrobidContext, type GrobidState } from './grobidContext';
import { GrobidStatus } from './GrobidStatus';
import { PaperMetadata } from './PaperMetadata';
import { useGrobid } from './useGrobid';

const sha = 'a'.repeat(64);
const auth = (signedIn: boolean): AuthValue => ({
  user: signedIn ? { uid: 'u1', email: 'someone@example.org', name: null } : null,
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => (signedIn ? 'test-token' : null),
});

function Harness({ paper, onChanged }: { paper: Paper; onChanged: () => void }) {
  const state = useGrobid(paper, onChanged);
  return (
    <GrobidContext.Provider value={state}>
      <GrobidStatus />
    </GrobidContext.Provider>
  );
}

async function setup(signedIn = true) {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`grobid-${crypto.randomUUID()}`));
  await repo.papers.create(grobidPaper);
  await repo.pdfFiles.put(sha, new Blob(['%PDF-synthetic'], { type: 'application/pdf' }));
  const onChanged = vi.fn();
  const view = (r: Repositories) =>
    render(
      <AuthContext.Provider value={auth(signedIn)}>
        <StorageProvider repositories={r}>
          <Harness paper={grobidPaper} onChanged={onChanged} />
        </StorageProvider>
      </AuthContext.Provider>,
    );
  return { repo, onChanged, view };
}

function mockWorker() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? new Response(null, { status: 200 }) : new Response(grobidTei),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('U7 GROBID in the background', () => {
  it('sends the PDF, fetches the TEI after opening, stores it and reruns the citation checks', async () => {
    const fetchMock = mockWorker();
    const { repo, onChanged, view } = await setup();
    const before = await repo.paperChecks.save({
      schemaVersion: 1,
      paperId: grobidPaper.id,
      report: runPaperChecks(grobidPaper),
      decisions: [],
    });
    const kept = before.report.checks.flatMap((check) => check.findings)[0];
    expect(kept).toBeDefined();
    if (kept) await repo.paperChecks.review(grobidPaper.id, kept.id, 'dismissed_by_human');
    view(repo);
    expect(await screen.findByText('Cấu trúc từ GROBID: đang lấy…')).toBeInTheDocument();
    expect(
      await screen.findByText('Cấu trúc từ GROBID: đã dùng (2 tài liệu, 2 trích dẫn).'),
    ).toBeInTheDocument();
    const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${new URL(url).pathname}`);
    // The worker reads the PDF from the lab's storage, so the local-only copy is sent first.
    expect(calls).toEqual([`PUT /pdfs/${sha}`, `POST /grobid/fulltext/${sha}`]);
    expect((await repo.pdfFiles.get(sha))?.uploaded).toBe(true);
    expect((await repo.grobid.get(grobidPaper.id))?.status).toBe('ready');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const after = await repo.paperChecks.get(grobidPaper.id);
    const ids = after?.report.checks.flatMap((check) => check.findings.map((f) => f.id)) ?? [];
    expect(ids.some((id) => id.includes(':missing:grobid:[9]'))).toBe(true);
    expect(ids.some((id) => id.includes(':unused:grobid:b1'))).toBe(true);
    // The GROBID finding has the same check, message and anchor as the PDF.js one, so the decision moves to it.
    const moved = ids.find((id) => id.includes(':missing:grobid:[9]'));
    expect(after?.decisions.map((d) => d.findingId)).toEqual([moved]);
    expect(after?.decisions[0]?.status).toBe('dismissed_by_human');
    expect(after?.orphanedDecisions ?? []).toEqual([]);
  });

  it('asks nothing when signed out, and says why', async () => {
    const fetchMock = mockWorker();
    const { repo, view } = await setup(false);
    view(repo);
    expect(
      await screen.findByText('Cấu trúc từ GROBID: không dùng được (chưa đăng nhập tài khoản lab).'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await repo.grobid.get(grobidPaper.id)).toBeUndefined();
  });

  it('does not retry a stored failure on its own; Lấy lại từ GROBID does', async () => {
    const fetchMock = mockWorker();
    const { repo, view } = await setup();
    await repo.grobid.save(grobidRecord(null));
    view(repo);
    expect(
      await screen.findByText('Cấu trúc từ GROBID: không dùng được (kho của lab chưa có PDF của bài này).'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lấy lại từ GROBID' }));
    expect(
      await screen.findByText('Cấu trúc từ GROBID: đã dùng (2 tài liệu, 2 trích dẫn).'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('keeps the result and citation checks after a failed refetch', async () => {
    const { repo, view } = await setup();
    await repo.grobid.save(grobidRecord());
    await repo.paperChecks.save({
      schemaVersion: 1,
      paperId: grobidPaper.id,
      report: runPaperChecks(grobidPaper, new Date(), grobidRecord().result),
      decisions: [],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    view(repo);
    fireEvent.click(await screen.findByRole('button', { name: 'Lấy lại từ GROBID' }));
    expect(await screen.findByText(/đã giữ kết quả cũ/u)).toBeInTheDocument();
    await waitFor(async () => {
      const checks = await repo.paperChecks.get(grobidPaper.id);
      const ids = checks?.report.checks.flatMap((check) => check.findings.map((f) => f.id)) ?? [];
      expect(ids.some((id) => id.includes(':grobid:'))).toBe(true);
    });
    expect((await repo.grobid.get(grobidPaper.id))?.lastFailedAttempt?.reason).toContain('chưa có PDF');
  });

  it('does not store a lapsed session, so it is asked again after signing in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    const { repo, view } = await setup();
    await repo.pdfFiles.markUploaded(sha);
    view(repo);
    expect(
      await screen.findByText('Cấu trúc từ GROBID: không dùng được (Phiên đăng nhập đã hết hạn).'),
    ).toBeInTheDocument();
    expect(await repo.grobid.get(grobidPaper.id)).toBeUndefined();
  });

  it('stores the reason when the worker fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const { repo, view } = await setup();
    await repo.pdfFiles.markUploaded(sha);
    view(repo);
    expect(
      await screen.findByText('Cấu trúc từ GROBID: không dùng được (kho của lab chưa có PDF của bài này).'),
    ).toBeInTheDocument();
    expect(await repo.grobid.get(grobidPaper.id)).toMatchObject({ status: 'failed', result: null });
  });
});

it('U7 Thông tin xuất bản fills empty fields from GROBID and shows its status', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const repo = createRepositories(createDb(`grobid-meta-${crypto.randomUUID()}`));
  await repo.papers.create(grobidPaper);
  const state: GrobidState = { status: 'ready', reason: null, record: grobidRecord(), refetch: vi.fn() };
  render(
    <StorageProvider repositories={repo}>
      <GrobidContext.Provider value={state}>
        <PaperMetadata paper={grobidPaper} />
      </GrobidContext.Provider>
    </StorageProvider>,
  );
  expect(await screen.findByText('A synthetic header title')).toBeInTheDocument();
  expect(screen.getByText('Ann Lee, Bo Wu')).toBeInTheDocument();
  expect(screen.getByText(/Nguồn: GROBID \(đọc từ PDF\)/u)).toBeInTheDocument();
  expect(screen.getByText('Cấu trúc từ GROBID: đã dùng (2 tài liệu, 2 trích dẫn).')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lấy lại từ GROBID' }));
  expect(state.refetch).toHaveBeenCalled();
});
