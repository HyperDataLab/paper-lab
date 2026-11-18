import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Corpus } from '@/core/schemas/corpus';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { ProtocolForm } from './ProtocolForm';

const auth: AuthValue = {
  user: { uid: 'synthetic', email: 'synthetic@example.test', name: null },
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => 'test-token',
};
const journal = {
  id: 'jrn.synthetic',
  profile: 'jr.synthetic',
  name: 'Synthetic Journal',
  kind: 'journal',
  issns: ['1234-5679', '9876-5434'],
  openalexSourceId: 'S12345',
};
const articleTypes = [
  { id: 'art.study', name: 'Synthetic study', aliases: ['article'] },
  { id: 'art.review', name: 'Synthetic review', aliases: ['review'] },
  { id: 'art.custom', name: 'Synthetic custom', aliases: [] },
];
const release = '2031.02.3';
const snapshot = () =>
  Response.json({
    format: 'writing-bank-snapshot',
    formatVersion: 1,
    release,
    collections: { 'article-types': articleTypes },
  });
const fallback = 'Chưa lấy được danh mục từ Writing Bank; nhập tay.';
const pickerName = 'Chọn tạp chí từ Writing Bank';
type Body = Corpus['protocol'][number]['body'];

function mount(initial?: Body) {
  const onSave = vi.fn<(body: Body) => void>();
  return {
    onSave,
    ...render(
      <AuthContext.Provider value={auth}>
        <ProtocolForm kind="journal" label="Lưu" initial={initial} onSave={onSave} />
      </AuthContext.Provider>,
    ),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('fills the journal fields and stores stable references and work-type aliases', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname.endsWith('/journals')
        ? Response.json({ items: [journal], nextCursor: null })
        : snapshot(),
    ),
  );
  const form = mount();
  const picker = screen.getByRole('searchbox', { name: pickerName });
  fireEvent.change(picker, { target: { value: 'Synthetic Journal' } });
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Synthetic Journal · 1234-5679, 9876-5434 · Tạp chí',
    }),
  );
  const name = screen.getByLabelText('Tên tạp chí');
  expect(name).toHaveValue('Synthetic Journal');
  expect(screen.getByLabelText(/ISSN \(cách nhau/)).toHaveValue('1234-5679, 9876-5434');
  expect(screen.getByLabelText('OpenAlex source id')).toHaveValue('S12345');
  expect(screen.queryByText('Đã sửa tay')).toBeNull();
  fireEvent.change(name, { target: { value: 'Synthetic Journal (edited)' } });
  expect(screen.getByText('Đã sửa tay')).toBeInTheDocument();
  const study = screen.getByRole('checkbox', { name: 'Synthetic study' });
  const review = screen.getByRole('checkbox', { name: 'Synthetic review' });
  expect(study).toHaveAttribute('title', 'art.study');
  fireEvent.click(study);
  fireEvent.click(review);
  fireEvent.click(study);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Synthetic custom' }));
  fireEvent.change(screen.getByLabelText('Loại bài khác (mỗi dòng một loại)'), {
    target: { value: 'Synthetic extra' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(form.onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      venues: [
        {
          name: 'Synthetic Journal (edited)',
          issn: ['1234-5679', '9876-5434'],
          openalexSourceId: 'S12345',
        },
      ],
      articleTypes: ['review', 'Synthetic extra'],
      bank: {
        release,
        journalId: 'jrn.synthetic',
        journalProfile: 'jr.synthetic',
        journalEdited: true,
        articleTypeIds: ['art.review', 'art.custom'],
      },
    }),
  );

  const body = form.onSave.mock.calls[0]?.[0];
  form.unmount();
  mount(body);
  expect(await screen.findByRole('checkbox', { name: 'Synthetic review' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Synthetic custom' })).toBeChecked();
  expect(screen.getByLabelText('Loại bài khác (mỗi dòng một loại)')).toHaveValue('Synthetic extra');
  expect(screen.getByText('Đã sửa tay')).toBeInTheDocument();
});

it('debounces from two characters, aborts the previous request and caps visible results at 20', async () => {
  vi.useFakeTimers();
  const requests: {
    url: URL;
    signal: AbortSignal | null | undefined;
    resolve: (response: Response) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, options) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/snapshot')) return Promise.resolve(snapshot());
      return new Promise<Response>((resolve) => requests.push({ url, signal: options?.signal, resolve }));
    }),
  );
  mount();
  const picker = screen.getByRole('searchbox', { name: pickerName });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  fireEvent.change(picker, { target: { value: 'S' } });
  await advance(300);
  expect(requests).toHaveLength(0);
  fireEvent.change(picker, { target: { value: 'Sy' } });
  await advance(299);
  expect(requests).toHaveLength(0);
  fireEvent.change(picker, { target: { value: 'Syn' } });
  await advance(300);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url.searchParams.get('q')).toBe('Syn');
  fireEvent.change(picker, { target: { value: 'S12345' } });
  expect(requests[0]?.signal?.aborted).toBe(true);
  await advance(300);
  expect(requests).toHaveLength(2);
  expect(requests[1]?.url.searchParams.get('openalex')).toBe('S12345');
  expect(requests[1]?.url.searchParams.get('limit')).toBe('20');
  await act(async () => {
    requests[1]?.resolve(
      Response.json({
        items: Array.from({ length: 21 }, (_, index) => ({
          ...journal,
          id: 'jrn.result-' + index,
          name: 'Synthetic Result ' + index,
        })),
        nextCursor: 'more',
      }),
    );
    requests[0]?.resolve(Response.json({ items: [journal], nextCursor: null }));
  });
  const results = within(screen.getByRole('list', { name: 'Kết quả tìm tạp chí' }));
  expect(results.getAllByRole('button')).toHaveLength(20);
  expect(results.queryByRole('button', { name: /Synthetic Journal/ })).toBeNull();
});

it.each(['404', 'network'])('shows the journal fallback after a %s failure', async (failure) => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      if (new URL(String(input)).pathname.endsWith('/snapshot')) return snapshot();
      if (failure === 'network') throw new TypeError('Offline');
      return new Response(null, { status: 404 });
    }),
  );
  const { onSave } = mount();
  fireEvent.change(screen.getByRole('searchbox', { name: pickerName }), { target: { value: 'Synthetic' } });
  expect(await screen.findByText(fallback)).toBeInTheDocument();
  expect(screen.queryByRole('searchbox', { name: pickerName })).toBeNull();
  const name = screen.getByLabelText('Tên tạp chí');
  expect(screen.getByLabelText(/ISSN \(cách nhau/)).toBeInTheDocument();
  expect(screen.getByLabelText('OpenAlex source id')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Synthetic study' })).toBeInTheDocument();
  fireEvent.change(name, { target: { value: 'Manual Journal' } });
  fireEvent.change(screen.getByLabelText('Loại bài khác (mỗi dòng một loại)'), {
    target: { value: 'Manual article' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      venues: [{ name: 'Manual Journal', issn: [] }],
      articleTypes: ['Manual article'],
    }),
  );
  expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('bank');
});

it('can save a journal registry ID before the article-type snapshot is available', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname.endsWith('/journals')
        ? Response.json({ items: [journal], nextCursor: null })
        : Response.json({ error: 'bad_request', message: 'Unknown collection' }, { status: 400 }),
    ),
  );
  const { onSave } = mount();
  expect(await screen.findByText(fallback)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: pickerName }), { target: { value: '1234-5679' } });
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic Journal/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(onSave.mock.calls[0]?.[0]).toHaveProperty('bank', {
    journalId: 'jrn.synthetic',
    journalProfile: 'jr.synthetic',
  });
});
