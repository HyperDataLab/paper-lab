import type { Token } from '../schemas/text';
import { createOffsetIndex, type Span } from './offsets';
export const TOKENIZER_VERSION = 'pl-tok-2' as const;
const numericCitation = /^\[\d+(?:\s*[,–—-]\s*\d+)*\]/u;
const year = String.raw`(?:\d{4}[a-z]?|in press|n\.d\.)`;
const surname = String.raw`(?:\p{Ll}+[\s-]+)*\p{Lu}[\p{L}\p{M}'’\-]*(?:[\s-]+\p{Lu}[\p{L}\p{M}'’\-]*)*`;
const authors = String.raw`${surname}(?:\s+et al\.|\s+(?:and|&)\s+${surname})?`;
const group = String.raw`(?:(?:see|e\.g\.|cf\.)\s*,?\s+)?(?:${authors}(?:\s*,\s*|\s+))?${year}(?:\s*,\s*\d{4}[a-z]?)*(?:\s*,\s*pp?\.\s*\d+(?:\s*[-–—]\s*\d+)?)?`;
const authorCitation = new RegExp(String.raw`^\(\s*${group}(?:\s*;\s*${group})*\s*\)`, 'u');
const word = /^(?=[\p{L}\p{M}\d'’-]*\p{L})[\p{L}\p{M}\d]+(?:[-'’][\p{L}\p{M}\d]+)*/u;
const number = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\^[-−+]?\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)?%?/u;
const signedNumber = /^[+−±-](?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\^[-−+]?\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)?%?/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function tokenize(text: string, range?: Span): Token[] {
  const offsets = createOffsetIndex(text);
  const span = offsets.toUtf16Span(range ?? { start: 0, end: offsets.length });
  const tokens: Token[] = [];
  let cursor = span.start;
  while (cursor < span.end) {
    const remaining = text.slice(cursor, span.end);
    const space = /^\s+/u.exec(remaining);
    if (space) {
      cursor += space[0].length;
      continue;
    }
    const grapheme = graphemes.segment(remaining)[Symbol.iterator]().next().value?.segment;
    const emoji = grapheme && /\u20e3/u.test(grapheme) ? grapheme : undefined;
    const previous = Array.from(text.slice(0, cursor)).at(-1) ?? '';
    const signAllowed = previous === '' || /^[\s([{=<>,;:/≈~]$/u.test(previous);
    const citation = numericCitation.exec(remaining) ?? authorCitation.exec(remaining);
    // Decimal compounds such as 3.5-fold remain a number, a hyphen, and a word.
    const match =
      citation ??
      /^\p{Ll}(?=-\d+(?![\p{L}\p{M}\d-]))/u.exec(remaining) ??
      word.exec(remaining) ??
      (signAllowed ? signedNumber.exec(remaining) : null) ??
      number.exec(remaining);
    const value = emoji ?? match?.[0] ?? grapheme;
    if (!value) throw new Error('Unable to tokenize text');
    let kind: Token['kind'];
    if (emoji) kind = 'symbol';
    else if (citation) kind = 'citation';
    else if (word.test(value)) kind = 'word';
    else if (number.test(value) || (signAllowed && signedNumber.test(value))) kind = 'number';
    else if (/^\p{P}/u.test(value)) kind = 'punct';
    else kind = 'symbol';
    tokens.push({
      index: tokens.length,
      text: value,
      start: offsets.utf16ToCp(cursor),
      end: offsets.utf16ToCp(cursor + value.length),
      kind,
    });
    cursor += value.length;
  }
  return tokens;
}
export function isPunctuation(token: Token): boolean {
  return token.kind === 'punct' || (token.kind === 'symbol' && !/^[%‰±+−×÷=<>^]$/u.test(token.text));
}
