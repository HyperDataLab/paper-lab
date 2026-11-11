import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runPaperChecks } from '@/core/paperChecks';
import type { Paper } from '@/core/schemas';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { sha256Hex } from '@/shared/pdfStore';
import { createDb } from '@/shared/storage/db';
import { createRepositories, type Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperPdf } from './PaperPdf';
import PaperMapPage from './PaperMapPage';

// jsdom has no canvas or pdf.js worker: the viewer is replaced by a stand-in that shows what it was given.
vi.mock('./PdfViewer', () => ({
  PdfViewer: ({
    blob,
    target,
    marks = [],
    onMark,
  }: {
    blob: Blob;
    target: { page: number; passage?: { text: string } | null } | null;
    marks?: { id: string; text: string; page: number }[];
    onMark?: (id: string) => void;
  }) => (
    <div data-testid="pdf-viewer">
      {blob.size} bytes{target ? `, page ${target.page}` : ''}
      {target?.passage ? `, passage [${target.passage.text}]` : ''}
      {marks.map((mark) => (
        <span key={mark.id} role="button" tabIndex={0} onClick={() => onMark?.(mark.id)}>
          mark {mark.text} p{mark.page}
        </span>
      ))}
    </div>
  ),
}));

const at = '2026-01-01T00:00:00.000Z';
const bytes = new TextEncoder().encode('%PDF-1.7 a small test file');
let sha = '';
const paperFor = (digest: string): Paper => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-0000000000d1',
  title: 'A PDF paper',
  createdAt: at,
  updatedAt: at,
  source: { kind: 'pdf', fileName: 'paper.pdf', pageCount: 3, sha256: `sha256:${digest}` },
  sections: [{ id: 'a', heading: 'Results', role: 'results', level: 1, pageStart: 2 }],
  paragraphs: [
    { id: 'p1', sectionId: 'a', order: 0, kind: 'body', text: 'A result.', pageStart: 2, textHash: '' },
  ],
});

const signedIn = (getIdToken = vi.fn(async () => 'token')): AuthValue => ({
  user: { uid: 'u1', email: 'member@hyperdatalab.org', name: 'Member' },
  ready: true,
  error: '',
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  getIdToken,
});
const signedOut = (): AuthValue => ({
  user: null,
  ready: true,
  error: '',
  signIn: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  getIdToken: vi.fn(async () => null),
});

function wrap(repo: Repositories, auth: AuthValue, children: ReactNode, path = '/') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <StorageProvider repositories={repo}>
        <AuthContext.Provider value={auth}>
          <LlmProvider innerClient={{ completeJson: vi.fn() }}>{children}</LlmProvider>
        </AuthContext.Provider>
      </StorageProvider>
    </MemoryRouter>
  );
}

const newRepo = () => createRepositories(createDb(`pdf-${crypto.randomUUID()}`));

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
  sha = await sha256Hex(bytes.slice().buffer);
});
afterEach(() => vi.unstubAllGlobals());

it('R8 a PDF kept on this machine is shown and sent to the lab storage once a lab account is signed in', async () => {
  const repo = newRepo();
  await repo.pdfFiles.put(sha, new Blob([bytes], { type: 'application/pdf' }));
  const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  render(wrap(repo, signedIn(), <PaperPdf paper={paperFor(sha)} target={null} />));
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
  expect(await screen.findByText('Đã lưu trong kho lab')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toMatch(new RegExp(`/pdfs/${sha}$`));
  expect(init.method).toBe('PUT');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  expect((await repo.pdfFiles.get(sha))?.uploaded).toBe(true);
});

it('R8 without a lab account the PDF stays on this machine and nothing is sent', async () => {
  const repo = newRepo();
  await repo.pdfFiles.put(sha, new Blob([bytes], { type: 'application/pdf' }));
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(wrap(repo, signedOut(), <PaperPdf paper={paperFor(sha)} target={null} />));
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
  expect(screen.getByText('Chỉ trên máy này')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await repo.pdfFiles.pending()).toHaveLength(1);
});

it('R8 a member on another machine opens the lab copy, which is then kept locally', async () => {
  const repo = newRepo();
  const fetchMock = vi.fn(
    async () => new Response(bytes.slice(), { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  // Blobs do not survive fake-indexeddb on every Node version, so the cache write is observed, not read back.
  const put = vi.spyOn(repo.pdfFiles, 'put');
  render(wrap(repo, signedIn(), <PaperPdf paper={paperFor(sha)} target={null} />));
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith(sha, expect.anything(), true);
});

it('R8 attaching the PDF again refuses a different file and accepts the original one', async () => {
  const repo = newRepo();
  render(wrap(repo, signedOut(), <PaperPdf paper={paperFor(sha)} target={null} />));
  const input = await screen.findByLabelText('Chọn PDF gốc');
  fireEvent.change(input, {
    target: { files: [new File([new TextEncoder().encode('%PDF-1.7 another')], 'other.pdf')] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('không phải tệp đã dùng để nhập bài này');
  expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
  fireEvent.change(input, { target: { files: [new File([bytes], 'paper.pdf')] } });
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
  expect(await repo.pdfFiles.get(sha)).toBeTruthy();
});

it('R8 a paper that did not come from a PDF says so instead of offering a file', () => {
  const repo = newRepo();
  const paper = {
    ...paperFor(sha),
    source: { kind: 'text' as const, fileName: '', pageCount: null, sha256: '' },
  };
  render(wrap(repo, signedOut(), <PaperPdf paper={paper} target={null} />));
  expect(screen.getByText('Bài này không được nhập từ tệp PDF.')).toBeInTheDocument();
});

it('R8 Full text opens on the PDF, switches to the parsed text, and remembers the choice', async () => {
  const repo = newRepo();
  const paper = paperFor(sha);
  await repo.papers.create(paper);
  await repo.pdfFiles.put(sha, new Blob([bytes], { type: 'application/pdf' }));
  vi.stubGlobal('fetch', vi.fn());
  render(
    wrap(
      repo,
      signedOut(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      `/papers/${paper.id}`,
    ),
  );
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Text' }));
  await waitFor(() => expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument());
  expect(await screen.findByText('A result.')).toBeInTheDocument();
  expect(localStorage.getItem('paper-fulltext-view')).toBe('text');
});

it('R8 opening a finding in a PDF paper turns the PDF to the page of its passage', async () => {
  const repo = newRepo();
  const base = paperFor(sha);
  const paper: Paper = {
    ...base,
    sections: [
      { id: 'a', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
      { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: 3 },
    ],
    paragraphs: [
      {
        id: 'p1',
        sectionId: 'a',
        order: 0,
        kind: 'body',
        text: 'An introduction.',
        pageStart: 1,
        textHash: '',
      },
      { id: 'p2', sectionId: 'b', order: 1, kind: 'body', text: 'See Figure 2.', pageStart: 3, textHash: '' },
    ],
  };
  await repo.papers.create(paper);
  await repo.pdfFiles.put(sha, new Blob([bytes], { type: 'application/pdf' }));
  await repo.paperChecks.save({
    schemaVersion: 1,
    paperId: paper.id,
    report: runPaperChecks(paper),
    decisions: [],
  });
  vi.stubGlobal('fetch', vi.fn());
  render(
    wrap(
      repo,
      signedOut(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      `/papers/${paper.id}`,
    ),
  );
  expect(await screen.findByTestId('pdf-viewer')).not.toHaveTextContent('page');
  fireEvent.click(await screen.findByRole('button', { name: '1 cần duyệt' }));
  const issues = screen.getByRole('region', { name: 'Issues' });
  fireEvent.click(within(issues).getByRole('button', { name: 'Tr. 3 · Results' }));
  expect(await screen.findByTestId('pdf-viewer')).toHaveTextContent('page 3, passage [Figure 2]');
});

it('R9 findings are drawn on the PDF, can be switched off by layer, and open the finding when pressed', async () => {
  const repo = newRepo();
  const base = paperFor(sha);
  const paper: Paper = {
    ...base,
    sections: [{ id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: 3 }],
    paragraphs: [
      { id: 'p2', sectionId: 'b', order: 0, kind: 'body', text: 'See Figure 2.', pageStart: 3, textHash: '' },
    ],
  };
  await repo.papers.create(paper);
  await repo.pdfFiles.put(sha, new Blob([bytes], { type: 'application/pdf' }));
  await repo.paperChecks.save({
    schemaVersion: 1,
    paperId: paper.id,
    report: runPaperChecks(paper),
    decisions: [],
  });
  vi.stubGlobal('fetch', vi.fn());
  render(
    wrap(
      repo,
      signedOut(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      `/papers/${paper.id}`,
    ),
  );
  expect(await screen.findByRole('button', { name: 'mark Figure 2 p3' })).toBeInTheDocument();
  const layers = screen.getByRole('group', { name: 'Lớp đánh dấu trên bài' });
  fireEvent.click(within(layers).getByRole('button', { name: /Evidence/ }));
  expect(screen.queryByRole('button', { name: 'mark Figure 2 p3' })).not.toBeInTheDocument();
  fireEvent.click(within(layers).getByRole('button', { name: /Evidence/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'mark Figure 2 p3' }));
  expect(screen.getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true');
});
