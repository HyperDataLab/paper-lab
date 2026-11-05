import type { Sentence, Token } from '../schemas/text';
import { createOffsetIndex } from './offsets';
import { tokenize } from './tokenize';
export const SEGMENTER_VERSION = 'pl-seg-2' as const;
export const SENTENCE_STARTERS = [
  'The',
  'This',
  'These',
  'Those',
  'That',
  'We',
  'Our',
  'It',
  'Its',
  'In',
  'On',
  'At',
  'For',
  'However',
  'Thus',
  'Therefore',
  'Moreover',
  'Furthermore',
  'Although',
  'A',
  'An',
  'Here',
  'There',
  'Such',
  'When',
  'While',
  'After',
  'Before',
  'Finally',
  'First',
  'Second',
  'Similarly',
  'In addition',
] as const;
export const ABBREVIATIONS = [
  'e.g.',
  'i.e.',
  'et al.',
  'etc.',
  'Fig.',
  'Figs.',
  'Eq.',
  'Tab.',
  'vs.',
  'cf.',
  'approx.',
  'ca.',
  'Dr.',
  'Mr.',
  'No.',
  'Vol.',
  'pp.',
  'U.S.',
] as const;
function abbreviation(prefix: string, next: string): boolean {
  const lower = prefix.toLowerCase();
  return ABBREVIATIONS.some((item) => {
    const suffix = item.toLowerCase();
    const start = lower.length - suffix.length;
    return (
      start >= 0 &&
      lower.endsWith(suffix) &&
      (start === 0 || !/[\p{L}]/u.test(lower[start - 1] ?? '')) &&
      (suffix !== 'etc.' || /^\p{Ll}/u.test(next))
    );
  });
}
function initial(prefix: string, following: string): boolean {
  if (!/(?:^|[^\p{L}])\p{Lu}\.$/u.test(prefix)) return false;
  const words = /^\s+(\p{L}[\p{L}\p{M}]*)(\.)?(?:\s+(\p{L}[\p{L}\p{M}]*))?/u.exec(following);
  const next = words?.[1] ?? '';
  if (/^\p{Ll}/u.test(next)) return true;
  if (!/^\p{Lu}/u.test(next)) return false;
  // Names and sentence starts can be indistinguishable without linguistic context.
  const previousInitial = /(?:^|[^\p{L}])\p{Lu}\.\s+\p{Lu}\.$/u.test(prefix);
  const nextCapital = /^\p{Lu}/u.test(words?.[3] ?? '');
  const starter = SENTENCE_STARTERS.some(
    (item) =>
      following.trimStart().startsWith(item) &&
      (following.trimStart().length === item.length ||
        !/[\p{L}\p{M}]/u.test(following.trimStart().slice(item.length, item.length + 1))),
  );
  return previousInitial || nextCapital || !starter;
}
export function segmentSentences(text: string, tokens: Token[] = tokenize(text)): Sentence[] {
  const offsets = createOffsetIndex(text);
  const sentences: Sentence[] = [];
  let start = 0,
    depth = 0,
    tokenStart = 0;
  const emit = (boundary: number) => {
    let end = boundary;
    while (start < end && /\s/u.test(text[start] ?? '')) start++;
    while (end > start && /\s/u.test(text[end - 1] ?? '')) end--;
    if (start === end) return;
    const cpStart = offsets.utf16ToCp(start),
      cpEnd = offsets.utf16ToCp(end);
    while (tokenStart < tokens.length && (tokens[tokenStart]?.end ?? 0) <= cpStart) tokenStart++;
    let tokenEnd = tokenStart;
    while (tokenEnd < tokens.length && (tokens[tokenEnd]?.start ?? cpEnd) < cpEnd) tokenEnd++;
    sentences.push({ id: `s${sentences.length + 1}`, start: cpStart, end: cpEnd, tokenStart, tokenEnd });
    tokenStart = tokenEnd;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    if (char !== '.' && char !== '?' && char !== '!') continue;
    if (char === '.' && /\d/u.test(text[i - 1] ?? '') && /\d/u.test(text[i + 1] ?? '')) continue;
    if (char === '.' && text[i + 1] === '.') continue;
    let end = i + 1;
    while (/^[)\]}"'”’]$/u.test(text[end] ?? '')) end++;
    const next = /^\s+([\s\S])/u.exec(text.slice(end))?.[1] ?? '';
    if (!next || !/^[\p{Lu}\d("'“‘\u005b{]/u.test(next)) continue;
    const closingBrackets = (text.slice(i + 1, end).match(/[)\]}]/gu) ?? []).length;
    if (depth > closingBrackets) continue;
    if (
      char === '.' &&
      (abbreviation(text.slice(start, i + 1), next) || initial(text.slice(start, i + 1), text.slice(end)))
    )
      continue;
    emit(end);
    start = end;
    depth = 0;
    i = end - 1;
  }
  emit(text.length);
  return sentences;
}
