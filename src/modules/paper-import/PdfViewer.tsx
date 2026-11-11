import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import { TextField } from '@/shared/ui/TextField';
import { CRITERIA } from './criteria';
import { findNeedle, type PdfMark, type PdfNeedle } from './pdfMarks';
import './pdfTextLayer.css';
import styles from './pdf.module.css';

type PdfJs = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let pdfjsLoading: Promise<PdfJs> | null = null;
/** pdf.js and its worker load only when a PDF is shown; the worker is the one the importer already uses. */
async function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoading ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?worker'),
  ]).then(([pdfjs, worker]) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new worker.default();
    return pdfjs;
  });
  return pdfjsLoading;
}

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** A page to show; a new nonce shows it again. With a passage, the passage itself is outlined. */
export interface PdfTarget {
  page: number;
  nonce: number;
  passage?: PdfNeedle | null;
}

interface RenderedPage {
  holder: HTMLElement;
  items: string[];
  divs: HTMLElement[];
}

/** Boxes over the words of a range of text items, in the page holder's coordinates. */
function boxesFor(page: RenderedPage, ranges: { item: number; from: number; to: number }[]) {
  const origin = page.holder.getBoundingClientRect();
  const boxes: { left: number; top: number; width: number; height: number }[] = [];
  for (const range of ranges) {
    const node = page.divs[range.item]?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const length = node.textContent?.length ?? 0;
    const dom = document.createRange();
    dom.setStart(node, Math.min(range.from, length));
    dom.setEnd(node, Math.min(range.to, length));
    for (const rect of dom.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      boxes.push({
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      });
    }
  }
  return boxes;
}

/**
 * The original PDF, page under page, as the reader knows it. Pages are drawn when they come into view; a
 * text layer over each page keeps the text selectable. `target` scrolls to a page and marks it briefly.
 */
export function PdfViewer({
  blob,
  target,
  marks = [],
  onMark,
}: {
  blob: Blob;
  target: PdfTarget | null;
  /** What was found in the paper, drawn on its words where the passage can be found on the page. */
  marks?: PdfMark[];
  onMark?: (id: string) => void;
}) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState('');
  const [base, setBase] = useState<{ width: number; height: number } | null>(null);
  // Null fits the page to the column width; a number is the reader's own zoom.
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [page, setPage] = useState(1);
  const [flash, setFlash] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const rendered = useRef(new Map<number, number>());
  const pages = useRef(new Map<number, RenderedPage>());
  // The marks layer reads the latest props without re-rendering any page.
  const latest = useRef({ marks, onMark, passage: null as PdfNeedle | null, nonce: 0 });
  const pendingScroll = useRef(0);
  const [missing, setMissing] = useState(false);
  const scale = zoom ?? fitScale;

  useEffect(() => {
    let active = true;
    let loaded: PdfDocument | null = null;
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        loaded = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const first = await loaded.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (!active) return;
        setBase({ width: viewport.width, height: viewport.height });
        setDoc(loaded);
      } catch (cause) {
        if (active) setError(`Không mở được PDF: ${String(cause)}`);
      }
    })();
    return () => {
      active = false;
      void loaded?.cleanup();
    };
  }, [blob]);

  // Fit width follows the column, which changes when the analysis column is shown or hidden.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !base) return;
    const update = () => setFitScale(Math.max(0.3, (element.clientWidth - 32) / base.width));
    update();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [base]);

  /**
   * Draws the marks of one rendered page above its text: a box over the words of each passage that can be
   * found there. A paragraph may run onto the next page, so marks of the page before are looked for too.
   */
  const drawMarks = useCallback((number: number) => {
    const page = pages.current.get(number);
    if (!page) return;
    page.holder.querySelector('.pl-mark-layer')?.remove();
    const { marks: all, passage, nonce } = latest.current;
    const layer = document.createElement('div');
    layer.className = 'pl-mark-layer';
    const own = (needle: PdfNeedle) => needle.page === number || needle.page === number - 1;
    for (const mark of all.filter(own)) {
      const ranges = findNeedle(page.items, mark);
      if (!ranges) continue;
      for (const box of boxesFor(page, ranges)) {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'pl-mark';
        element.dataset.criterion = mark.criterion;
        element.dataset.strong = String(mark.strong);
        element.title = `${CRITERIA[mark.criterion].label}: ${mark.title}`;
        element.setAttribute('aria-label', element.title);
        Object.assign(element.style, {
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        });
        element.addEventListener('click', () => latest.current.onMark?.(mark.id));
        layer.append(element);
      }
    }
    if (passage && own(passage)) {
      const ranges = findNeedle(page.items, passage);
      const boxes = ranges ? boxesFor(page, ranges) : [];
      boxes.forEach((box, index) => {
        const element = document.createElement('div');
        element.className = 'pl-passage';
        element.dataset.first = String(index === 0);
        Object.assign(element.style, {
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        });
        layer.append(element);
      });
      if (pendingScroll.current === nonce) {
        if (boxes.length) {
          pendingScroll.current = 0;
          setMissing(false);
          // After the layer is in place: bring the passage to the upper part of the view.
          window.requestAnimationFrame(() => {
            const root = scroller.current;
            const first = layer.querySelector('.pl-passage');
            if (!root || !first) return;
            const offset = first.getBoundingClientRect().top - root.getBoundingClientRect().top;
            root.scrollTop += offset - root.clientHeight * 0.25;
          });
        } else if (passage.page === number) setMissing(true);
      }
    }
    page.holder.append(layer);
  }, []);

  useEffect(() => {
    latest.current.onMark = onMark;
  }, [onMark]);
  useEffect(() => {
    latest.current = { ...latest.current, marks };
    for (const number of pages.current.keys()) drawMarks(number);
  }, [marks, drawMarks]);

  const renderPage = useCallback(
    async (number: number, holder: HTMLElement) => {
      if (!doc || rendered.current.get(number) === scale) return;
      rendered.current.set(number, scale);
      const pdfjs = await loadPdfJs();
      const pdfPage = await doc.getPage(number);
      const viewport = pdfPage.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      await pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      }).promise;
      if (rendered.current.get(number) !== scale) return;
      const layer = document.createElement('div');
      layer.className = 'pl-text-layer';
      holder.replaceChildren(canvas, layer);
      holder.style.setProperty('--total-scale-factor', String(scale));
      holder.style.setProperty('--scale-round-x', '1px');
      holder.style.setProperty('--scale-round-y', '1px');
      const textLayer = new pdfjs.TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container: layer,
        viewport,
      });
      await textLayer.render();
      if (rendered.current.get(number) !== scale) return;
      pages.current.set(number, {
        holder,
        items: textLayer.textContentItemsStr,
        divs: textLayer.textDivs,
      });
      drawMarks(number);
    },
    [doc, scale, drawMarks],
  );

  // Draw a page when it comes near the view; note which page is on screen for the page counter.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !doc) return;
    rendered.current.clear();
    pages.current.clear();
    const holders = [...root.querySelectorAll<HTMLElement>('[data-page]')];
    if (typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) void renderPage(number, entry.target as HTMLElement);
        }
      },
      { root, rootMargin: '400px 0px' },
    );
    holders.forEach((holder) => observer.observe(holder));
    return () => observer.disconnect();
  }, [doc, renderPage]);

  const goTo = useCallback((number: number) => {
    const holder = scroller.current?.querySelector<HTMLElement>(`[data-page="${number}"]`);
    holder?.scrollIntoView?.({ block: 'start' });
    setPage(number);
  }, []);
  useEffect(() => {
    if (!target || !doc) return;
    const number = Math.min(Math.max(1, target.page), doc.numPages);
    latest.current = { ...latest.current, passage: target.passage ?? null, nonce: target.nonce };
    pendingScroll.current = target.passage ? target.nonce : 0;
    const show = window.setTimeout(() => {
      setMissing(false);
      goTo(number);
      setFlash(number);
      // A page drawn already gets the passage now; one still to come draws it when it renders.
      for (const drawn of pages.current.keys()) drawMarks(drawn);
    }, 0);
    const clear = window.setTimeout(() => setFlash(null), 1600);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(clear);
    };
  }, [target, doc, goTo, drawMarks]);

  const step = (direction: 1 | -1) => {
    // The next preset above or below the current scale, which may sit between presets after fit width.
    const next =
      direction > 0
        ? ZOOMS.find((value) => value > scale + 0.001)
        : [...ZOOMS].reverse().find((value) => value < scale - 0.001);
    setZoom(next ?? (direction > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]) ?? 1);
  };

  if (error) return <p role="alert">{error}</p>;
  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar} role="toolbar" aria-label="PDF">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Trang trước"
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
        >
          ‹
        </Button>
        <TextField
          label="Trang"
          size="sm"
          type="number"
          min={1}
          max={doc?.numPages ?? 1}
          value={String(page)}
          onChange={(event) => {
            const number = Number(event.target.value);
            if (doc && Number.isInteger(number) && number >= 1 && number <= doc.numPages) goTo(number);
          }}
        />
        <span className={styles.count}>/ {doc?.numPages ?? '…'}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Trang sau"
          disabled={!doc || page >= doc.numPages}
          onClick={() => goTo(page + 1)}
        >
          ›
        </Button>
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" aria-label="Thu nhỏ" onClick={() => step(-1)}>
          −
        </Button>
        <span className={styles.count}>{Math.round(scale * 100)}%</span>
        <Button size="sm" variant="ghost" aria-label="Phóng to" onClick={() => step(1)}>
          +
        </Button>
        <Button size="sm" variant="ghost" aria-pressed={zoom === null} onClick={() => setZoom(null)}>
          Vừa khung
        </Button>
        {missing && (
          <p className={styles.missing} role="status">
            Không tìm thấy đúng đoạn trong PDF; đã mở trang chứa đoạn. Xem chính xác ở Text.
          </p>
        )}
      </div>
      <div
        ref={scroller}
        className={styles.pages}
        tabIndex={0}
        aria-label="Các trang PDF"
        onScroll={(event) => {
          // The page counter follows the page that fills the upper part of the view.
          const root = event.currentTarget;
          const line = root.getBoundingClientRect().top + root.clientHeight * 0.3;
          let current = 1;
          for (const holder of root.querySelectorAll<HTMLElement>('[data-page]'))
            if (holder.getBoundingClientRect().top <= line) current = Number(holder.dataset.page);
          setPage(current);
        }}
      >
        {!doc || !base ? (
          <Loading label="Đang mở PDF…" />
        ) : (
          Array.from({ length: doc.numPages }, (_, index) => index + 1).map((number) => (
            <div
              key={`${number}-${scale}`}
              data-page={number}
              data-flash={flash === number}
              className={styles.page}
              aria-label={`Trang ${number}`}
              role="img"
              style={{ width: base.width * scale, height: base.height * scale }}
            />
          ))
        )}
      </div>
    </div>
  );
}
