import type { PaperTable } from '@/core/schemas';

/** A positioned text item as grouped by `itemsToLines`. */
export interface DetectablePart {
  item: { str: string; width?: number };
  x: number;
  end: number;
  y: number;
  height: number;
}
export interface DetectableLine {
  parts: DetectablePart[];
  x: number;
  end: number;
  y: number;
  height: number;
}
export interface DetectedTable<L> {
  table: PaperTable;
  lines: L[];
  x: number;
  end: number;
  y: number;
  height: number;
}

interface Segment {
  text: string;
  x: number;
  end: number;
}
interface Row<L> {
  y: number;
  height: number;
  segments: Segment[];
  lines: L[];
}
interface Interval {
  x: number;
  end: number;
}

const MIN_ROWS = 3;
const WIDE_CELL_SHARE = 0.3;
const CAPTION = /^table\s+(?:\d+|[ivxl]+)\b/i;
const FIGURE_CAPTION = /^(?:figure|fig\.)\s*\d+/i;
const ENUMERATOR = /^(?:[-*•–]|\(?\d+[.)]|\(?[a-z][.)])$/i;
const EQUATION_NUMBER = /^\(\d+[a-z]?\)$/;

/** Splits a line where the horizontal gap is too wide to be a word space. */
function segmentsOf(line: DetectableLine): Segment[] {
  const segments: Segment[] = [];
  let previous: DetectablePart | undefined;
  for (const part of [...line.parts].sort((a, b) => a.x - b.x)) {
    if (!part.item.str.trim()) continue;
    const gap = previous ? part.x - previous.end : 0;
    const current = segments.at(-1);
    if (!current || gap > Math.max(part.height * 0.8, 6)) {
      segments.push({ text: part.item.str, x: part.x, end: part.end });
    } else {
      if (
        !current.text.endsWith(' ') &&
        !part.item.str.startsWith(' ') &&
        (part.item.width === undefined || gap > part.height * 0.15)
      )
        current.text += ' ';
      current.text += part.item.str;
      current.end = Math.max(current.end, part.end);
    }
    previous = part;
  }
  return segments.map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, ' ').trim() }));
}

function visualRows<L extends DetectableLine>(lines: L[]): Row<L>[] {
  const rows: Row<L>[] = [];
  for (const line of [...lines].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(line.y - row.y) <= Math.max(2, Math.max(row.height, line.height) * 0.4)) {
      row.segments.push(...segmentsOf(line));
      row.lines.push(line);
      row.height = Math.max(row.height, line.height);
    } else rows.push({ y: line.y, height: line.height, segments: segmentsOf(line), lines: [line] });
  }
  for (const row of rows) row.segments.sort((a, b) => a.x - b.x);
  return rows;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function overlaps(segment: Interval, column: Interval) {
  return segment.x < column.end + 1 && segment.end > column.x - 1;
}

/** Column bands from the rows with the most common cell count; outlier cells do not widen them. */
function columnBands<L>(rows: Row<L>[]): Interval[] | null {
  const counts = new Map<number, number>();
  for (const row of rows)
    if (row.segments.length >= 2) counts.set(row.segments.length, (counts.get(row.segments.length) ?? 0) + 1);
  const [modal] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0];
  if (modal < 2) return null;
  const reference = rows.filter((row) => row.segments.length === modal);
  const bands: Interval[] = [];
  for (let column = 0; column < modal; column++) {
    const cells = reference.flatMap((row) => row.segments[column] ?? []);
    const band = { x: median(cells.map((cell) => cell.x)), end: median(cells.map((cell) => cell.end)) };
    const aligned = cells.filter((cell) => overlaps(cell, band));
    bands.push({
      x: Math.min(...aligned.map((cell) => cell.x)),
      end: Math.max(...aligned.map((cell) => cell.end)),
    });
  }
  const separated = bands.every((band, index) => {
    const next = bands[index + 1];
    return !next || band.end <= next.x;
  });
  return separated ? bands : null;
}

function isNumeric(text: string) {
  return text.length <= 24 && /\d/.test(text);
}

function nearbyCaption<L extends DetectableLine>(lines: L[], rows: Row<L>[], pattern: RegExp) {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return false;
  const textOf = (line: L) =>
    segmentsOf(line)
      .map((segment) => segment.text)
      .join(' ');
  const above = lines.filter((line) => line.y < first.y && first.y - line.y <= first.height * 8);
  const below = lines.filter((line) => line.y > last.y && line.y - last.y <= last.height * 4);
  return [...above, ...below].some((line) => pattern.test(textOf(line)));
}

function buildTable<L extends DetectableLine>(
  rows: Row<L>[],
  captioned: boolean,
): { table: PaperTable; mapped: number; numericShare: number } | null {
  const bands = columnBands(rows);
  if (!bands) return null;
  let low = !captioned;
  const built = rows.map((row) => {
    const used = new Set<number>();
    const cells = row.segments.map((segment) => {
      const hit = bands.flatMap((band, index) => (overlaps(segment, band) ? [index] : []));
      const column = hit[0];
      if (column === undefined || hit.length > 1 || used.has(column)) low = true;
      if (column === undefined || used.has(column)) return { text: segment.text, column: null };
      used.add(column);
      return { text: segment.text, column };
    });
    return { cells };
  });
  const headerFragments = rows
    .slice(0, 2)
    .filter(
      (row) => row.segments.length < bands.length && !row.segments.some((segment) => isNumeric(segment.text)),
    );
  if (headerFragments.length === 2) low = true;
  const bodyCells = built.flatMap((row) => row.cells.filter((cell) => (cell.column ?? 0) > 0));
  return {
    table: { captionId: null, rows: built, columns: bands.length, confidence: low ? 'low' : 'high' },
    mapped: built.filter((row) => row.cells.filter((cell) => cell.column !== null).length >= 2).length,
    numericShare: bodyCells.length
      ? bodyCells.filter((cell) => isNumeric(cell.text)).length / bodyCells.length
      : 0,
  };
}

function isTabular<L>(row: Row<L>, wideLimit: number) {
  if (row.segments.length < 2) return false;
  if (row.segments.some((segment) => segment.end - segment.x > wideLimit)) return false;
  return !(row.segments.length === 2 && EQUATION_NUMBER.test(row.segments[1]?.text ?? ''));
}

function regions<L>(rows: Row<L>[], wideLimit: number): Row<L>[][] {
  const found: Row<L>[][] = [];
  let current: Row<L>[] = [];
  const close = () => {
    if (current.length) found.push(current);
    current = [];
  };
  rows.forEach((row, index) => {
    const previous = current.at(-1);
    if (previous && row.y - previous.y > Math.max(row.height, previous.height) * 3) close();
    if (isTabular(row, wideLimit)) {
      current.push(row);
      return;
    }
    const next = rows[index + 1];
    const short = row.segments.length === 1 && row.segments.every((s) => s.end - s.x <= wideLimit);
    if (current.length && short && next && isTabular(next, wideLimit)) current.push(row);
    else close();
  });
  close();
  return found;
}

/**
 * Finds table regions on one page. Text that cannot be proved tabular stays ordinary lines: no caption
 * and no numeric cells means no table, and a cell that fits no column is left without a column.
 */
export function detectTables<L extends DetectableLine>(lines: L[], pageWidth?: number): DetectedTable<L>[] {
  const extent = lines.length
    ? Math.max(...lines.map((line) => line.end)) - Math.min(...lines.map((line) => line.x))
    : 0;
  const wideLimit = (pageWidth ?? extent) * WIDE_CELL_SHARE;
  const centre = pageWidth === undefined ? undefined : pageWidth / 2;
  const consumed = new Set<L>();
  const tables: DetectedTable<L>[] = [];
  const scan = (scope: L[], other: L[] | null) => {
    for (const rows of regions(visualRows(scope), wideLimit)) {
      if (rows.length < MIN_ROWS) continue;
      const firstCells = rows.map((row) => row.segments[0]?.text ?? '');
      if (firstCells.filter((text) => ENUMERATOR.test(text)).length >= rows.length * 0.6) continue;
      const captioned = nearbyCaption(scope, rows, CAPTION);
      if (!captioned && nearbyCaption(scope, rows, FIGURE_CAPTION)) continue;
      const built = buildTable(rows, captioned);
      if (!built || built.mapped < MIN_ROWS) continue;
      if (!captioned && built.numericShare < 0.5) continue;
      if (other) {
        const beside = rows.filter((row) =>
          other.some(
            (line) =>
              Math.abs(line.y - row.y) <= Math.max(2, row.height * 0.4) && line.end - line.x <= wideLimit,
          ),
        );
        if (beside.length >= rows.length / 2) continue;
      }
      const used = rows.flatMap((row) => row.lines);
      for (const line of used) consumed.add(line);
      tables.push({
        table: built.table,
        lines: used,
        x: Math.min(...used.map((line) => line.x)),
        end: Math.max(...used.map((line) => line.end)),
        y: rows[0]?.y ?? 0,
        height: Math.max(...rows.map((row) => row.height)),
      });
    }
  };
  const free = () => lines.filter((line) => !consumed.has(line));
  scan(lines, null);
  if (centre !== undefined) {
    const left = () => free().filter((line) => line.end <= centre + 2);
    const right = () => free().filter((line) => line.x >= centre - 2);
    scan(left(), right());
    scan(right(), left());
  }
  return tables;
}

/** Plain-text form of a table: cells joined in a row, rows on separate lines. */
export function tableText(table: PaperTable) {
  return table.rows.map((row) => row.cells.map((cell) => cell.text).join(' ')).join('\n');
}
