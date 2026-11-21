import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runPaperChecks } from '@/core/paperChecks';
import type { Paper } from '@/core/schemas';
import { chooseSelectOption } from '@/test/selectOption';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { clearSessionPdfs, sha256Hex } from '@/shared/pdfStore';
import type { Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { PaperPdf } from './PaperPdf';
import PaperMapPage from './PaperMapPage';
import { testRepositories } from '@/shared/storage/testRepositories';

// jsdom has no canvas or pdf.js worker: the viewer is replaced by a stand-in that shows what it was given.
// Like the real viewer it owns the missing-file state: its message, the upload and sign-in actions and the
// parsed-text fallback.
vi.mock('./PdfViewer', () => ({
  PdfViewer: ({
    blob,
    target,
    marks = [],
    onMark,
    toolbarStart,
    toolbarEnd,
    toolbarBelow,
    loadState,
    loadMessage,
    onUpload,
    onSignIn,
    fallback,
  }: {
    blob: Blob | null;
    target: { page: number; passage?: { text: string } | null } | null;
    marks?: { id: string; text: string; page: number }[];
    onMark?: (id: string) => void;
    toolbarStart?: ReactNode;
    toolbarEnd?: ReactNode;
    toolbarBelow?: ReactNode;
    loadState?: 'searching' | 'loading' | 'missing';
    loadMessage?: string;
    onUpload?: () => void;
    onSignIn?: () => void;
    fallback?: ReactNode;
  }) => (
    <div data-testid="pdf-viewer">
      <div role="toolbar" aria-label="PDF">
        {toolbarStart}
        {toolbarEnd}
        {toolbarBelow}
      </div>
      {blob?.size ?? 0} bytes{target ? `, page ${target.page}` : ''}
      {target?.passage ? `, passage [${target.passage.text}]` : ''}
      {marks.map((mark) => (
        <span key={mark.id} role="button" tabIndex={0} onClick={() => onMark?.(mark.id)}>
          mark {mark.text} p{mark.page}
        </span>
      ))}
      {loadState === 'missing' && (
        <div role="alert">
          {loadMessage}
          <span role="button" tabIndex={0} onClick={onUpload}>
            Tải PDF lên
          </span>
          {onSignIn && (
            <span role="button" tabIndex={0} onClick={onSignIn}>
              Đăng nhập HyperDataLab
            </span>
          )}
        </div>
      )}
      {loadState === 'missing' && fallback}
    </div>
  ),
}));

const at = '2026-01-01T00:00:00.000Z';
const TEST_PROJECT_ID = '00000000-0000-4000-8000-000000000101';
/** Whether the reader's analysis column is open, kept for the browser session. */
const PANEL_KEY = 'paperlab:reader-panel-open';
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
      <AuthContext.Provider value={auth}>
        <StorageProvider repositories={repo} projectId={TEST_PROJECT_ID}>
          <LlmProvider innerClient={{ completeJson: vi.fn() }}>{children}</LlmProvider>
        </StorageProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

const newRepo = () => testRepositories();
/** The viewer stand-in renders at once; what it shows follows the asynchronous read or hash. */
const viewerShows = (text: string) =>
  waitFor(() => expect(screen.getByTestId('pdf-viewer')).toHaveTextContent(text));

/** The lab's PDF worker: GET returns the PDF (or 404 when it has none), PUT stores it. */
function stubLab(has = true) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? new Response(null, { status: 201 })
      : has
        ? new Response(bytes.slice(), { status: 200, headers: { 'Content-Type': 'application/pdf' } })
        : new Response(null, { status: 404 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  clearSessionPdfs();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
  sessionStorage.clear();
  sha = await sha256Hex(bytes.slice().buffer);
});
afterEach(() => vi.unstubAllGlobals());

it('R8 the PDF is read from the active ResearchHub project with the SSO token', async () => {
  const repo = newRepo();
  const fetchMock = stubLab();
  render(wrap(repo, signedIn(), <PaperPdf paper={paperFor(sha)} target={null} />));
  await viewerShows(`${bytes.length} bytes`);
  expect(screen.getByText('Đã lưu trong ResearchHub')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toMatch(new RegExp(`/pdfs/${sha}\\?projectId=${TEST_PROJECT_ID}$`));
  expect(init.method ?? 'GET').toBe('GET');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  expect((init.headers as Record<string, string>)['X-Project-Id']).toBe(TEST_PROJECT_ID);
});

it('R8 without a lab account nothing is fetched and the reader is asked to sign in', async () => {
  const repo = newRepo();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const auth = signedOut();
  render(wrap(repo, auth, <PaperPdf paper={paperFor(sha)} target={null} />));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy PDF trên thiết bị này.');
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập HyperDataLab' }));
  expect(auth.signIn).toHaveBeenCalled();
  expect(screen.getByTestId('pdf-viewer')).toHaveTextContent('0 bytes');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('R8 a PDF is read from ResearchHub each time it opens and is not kept in the browser', async () => {
  // Production keeps PDF bytes only in the active ResearchHub project: there is no session cache any more.
  const repo = newRepo();
  const fetchMock = stubLab();
  render(wrap(repo, signedIn(), <PaperPdf paper={paperFor(sha)} target={null} />));
  await viewerShows(`${bytes.length} bytes`);
  cleanup();
  render(wrap(repo, signedIn(), <PaperPdf paper={paperFor(sha)} target={null} />));
  await viewerShows(`${bytes.length} bytes`);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('R8 attaching the PDF again refuses a different file and sends the original one to ResearchHub', async () => {
  const repo = newRepo();
  const fetchMock = stubLab(false);
  render(wrap(repo, signedIn(), <PaperPdf paper={paperFor(sha)} target={null} />));
  const input = await screen.findByLabelText('Chọn PDF gốc');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Không tìm thấy PDF trong ResearchHub hoặc trên thiết bị này.',
  );
  fireEvent.change(input, {
    target: { files: [new File([new TextEncoder().encode('%PDF-1.7 another')], 'other.pdf')] },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('không phải tệp đã dùng để nhập bài này'),
  );
  expect(screen.getByTestId('pdf-viewer')).toHaveTextContent('0 bytes');
  fireEvent.change(input, { target: { files: [new File([bytes], 'paper.pdf')] } });
  await viewerShows(`${bytes.length} bytes`);
  await waitFor(() => expect(screen.getByText('Đã lưu trong ResearchHub')).toBeInTheDocument());
  const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
  expect(put?.[0]).toMatch(new RegExp(`/pdfs/${sha}\\?projectId=${TEST_PROJECT_ID}$`));
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

it('R12 a PDF paper is read as its PDF only, and its parsed text shows only while the PDF is missing', async () => {
  const repo = newRepo();
  const paper = paperFor(sha);
  await repo.papers.create(paper);
  stubLab();
  render(
    wrap(
      repo,
      signedIn(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      `/papers/${paper.id}`,
    ),
  );
  expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();
  // No switch to the parsed text and no layer chips: the PDF is the paper.
  expect(screen.queryByRole('radio', { name: 'Text' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Lớp đánh dấu trên bài' })).toBeNull();
  expect(screen.queryByText('A result.')).toBeNull();
});

it('R12 a PDF paper whose file is not here offers to attach it and shows the parsed text meanwhile', async () => {
  const repo = newRepo();
  const paper = paperFor(sha);
  await repo.papers.create(paper);
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
  expect(await screen.findByRole('button', { name: 'Tải PDF lên' })).toBeInTheDocument();
  expect(await screen.findByText('A result.')).toBeInTheDocument();
  expect(screen.getByTestId('pdf-viewer')).toHaveTextContent('0 bytes');
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
  await repo.paperChecks.save({
    schemaVersion: 1,
    paperId: paper.id,
    report: runPaperChecks(paper),
    decisions: [],
  });
  stubLab();
  render(
    wrap(
      repo,
      signedIn(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      `/papers/${paper.id}`,
    ),
  );
  expect(await screen.findByTestId('pdf-viewer')).not.toHaveTextContent('page');
  // The analysis column starts closed beside a PDF; the toolbar opens it.
  fireEvent.click(screen.getByRole('button', { name: /^Vấn đề và trích dẫn/u }));
  const issues = await screen.findByRole('region', { name: 'Issues' });
  fireEvent.click(await within(issues).findByRole('button', { name: 'Tr. 3' }));
  await viewerShows('page 3, passage [Figure 2]');
});

it('R9 findings are drawn on the PDF and open the finding when pressed', async () => {
  const repo = newRepo();
  const base = paperFor(sha);
  const paper: Paper = {
    ...base,
    sections: [{ id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: 3 }],
    paragraphs: [
      {
        id: 'p2',
        sectionId: 'b',
        order: 0,
        kind: 'body',
        text: 'Extensive experiments.',
        pageStart: 3,
        textHash: '',
      },
    ],
  };
  await repo.papers.create(paper);
  await repo.paperChecks.save({
    schemaVersion: 1,
    paperId: paper.id,
    report: runPaperChecks(paper),
    decisions: [],
  });
  stubLab();
  render(
    wrap(
      repo,
      signedIn(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      `/papers/${paper.id}`,
    ),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'mark Extensive experiments. p3' }));
  expect(screen.getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true');
});

async function openPaper(paper: Paper, path = `/papers/${paper.id}`) {
  const repo = newRepo();
  await repo.papers.create(paper);
  stubLab();
  render(
    wrap(
      repo,
      signedIn(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      path,
    ),
  );
  return repo;
}
const twoSections = (): Paper => ({
  ...paperFor(sha),
  sections: [
    { id: 'i', heading: 'Introduction', role: 'introduction', level: 1, pageStart: 1 },
    { id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: 3 },
  ],
  paragraphs: [
    {
      id: 'p1',
      sectionId: 'i',
      order: 0,
      kind: 'body',
      text: 'Data sharing matters.',
      pageStart: 1,
      textHash: '',
    },
    {
      id: 'p2',
      sectionId: 'b',
      order: 1,
      kind: 'body',
      text: 'Sharing raised citations.',
      pageStart: 3,
      textHash: '',
    },
  ],
});

it('R14 a pressed mark shows the analysis again when it was hidden', async () => {
  sessionStorage.setItem(PANEL_KEY, 'false');
  const base = paperFor(sha);
  const paper: Paper = {
    ...base,
    sections: [{ id: 'b', heading: 'Results', role: 'results', level: 1, pageStart: 3 }],
    paragraphs: [
      {
        id: 'p2',
        sectionId: 'b',
        order: 0,
        kind: 'body',
        text: 'Extensive experiments.',
        pageStart: 3,
        textHash: '',
      },
    ],
  };
  await openPaper(paper);
  expect(screen.queryByRole('region', { name: 'Analysis' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'mark Extensive experiments. p3' }));
  expect(await screen.findByRole('region', { name: 'Analysis' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Issues' })).toHaveAttribute('aria-selected', 'true');
  expect(sessionStorage.getItem(PANEL_KEY)).toBe('true');
});

it('R14 the PDF toolbar finds a phrase in the paper and jumps to a section', async () => {
  await openPaper(twoSections());
  const toolbar = await screen.findByRole('toolbar', { name: 'PDF' });
  // Search and the outline open as popovers from the toolbar.
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Tìm trong bài' }));
  const search = within(toolbar).getByRole('dialog', { name: 'Tìm trong bài' });
  fireEvent.change(within(search).getByRole('searchbox', { name: 'Tìm trong bài' }), {
    target: { value: 'sharing' },
  });
  fireEvent.click(within(search).getByRole('button', { name: 'Tìm' }));
  // Case is ignored: both paragraphs match, and the first one is outlined on its page.
  expect(await within(search).findByText('1/2')).toBeInTheDocument();
  expect(screen.getByTestId('pdf-viewer')).toHaveTextContent('page 1, passage [sharing]');
  fireEvent.click(within(search).getByRole('button', { name: 'Kết quả sau' }));
  expect(screen.getByTestId('pdf-viewer')).toHaveTextContent('page 3, passage [Sharing]');
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Mục lục bài báo' }));
  chooseSelectOption('Chọn mục', 'Introduction');
  expect(screen.getByTestId('pdf-viewer')).toHaveTextContent('page 1');
});

it('R14 a page link in Summary opens the PDF with a way back to Summary', async () => {
  const paper = twoSections();
  const repo = await openPaper(paper, `/papers/${paper.id}?view=profile&pane=summary`);
  await repo.paperInsights.saveDigestRun(paper.id, {
    id: '00000000-0000-4000-8000-0000000000f2',
    createdAt: at,
    model: 'm',
    promptVersion: 'digest-1',
    callsUsed: 1,
    read: 2,
    total: 2,
    headline: 'Sharing data pays off.',
    overview: { text: 'Shared data was cited more.', sources: [{ paragraphId: 'p2', page: 3 }], flags: [] },
    sections: [],
  });
  cleanup();
  render(
    wrap(
      repo,
      signedIn(),
      <Routes>
        <Route path="/papers/:id" element={<PaperMapPage />} />
      </Routes>,
      `/papers/${paper.id}?view=profile&pane=summary`,
    ),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Mở trang 3 trong PDF' }));
  // A PDF paper's full text is its PDF: the toolbar carries the PDF / Tóm tắt switch.
  expect(screen.getByRole('tab', { name: 'PDF' })).toHaveAttribute('aria-selected', 'true');
  await viewerShows('page 3');
  const back = await screen.findByRole('button', { name: '← Quay lại Summary' });
  fireEvent.click(back);
  expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByRole('heading', { name: 'Sharing data pays off.' })).toBeInTheDocument();
});
