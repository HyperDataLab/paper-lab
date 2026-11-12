import { readFileSync, readdirSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SectionBlock } from './SectionBlock';
import { PdfViewer } from './PdfViewer';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({ default: class {} }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 600, height: 800 }),
        render: () => ({ promise: Promise.resolve() }),
        streamTextContent: () => ({}),
      }),
      cleanup: () => {},
    }),
  }),
  TextLayer: class {
    textContentItemsStr = ['wrapped passage'];
    textDivs: HTMLElement[] = [];
    constructor(private options: { container: HTMLElement }) {}
    async render() {
      const span = document.createElement('span');
      span.textContent = 'wrapped passage';
      this.options.container.append(span);
      this.textDivs = [span];
    }
  },
}));

it('R16 puts the estimate beside the analysis button and the section action inside options', () => {
  const props = {
    id: 'example',
    title: 'Example',
    help: 'Help',
    criterion: 'writing' as const,
    status: 'todo' as const,
    estimate: 8,
    budget: 10,
    onRun: vi.fn(),
    sectionRun: { sections: [{ id: 'a', label: 'Results', estimate: 1 }], onRun: vi.fn() },
    onToggle: vi.fn(),
    children: null,
  };
  const { rerender } = render(<SectionBlock {...props} open={false} />);
  const button = screen.getByRole('button', { name: 'Phân tích' });
  expect(button).toHaveTextContent(/^Phân tích$/);
  expect(button.parentElement).toHaveTextContent('~8 lượt · trần 10');
  expect(screen.queryByRole('button', { name: 'Chạy cho một mục' })).not.toBeInTheDocument();
  rerender(<SectionBlock {...props} open />);
  expect(screen.getByRole('button', { name: 'Chạy cho một mục' })).toBeVisible();
});

it('R16 keeps the old English missing-value label out of the paper module', () => {
  for (const file of readdirSync('src/modules/paper-import').filter((name) => /\.(ts|tsx)$/.test(name))) {
    expect(readFileSync(`src/modules/paper-import/${file}`, 'utf8')).not.toContain(
      ['Not', 'identified'].join(' '),
    );
  }
});

it('R16 exposes pages as regions and one tab stop for a wrapped mark', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
    },
  );
  const canvas = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({} as CanvasRenderingContext2D);
  const oldRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = () =>
    [
      { left: 1, top: 1, width: 40, height: 10 },
      { left: 1, top: 12, width: 40, height: 10 },
    ] as unknown as DOMRectList;
  const onMark = vi.fn();
  const blob = { arrayBuffer: async () => new ArrayBuffer(1) } as Blob;
  try {
    render(
      <PdfViewer
        blob={blob}
        target={null}
        marks={[
          {
            id: 'mark',
            page: 1,
            before: '',
            text: 'wrapped passage',
            after: '',
            criterion: 'writing',
            strong: true,
            title: 'Passage',
          },
        ]}
        onMark={onMark}
      />,
    );
    const page = await screen.findByRole('region', { name: 'Trang 1' });
    await waitFor(() => expect(page.querySelectorAll('.pl-mark')).toHaveLength(2));
    const boxes = page.querySelectorAll<HTMLButtonElement>('.pl-mark');
    expect(within(page).getAllByRole('button')).toHaveLength(1);
    expect([...boxes].map((box) => box.tabIndex)).toEqual([0, -1]);
    expect(boxes[1]).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(boxes[1] as HTMLButtonElement);
    expect(onMark).toHaveBeenCalledWith('mark');
  } finally {
    canvas.mockRestore();
    Range.prototype.getClientRects = oldRects;
    vi.unstubAllGlobals();
  }
});
