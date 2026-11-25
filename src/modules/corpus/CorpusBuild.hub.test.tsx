import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { exampleCorpus } from '@/core/corpus/contract';
import * as hubKeys from '@/core/corpus/doiKey';
import type { Corpus } from '@/core/schemas/corpus';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { PDF_WORKER_URL, sha256Hex } from '@/shared/pdfStore';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { testRepositories } from '@/shared/storage/testRepositories';
import { CorpusBuild } from './CorpusBuild';

const hub = vi.hoisted(() => ({ url: '', enqueue: vi.fn() }));
vi.mock('@/shared/fetchHub/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/fetchHub/client')>()),
  get FETCH_HUB_URL() {
    return hub.url;
  },
}));
vi.mock('@/shared/pdfStore/useGrobidQueue', () => ({
  useGrobidQueue: () => ({ statuses: {}, enqueue: hub.enqueue }),
}));
vi.mock('@/shared/paper/pdfParser', () => ({
  extractPdfText: vi.fn(async () => ({
    lines: [{ text: 'A synthetic finding.', page: 1 }],
    pageCount: 1,
  })),
}));

const doi = '10.1000/synthetic-corpus';
/** The ResearchHub project StorageProvider supplies to injected test repositories. */
const projectId = '00000000-0000-4000-8000-000000000001';
const pdfUrl = (sha: string) => `${PDF_WORKER_URL}/pdfs/${sha}?projectId=${projectId}`;
const worker = 'https://hub.example.invalid';
const at = '2026-01-01T00:00:00Z';
const auth: AuthValue = {
  user: { uid: 'synthetic-user', email: 'synthetic@example.invalid', name: null },
  ready: true,
  error: '',
  getIdToken: async () => 'synthetic-id-token',
  signIn: async () => {},
  signOut: async () => {},
};
const send = () => screen.getByRole('button', { name: 'Gửi DOI sang Paper Fetch Hub' });
const refresh = () => screen.getByRole('button', { name: 'Cập nhật từ Hub' });

async function setup() {
  const initial = exampleCorpus();
  initial.members = initial.members.map((member) => ({
    ...member,
    title: 'Synthetic paper',
    identifiers: { ...member.identifiers, doi },
  }));
  const repo = testRepositories();
  await repo.corpora.save(initial);
  function Harness() {
    const [corpus, setCorpus] = useState<Corpus>(initial);
    return (
      <CorpusBuild
        corpus={corpus}
        save={async (next, options) => {
          const saved = await repo.corpora.saveVersioned(next, options?.expectedVersion);
          setCorpus(saved.doc);
        }}
      />
    );
  }
  const view = render(
    <AuthContext.Provider value={auth}>
      <StorageProvider repositories={repo}>
        <Harness />
      </StorageProvider>
    </AuthContext.Provider>,
  );
  return { initial, repo, unmount: view.unmount };
}

beforeEach(() => {
  hub.url = worker;
  hub.enqueue.mockClear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('sends a tagged DOI, checks its status and imports a done PDF through the PaperLab worker', async () => {
  const doiKey = await hubKeys.doiKey(doi);
  const bytes = new TextEncoder().encode('%PDF-1.7 synthetic bytes');
  const sha256 = await sha256Hex(bytes.buffer);
  const fetch = vi.fn(async (url: string) => {
    if (url === `${worker}/lab/v1/requests`)
      return Response.json({ results: [{ doi, doiKey, outcome: 'created', status: 'queued' }] });
    if (url === `${worker}/lab/v1/status`)
      return Response.json({ papers: [{ doiKey, status: 'done', updatedAt: at }] });
    if (url === `${worker}/lab/v1/pdf`)
      return Response.json({ r2Key: `paperlab/pdfs/${sha256}.pdf`, sha256, sizeBytes: bytes.length });
    if (url === pdfUrl(sha256))
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    throw new Error(`Unexpected endpoint ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const { initial, repo } = await setup();
  const memberId = initial.members[0]?.memberId;
  fireEvent.click(send());
  expect(await screen.findByText('Đã tạo 1 · Đã tham gia 0 · DOI không hợp lệ 0')).toBeInTheDocument();
  expect(screen.getByText('Hub đang lấy')).toBeInTheDocument();

  // A corpus edit made after rendering must survive the background write.
  await repo.corpora.save({ ...initial, title: 'Edited synthetic corpus' });
  fireEvent.click(refresh());
  expect(await screen.findByText('Hub đã có PDF')).toBeInTheDocument();
  await waitFor(async () => {
    const saved = await repo.corpora.get(initial.id);
    expect(saved?.title).toBe('Edited synthetic corpus');
    expect(saved?.members[0]).toMatchObject({
      retrieval: 'retrieved',
      textRead: 'FULL_TEXT',
      identifiers: { sha256: [`sha256:${sha256}`], paperIds: [expect.any(String)] },
    });
  });
  expect(await repo.papers.findBySourceHash(`sha256:${sha256}`)).toMatchObject({
    title: 'Synthetic paper',
    source: { kind: 'pdf', pageCount: 1 },
  });
  expect(hub.enqueue).toHaveBeenCalledWith(memberId, expect.objectContaining({ title: 'Synthetic paper' }));
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    `${worker}/lab/v1/requests`,
    `${worker}/lab/v1/status`,
    `${worker}/lab/v1/pdf`,
    pdfUrl(sha256),
  ]);
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    `${worker}/lab/v1/requests`,
    expect.objectContaining({
      body: JSON.stringify({ items: [{ doi, tag: `paperlab:corpus:${initial.id}/member:${memberId}` }] }),
    }),
  );
  expect(fetch).toHaveBeenNthCalledWith(
    3,
    `${worker}/lab/v1/pdf`,
    expect.objectContaining({ body: JSON.stringify({ doiKey }) }),
  );
  expect(fetch).toHaveBeenNthCalledWith(
    4,
    pdfUrl(sha256),
    expect.objectContaining({
      headers: { Authorization: 'Bearer synthetic-id-token', 'X-Project-Id': projectId },
    }),
  );
});

it('shows needs_human with its reason when refreshing before submitting in this tab', async () => {
  const doiKey = await hubKeys.doiKey(doi);
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      papers: [
        {
          doiKey,
          status: 'needs_human',
          needsHumanReason: 'Synthetic MFA prompt',
          updatedAt: at,
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const { initial, repo } = await setup();
  fireEvent.click(refresh());
  expect(await screen.findByText('Cần người xử lý')).toBeInTheDocument();
  expect(screen.getByText(/Synthetic MFA prompt/)).toBeInTheDocument();
  expect((await repo.corpora.get(initial.id))?.members[0]?.retrieval).toBe('sought');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves the DOI text file export when the Hub URL is missing', async () => {
  hub.url = '';
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const createObjectURL = vi.fn((_file: Blob) => 'blob:synthetic');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  let download: string | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    download = this.download;
  });
  await setup();
  expect(screen.queryByRole('button', { name: 'Cập nhật từ Hub' })).toBeNull();
  fireEvent.click(send());
  expect(download).toBe('paper-fetch-hub-dois.txt');
  const file = createObjectURL.mock.calls[0]?.[0];
  if (!file) throw new Error('Expected a DOI export file');
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
  expect(text).toBe(`${doi}\n`);
  expect(fetch).not.toHaveBeenCalled();
});

it('polls pending members at ten-minute intervals only while the corpus page is visible and mounted', async () => {
  const doiKey = 'a'.repeat(64);
  vi.spyOn(hubKeys, 'doiKey').mockResolvedValue(doiKey);
  const status = vi.fn(() => Response.json({ papers: [{ doiKey, status: 'queued', updatedAt: at }] }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/requests')
        ? Response.json({ results: [{ doi, doiKey, outcome: 'created', status: 'queued' }] })
        : status(),
    ),
  );
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.useFakeTimers();
  const { unmount } = await setup();
  const minutes = 60_000;
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  await advance(10 * minutes);
  expect(status).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(send());
  });
  await advance(9 * minutes);
  expect(status).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(refresh());
  });
  expect(status).toHaveBeenCalledTimes(1);
  await advance(10 * minutes - 1);
  expect(status).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(status).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await advance(20 * minutes);
  expect(status).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await advance(1);
  expect(status).toHaveBeenCalledTimes(3);
  unmount();
  await advance(20 * minutes);
  expect(status).toHaveBeenCalledTimes(3);
});
