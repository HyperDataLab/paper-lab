import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { createDb } from '@/shared/storage/db';
import { createRepositories, type Repositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { LibraryPanel } from './LibraryPanel';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const works: Record<string, unknown> = {
  '10.1000/open': {
    title: 'Open paper about learning',
    publication_year: 2021,
    authorships: [{ author: { display_name: 'Ann Lee' } }],
    open_access: { is_oa: true },
    best_oa_location: { landing_page_url: 'https://j.org/open', pdf_url: 'https://j.org/open.pdf' },
    primary_topic: {
      display_name: 'Learning',
      field: { display_name: 'Computer' },
      domain: { display_name: 'Physical' },
    },
  },
  '10.1000/closed': {
    title: 'Closed clinical trial',
    open_access: { is_oa: false },
    primary_topic: {
      display_name: 'Trials',
      field: { display_name: 'Medicine' },
      domain: { display_name: 'Health' },
    },
  },
  '10.1000/arxiv': {
    title: 'Preprint paper',
    open_access: { is_oa: true },
    locations: [{ landing_page_url: 'https://arxiv.org/abs/2006.10256', is_oa: true }],
  },
};
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input));
      const doi = Object.keys(works).find((key) => url.includes(key));
      if (url.includes('openalex')) return doi ? json(works[doi]) : json({}, 404);
      if (url.includes('ebi.ac.uk')) return json({ resultList: { result: [] } });
      return json({}, 404);
    }),
  );
});
async function setup() {
  const repo: Repositories = createRepositories(createDb(`library-ui-${crypto.randomUUID()}`));
  render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <LibraryPanel />
      </StorageProvider>
    </MemoryRouter>,
  );
  await screen.findByText('Thêm bài báo theo DOI');
  return repo;
}
const paste = (text: string) => {
  fireEvent.change(screen.getByLabelText(/Dán DOI/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Thêm và tra cứu' }));
};
const row = (name: RegExp) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;

it('F1 adds DOIs, shows honest statuses and reports what it skipped', async () => {
  await setup();
  paste('10.1000/open\nhttps://doi.org/10.1000/closed\n10.1000/missing\nnothing here');
  expect(await screen.findByRole('link', { name: 'Open paper about learning' })).toBeInTheDocument();
  expect(screen.getByText('Đã thêm 3 DOI · 0 đã có sẵn · 1 dòng không có DOI')).toBeInTheDocument();
  await waitFor(() =>
    expect(within(row(/Closed clinical/)).getByText('Chưa thấy bản mở')).toBeInTheDocument(),
  );
  expect(within(row(/Open paper/)).getByText('Có bản mở')).toBeInTheDocument();
  expect(await screen.findByText('DOI không tồn tại')).toBeInTheDocument();
  expect(screen.getByText('1 dòng không có DOI')).toBeInTheDocument();
  expect(within(row(/Open paper/)).getByRole('link', { name: 'Mở bản mở' })).toHaveAttribute(
    'href',
    'https://j.org/open.pdf',
  );
  expect(screen.getByText(/Thêm email trong Cài đặt/)).toBeInTheDocument();
});

it('F1 says so when the text has no DOI, and does not re-add one it has', async () => {
  await setup();
  paste('just words');
  expect(await screen.findByText('Không tìm thấy DOI nào.')).toBeInTheDocument();
  paste('10.1000/open');
  await screen.findByRole('link', { name: 'Open paper about learning' });
  paste('10.1000/open');
  expect(await screen.findByText(/Đã thêm 0 DOI · 1 đã có sẵn/)).toBeInTheDocument();
});

it('F3 filters by status and by a taxonomy that narrows itself', async () => {
  await setup();
  paste('10.1000/open\n10.1000/closed');
  await screen.findByRole('link', { name: 'Closed clinical trial' });
  await waitFor(() => expect(screen.getByLabelText('Lĩnh vực lớn')).toHaveTextContent('Health (1)'));
  fireEvent.change(screen.getByLabelText('Lĩnh vực lớn'), { target: { value: 'Health' } });
  expect(screen.queryByRole('link', { name: 'Open paper about learning' })).toBeNull();
  expect(screen.getByLabelText('Ngành')).not.toHaveTextContent('Computer');
  fireEvent.change(screen.getByLabelText('Lĩnh vực lớn'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Có bản mở (1)' }));
  expect(screen.queryByRole('link', { name: 'Closed clinical trial' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tất cả (2)' }));
  fireEvent.change(screen.getByLabelText('Tìm theo tên, tác giả, DOI'), { target: { value: 'ann lee' } });
  expect(screen.queryByRole('link', { name: 'Closed clinical trial' })).toBeNull();
});

it('F1 exports RIS for the selection and removes rows after confirming', async () => {
  const create = vi.fn((_blob: Blob) => 'blob:x');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const repo = await setup();
  paste('10.1000/open\n10.1000/closed');
  await waitFor(() =>
    expect(within(row(/Closed clinical/)).getByText('Chưa thấy bản mở')).toBeInTheDocument(),
  );
  fireEvent.click(within(row(/Open paper/)).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Xuất RIS (1)' }));
  expect(click).toHaveBeenCalledTimes(1);
  const ris = await create.mock.calls[0]?.[0].text();
  expect(ris).toContain('10.1000/open');
  expect(ris).not.toContain('10.1000/closed');
  click.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Xoá khỏi thư viện' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Xoá khỏi thư viện' }));
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Open paper about learning' })).toBeNull());
  expect(await repo.library.list()).toHaveLength(1);
});

it('F2 attaches a text file to a row and links to the paper', async () => {
  const repo = await setup();
  paste('10.1000/open');
  await waitFor(() => expect(within(row(/Open paper/)).getByText('Có bản mở')).toBeInTheDocument());
  fireEvent.click(within(row(/Open paper/)).getByRole('button', { name: 'Gắn PDF' }));
  const content = 'Open paper about learning\n\nThe body of the paper is here for readers.';
  const file = new File([content], 'paper.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(content).buffer });
  fireEvent.change(screen.getByLabelText('Chọn tệp PDF'), { target: { files: [file] } });
  expect(await screen.findByRole('link', { name: 'Mở bài' })).toBeInTheDocument();
  expect(within(row(/Open paper/)).getByText('Đã có file')).toBeInTheDocument();
  const [item] = await repo.library.list();
  expect(item?.file_matches_title).toBe(true);
  expect((await repo.papers.get(item?.paper_id ?? ''))?.title).toBe('Open paper about learning');
});

it('F2 shows why a file could not be read', async () => {
  await setup();
  paste('10.1000/open');
  await waitFor(() => expect(within(row(/Open paper/)).getByText('Có bản mở')).toBeInTheDocument());
  fireEvent.click(within(row(/Open paper/)).getByRole('button', { name: 'Gắn PDF' }));
  const file = new File(['x'], 'bad.docx');
  fireEvent.change(screen.getByLabelText('Chọn tệp PDF'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được tệp');
});

it('F2 offers arXiv for preprints instead of an outside link', async () => {
  await setup();
  paste('10.1000/arxiv');
  await waitFor(() =>
    expect(within(row(/Preprint/)).getByRole('button', { name: 'Tải từ arXiv' })).toBeInTheDocument(),
  );
  expect(within(row(/Preprint/)).queryByRole('link', { name: 'Mở bản mở' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Tải từ arXiv (1)' })).toBeInTheDocument();
});

it('F1 resumes unfinished lookups after a reload', async () => {
  const repo: Repositories = createRepositories(createDb(`library-ui-${crypto.randomUUID()}`));
  await repo.library.addDois(['10.1000/open']);
  render(
    <MemoryRouter>
      <StorageProvider repositories={repo}>
        <LibraryPanel />
      </StorageProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục tra cứu (1)' }));
  expect(await screen.findByRole('link', { name: 'Open paper about learning' })).toBeInTheDocument();
});
