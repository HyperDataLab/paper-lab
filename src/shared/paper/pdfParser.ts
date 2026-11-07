import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import type { PaperLine } from '@/core/paper';
import { guardPaperSize } from './sizeGuard';

export interface TextItemLike {
  str: string;
  transform: number[];
  height: number;
  width?: number;
  hasEOL?: boolean;
}
export interface PdfLine {
  text: string;
  y: number;
  height: number;
  x: number;
  end?: number;
  column?: 'left' | 'right' | 'full';
  columnStart?: number;
  columnEnd?: number;
}
export interface PdfPage {
  page: number;
  height: number;
  lines: PdfLine[];
}
export function itemsToLines(items: TextItemLike[], pageHeight: number): PdfLine[] {
  const positioned = items
    .filter((item) => item.str)
    .map((item) => {
      const x = item.transform[4] ?? 0;
      const height = Math.abs(item.height || item.transform[3] || 10);
      return {
        item,
        x,
        y: pageHeight - (item.transform[5] ?? 0),
        height,
        end: x + (item.width ?? item.str.length * height * 0.5),
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { parts: typeof positioned; x: number; end: number; y: number; height: number }[] = [];
  for (const part of positioned) {
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - part.y) <= Math.max(2, part.height * 0.4) &&
        part.x <= candidate.end + Math.max(8, part.height * 1.5) &&
        part.end >= candidate.x - Math.max(8, part.height * 1.5),
    );
    if (line) {
      line.parts.push(part);
      line.x = Math.min(line.x, part.x);
      line.end = Math.max(line.end, part.end);
      line.height = Math.max(line.height, part.height);
    } else lines.push({ parts: [part], x: part.x, end: part.end, y: part.y, height: part.height });
  }
  for (const fragment of [...lines]) {
    if (
      fragment.parts.length !== 1 ||
      fragment.parts[0]?.item.str.trim().length === 0 ||
      (fragment.parts[0]?.item.str.trim().length ?? 0) > 4 ||
      /\s/.test(fragment.parts[0]?.item.str.trim() ?? '')
    )
      continue;
    const distance = (line: (typeof lines)[number]) =>
      Math.min(...line.parts.map((part) => Math.abs(fragment.x - part.end)));
    const base = lines
      .filter(
        (line) =>
          line !== fragment &&
          line.height >= fragment.height * 1.25 &&
          fragment.y < line.y &&
          line.y - fragment.y <= line.height * 0.8 &&
          line.parts.some((part) => fragment.x >= part.end - 2 && fragment.x - part.end <= line.height * 0.5),
      )
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!base) continue;
    base.parts.push(...fragment.parts);
    base.end = Math.max(base.end, fragment.end);
    lines.splice(lines.indexOf(fragment), 1);
  }
  const ordered = orderColumns(lines);
  return ordered.map((line) => {
    const parts = line.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let previous: (typeof parts)[number] | undefined;
    for (const part of parts) {
      const gap = previous ? part.x - previous.end : 0;
      if (
        previous &&
        !text.endsWith(' ') &&
        !part.item.str.startsWith(' ') &&
        (previous.item.width === undefined || gap > part.height * 0.15)
      )
        text += ' ';
      text += part.item.str;
      previous = part;
    }
    return {
      text,
      x: line.x,
      end: line.end,
      y: line.y,
      height: line.height,
      ...(line.column
        ? { column: line.column, columnStart: line.columnStart, columnEnd: line.columnEnd }
        : {}),
    };
  });
}
function orderColumns<T extends { x: number; end: number; y: number; height: number }>(
  lines: T[],
): (T & { column?: 'left' | 'right' | 'full'; columnStart?: number; columnEnd?: number })[] {
  const starts = [...new Set(lines.map((line) => line.x))].sort((a, b) => a - b);
  let split: number | undefined;
  let bestGap = 0;
  let leftStart = 0;
  let rightStart = 0;
  for (let i = 1; i < starts.length; i++) {
    const left = starts[i - 1];
    const right = starts[i];
    if (left === undefined || right === undefined) continue;
    const gap = right - left;
    const a = lines.filter((line) => line.end <= right - 5);
    const b = lines.filter((line) => line.x >= right);
    if (gap <= bestGap || gap < 40 || a.length < 2 || b.length < 2) continue;
    const paired = a.filter((line) =>
      b.some((other) => Math.abs(line.y - other.y) <= Math.max(line.height, other.height) * 1.5),
    );
    if (paired.length < 2) continue;
    split = (Math.max(...a.map((line) => line.end)) + right) / 2;
    bestGap = gap;
    leftStart = Math.min(...a.map((line) => line.x));
    rightStart = right;
  }
  if (split === undefined) return lines.sort((a, b) => a.y - b.y || a.x - b.x);
  const gutter = split;
  const spanning = lines
    .filter(
      (line) =>
        line.x < gutter &&
        line.x <= leftStart + (rightStart - leftStart) * 0.25 &&
        line.end > rightStart + (rightStart - leftStart) * 0.25,
    )
    .sort((a, b) => a.y - b.y);
  const result: (T & { column?: 'left' | 'right' | 'full'; columnStart?: number; columnEnd?: number })[] = [];
  let previousY = -Infinity;
  for (const boundary of [...spanning, null]) {
    const endY = boundary?.y ?? Infinity;
    const band = lines.filter((line) => !spanning.includes(line) && line.y >= previousY && line.y < endY);
    result.push(
      ...band
        .filter((line) => line.x < gutter)
        .sort((a, b) => a.y - b.y)
        .map((line) => ({ ...line, column: 'left' as const, columnStart: leftStart, columnEnd: gutter })),
      ...band
        .filter((line) => line.x >= gutter)
        .sort((a, b) => a.y - b.y)
        .map((line) => ({ ...line, column: 'right' as const, columnStart: gutter, columnEnd: Infinity })),
    );
    if (boundary) result.push({ ...boundary, column: 'full' });
    previousY = endY;
  }
  return result;
}
export function removeRunningHeaders(pages: PdfPage[]): PaperLine[] {
  const counts = new Map<string, number>();
  const normalize = (text: string) => text.trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  for (const page of pages) {
    const edge = new Set(
      page.lines
        .filter((line) => line.y < page.height * 0.1 || line.y > page.height * 0.9)
        .map((line) => normalize(line.text)),
    );
    for (const text of edge) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return pages.flatMap((page) => {
    let previous: PdfLine | undefined;
    return page.lines.flatMap((line) => {
      const edge = line.y < page.height * 0.1 || line.y > page.height * 0.9;
      const text = line.text.trim();
      if (/^\d{1,4}$|^page\s+\d+(?:\s+of\s+\d+)?$/i.test(text) || /^arxiv:\s*\d/i.test(text)) return [];
      if (edge && (counts.get(normalize(text)) ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.5))) return [];
      const breakBefore =
        previous !== undefined &&
        (line.column !== previous.column ||
          line.y < previous.y - Math.max(previous.height, line.height) ||
          line.y - previous.y > Math.max(previous.height, line.height) * 1.8);
      previous = line;
      return [
        {
          text: line.text,
          pageStart: page.page,
          breakBefore,
          height: line.height,
          x: line.x,
          end: line.end,
          column: line.column,
          columnStart: line.columnStart,
          columnEnd: line.columnEnd,
        },
      ];
    });
  });
}
export async function extractPdfText(data: ArrayBuffer, onProgress?: (done: number, total: number) => void) {
  guardPaperSize(data.byteLength);
  if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  try {
    const doc = await task.promise;
    guardPaperSize(data.byteLength, doc.numPages);
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is typeof item & TextItemLike => 'str' in item);
      pages.push({ page: n, height: viewport.height, lines: itemsToLines(items, viewport.height) });
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    return { lines: removeRunningHeaders(pages), pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}
