import { locate } from '../reviewPanel';
import type { Paper, PaperParagraph } from '../schemas/paper';
import type { Evidence, ModelField, ProfileField, QuoteRef } from '../schemas/measurement';

const MIN_TEXT_QUOTE = 8;

function normalizeNumeric(text: string) {
  return text.normalize('NFC').replace(/[−–—]/gu, '-').replace(/\s+/gu, ' ').replace(/ %/gu, '%').trim();
}

/** True only when `needle` occurs as a whole number or term: 0.12 is not in 0.123, 1.5 is not in -1.5. */
export function containsExact(haystack: string, needle: string) {
  const hay = normalizeNumeric(haystack);
  const target = normalizeNumeric(needle);
  if (!target) return false;
  const numeric = /^[-+]?[\d.,]*\d/.test(target);
  for (let at = hay.indexOf(target); at >= 0; at = hay.indexOf(target, at + 1)) {
    if (!numeric) return true;
    const before = hay[at - 1] ?? '';
    const beforeThat = hay[at - 2] ?? '';
    const after = hay[at + target.length] ?? '';
    const afterThat = hay[at + target.length + 1] ?? '';
    const digitBefore = /\d/.test(before) || (/[.,]/.test(before) && /\d/.test(beforeThat));
    const signLost = before === '-' && !/[\d)]/.test(beforeThat) && !/^[-+]/.test(target);
    const digitAfter = /\d/.test(after) || (/[.,]/.test(after) && /\d/.test(afterThat));
    if (!digitBefore && !signLost && !digitAfter) return true;
  }
  return false;
}

/** `0.123 ± 0.004` becomes value and uncertainty; a model that already split them is left alone. */
export function splitUncertainty(value: string, uncertainty: string | null) {
  const match = /^(.*?\S)\s*(?:±|\+\/-|\+-)\s*(\S.*)$/u.exec(value.trim());
  const clean = (text: string | null) => text?.trim().replace(/^(?:±|\+\/-|\+-)\s*/u, '') || null;
  if (match && !uncertainty) return { value: match[1] ?? value, uncertainty: match[2] ?? null };
  return { value: value.trim(), uncertainty: clean(uncertainty) };
}

export const MAX_ATOMIC_WORDS = 25;

/** Quantities in a sentence. Names such as GPT-4 or F1 and citation markers such as [12] are not quantities. */
export function atomicNumbers(text: string) {
  const plain = text.replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/gu, ' ');
  return plain.match(/(?<![\p{L}\p{N}.,][-–]?)[-+−]?\d(?:[\d.,]*\d)?/gu) ?? [];
}

function evidenceKind(paragraph: PaperParagraph): Evidence['kind'] {
  if (paragraph.kind === 'table') return 'table';
  if (paragraph.kind === 'equation') return 'equation';
  if (paragraph.kind === 'caption') return /^table\b/i.test(paragraph.text) ? 'table' : 'figure';
  return 'text';
}

/** Code-point span of one cell inside the table block's text (cells joined by spaces, rows by newlines). */
export function cellSpan(paragraph: PaperParagraph, row: number, column: number) {
  const rows = paragraph.table?.rows ?? [];
  let start = 0;
  for (const [rowIndex, current] of rows.entries()) {
    for (const [cellIndex, cell] of current.cells.entries()) {
      const length = Array.from(cell.text).length;
      if (rowIndex === row && cell.column === column) return { start, end: start + length };
      start += length + (cellIndex < current.cells.length - 1 ? 1 : 0);
    }
    start += 1;
  }
  return null;
}

/** Column-header and row-label text around a cell: where a table states the unit of a value. */
export function cellContext(paragraph: PaperParagraph, row: number, column: number) {
  const table = paragraph.table;
  if (!table) return '';
  const above = table.rows
    .slice(0, row)
    .flatMap((current) => current.cells.filter((cell) => cell.column === column).map((cell) => cell.text));
  const label = table.rows[row]?.cells.find((cell) => cell.column === 0)?.text ?? '';
  return [...above, label].join(' ');
}

/** The one cell whose whole text is the quote. Two such cells mean code cannot tell, so neither is chosen. */
function uniqueCell(paragraph: PaperParagraph, quote: string) {
  const target = quote.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const found = (paragraph.table?.rows ?? []).flatMap((row, rowIndex) =>
    row.cells.flatMap((cell) =>
      cell.column !== null && cell.text.normalize('NFC').replace(/\s+/gu, ' ').trim() === target
        ? [{ row: rowIndex, column: cell.column }]
        : [],
    ),
  );
  return found.length === 1 ? found[0] : undefined;
}

export function createVerifier(paper: Paper, blockIds: Set<string>) {
  const blocks = new Map(paper.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const evidence = new Map<string, Evidence>();
  let unverified = 0;
  function remember(
    paragraph: PaperParagraph,
    span: Evidence['span'],
    cell: Evidence['cell'],
    excerpt: string,
    needsReview: boolean,
  ) {
    const key = `${paragraph.id}:${span?.start ?? ''}:${span?.end ?? ''}:${cell?.row ?? ''}:${cell?.column ?? ''}`;
    const known = evidence.get(key);
    if (known) return known;
    const created: Evidence = {
      id: `ev-${String(evidence.size + 1).padStart(4, '0')}`,
      blockId: paragraph.id,
      page: paragraph.pageStart,
      sectionId: paragraph.sectionId,
      kind: evidenceKind(paragraph),
      span,
      cell,
      source_excerpt: excerpt,
      needs_review: needsReview,
    };
    evidence.set(key, created);
    return created;
  }
  function resolve(ref: QuoteRef): Evidence | null {
    const paragraph = blocks.get(ref.blockId);
    if (!paragraph || !blockIds.has(ref.blockId)) return miss();
    const low = paragraph.table?.confidence === 'low';
    if (paragraph.table) {
      const named =
        ref.row !== null && ref.column !== null
          ? paragraph.table.rows[ref.row]?.cells.find((item) => item.column === ref.column)
          : undefined;
      const place =
        named && ref.row !== null && ref.column !== null && locate(named.text, ref.quote)
          ? { row: ref.row, column: ref.column }
          : uniqueCell(paragraph, ref.quote);
      if (place) {
        const cell = paragraph.table.rows[place.row]?.cells.find((item) => item.column === place.column);
        return remember(
          paragraph,
          cellSpan(paragraph, place.row, place.column),
          place,
          cell?.text ?? '',
          low,
        );
      }
      if (ref.row !== null && ref.column !== null) return miss();
    }
    if (Array.from(ref.quote.trim()).length < MIN_TEXT_QUOTE) return miss();
    const span = locate(paragraph.text, ref.quote);
    if (!span) return miss();
    const excerpt = Array.from(paragraph.text).slice(span.start, span.end).join('');
    return remember(paragraph, span, null, excerpt, low);
  }
  function miss() {
    unverified++;
    return null;
  }
  function field(raw: ModelField): ProfileField {
    const found = raw.quotes.map(resolve).filter((item): item is Evidence => item !== null);
    const ids = [...new Set(found.map((item) => item.id))];
    const reviewEvidence = found.some((item) => item.needs_review);
    if (raw.status === 'NOT_REPORTED' || raw.status === 'NOT_APPLICABLE')
      return { value: null, status: raw.status, evidence_ids: [], needs_review: false };
    if (raw.status === 'REPORTED') {
      if (raw.value === null)
        return { value: null, status: 'NOT_REPORTED', evidence_ids: [], needs_review: true };
      if (!ids.length) return { value: raw.value, status: 'INFERRED', evidence_ids: [], needs_review: true };
      if (
        /^\S*\d\S*$/.test(raw.value.trim()) &&
        !found.some((item) => containsExact(item.source_excerpt, raw.value ?? ''))
      )
        return { value: raw.value, status: 'INFERRED', evidence_ids: ids, needs_review: true };
      return { value: raw.value, status: 'REPORTED', evidence_ids: ids, needs_review: reviewEvidence };
    }
    if (raw.status === 'CONTRADICTORY' && ids.length < 2)
      return { value: raw.value, status: 'INFERRED', evidence_ids: ids, needs_review: true };
    return {
      value: raw.value,
      status: raw.status,
      evidence_ids: ids,
      needs_review: reviewEvidence || (raw.quotes.length > 0 && ids.length < raw.quotes.length),
    };
  }
  return {
    resolve,
    field,
    block: (id: string) => blocks.get(id),
    evidence: () => [...evidence.values()],
    unverified: () => unverified,
  };
}
export type Verifier = ReturnType<typeof createVerifier>;
