import type { RevisionOutput } from '../prompts/revision';
import type { Span } from '../schemas/span';
import { createOffsetIndex, sliceCp } from '../text/offsets';
import { tokenize } from '../text/tokenize';

export type RevisionHunk = {
  kind: 'equal' | 'insert' | 'delete' | 'replace';
  before: Span | null;
  after: Span | null;
};

export function alignRevision(source: string, revised: string): RevisionHunk[] {
  const parts = (text: string) => {
    const result: { text: string; start: number; end: number }[] = [];
    const index = createOffsetIndex(text);
    let cursor = 0;
    for (const token of tokenize(text)) {
      if (cursor < token.start)
        result.push({ text: index.sliceCp(cursor, token.start), start: cursor, end: token.start });
      result.push(token);
      cursor = token.end;
    }
    if (cursor < index.length)
      result.push({ text: index.sliceCp(cursor, index.length), start: cursor, end: index.length });
    return result;
  };
  const a = parts(source);
  const b = parts(revised);
  const rows = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = rows[i];
      const next = rows[i + 1];
      if (!row || !next) continue;
      row[j] = a[i]?.text === b[j]?.text ? 1 + (next[j + 1] ?? 0) : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const result: RevisionHunk[] = [];
  let i = 0;
  let j = 0;
  const add = (kind: RevisionHunk['kind'], before: Span | null, after: Span | null) => {
    const previous = result.at(-1);
    if (previous && previous.kind === kind) {
      if (previous.before && before) previous.before.end = before.end;
      if (previous.after && after) previous.after.end = after.end;
    } else result.push({ kind, before, after });
  };
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left && right && left.text === right.text) {
      add('equal', { start: left.start, end: left.end }, { start: right.start, end: right.end });
      i++;
      j++;
    } else if (right && (!left || (rows[i]?.[j + 1] ?? 0) > (rows[i + 1]?.[j] ?? 0))) {
      add('insert', null, { start: right.start, end: right.end });
      j++;
    } else if (left) {
      add('delete', { start: left.start, end: left.end }, null);
      i++;
    }
  }
  const merged: RevisionHunk[] = [];
  for (const hunk of result) {
    const previous = merged.at(-1);
    if (
      (previous?.kind === 'delete' && hunk.kind === 'insert') ||
      (previous?.kind === 'insert' && hunk.kind === 'delete')
    ) {
      previous.kind = 'replace';
      previous.before = previous.before ?? hunk.before;
      previous.after = previous.after ?? hunk.after;
    } else merged.push(hunk);
  }
  return merged;
}

export function attachChanges(
  source: string,
  revised: string,
  hunks: RevisionHunk[],
  changes: RevisionOutput['changes'],
) {
  const anchor = (text: string, quote: string): Span | null => {
    if (!quote.trim()) return null;
    const pattern = quote
      .trim()
      .split(/\s+/u)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
      .join('\\s+');
    const matches = [...text.matchAll(new RegExp(pattern, 'gu'))];
    if (matches.length !== 1 || !matches[0]) return null;
    const match = matches[0];
    const offsets = createOffsetIndex(text);
    return { start: offsets.utf16ToCp(match.index), end: offsets.utf16ToCp(match.index + match[0].length) };
  };
  const anchors = changes.map((change) => ({
    before: anchor(source, change.before),
    after: anchor(revised, change.after),
  }));
  let beforeCursor = 0;
  let afterCursor = 0;
  const attached = hunks.map((hunk) => {
    const beforePosition = hunk.before?.start ?? beforeCursor;
    const afterPosition = hunk.after?.start ?? afterCursor;
    const contains = (
      outer: Span | null,
      inner: Span | null,
      position: number,
      quote: string,
      text: string,
    ) => {
      if (!outer) return !quote.trim() && !inner;
      if (!inner) return position >= outer.start && position <= outer.end;
      const content = sliceCp(text, inner.start, inner.end);
      const leading = Array.from(content.match(/^\s*/u)?.[0] ?? '').length;
      const trailing = Array.from(content.match(/\s*$/u)?.[0] ?? '').length;
      const start = content.trim() ? inner.start + leading : inner.start;
      const end = content.trim() ? inner.end - trailing : inner.end;
      return start >= outer.start && end <= outer.end;
    };
    const changeIndexes = changes.flatMap((change, index) => {
      const ranges = anchors[index];
      return hunk.kind !== 'equal' &&
        ranges &&
        contains(ranges.before, hunk.before, beforePosition, change.before, source) &&
        contains(ranges.after, hunk.after, afterPosition, change.after, revised)
        ? [index]
        : [];
    });
    if (hunk.before) beforeCursor = hunk.before.end;
    if (hunk.after) afterCursor = hunk.after.end;
    return { ...hunk, changeIndexes, unexplained: hunk.kind !== 'equal' && changeIndexes.length === 0 };
  });
  return {
    hunks: attached,
    unmatchedChanges: changes.filter((_, index) => !attached.some((h) => h.changeIndexes.includes(index))),
  };
}
