import type { Finding, Paper, PaperParagraph } from '../schemas';
import { isStanceSection } from '../stance';
import { segmentSentences } from '../text/segment';
import { tokenize } from '../text/tokenize';

const FUNCTION_WORDS = new Set(
  `a about above after again against all also am among an and any are as at be because been before being below
  between both but by can could did do does doing down during each either few for from further had has have having
  he her here hers him his how i if in into is it its itself just may me might more most must my no nor not now of
  off on once only or other our ours out over own shall she should so some such than that the their theirs them
  then there these they this those through to too under until up upon us very was we were what when where which
  while who whom why will with within without would you your`.split(/\s+/u),
);
const LONG_WORD = 8;
const CHUNK_WORDS = 1000;
export const BUNDLE_WORDS = 4;
const BUNDLE_MIN_COUNT = 3;
const BUNDLE_LIMIT = 20;
export const BASELINE_MIN_PAPERS = 3;

const wordsOf = (text: string) =>
  tokenize(text)
    .filter((token) => token.kind === 'word')
    .map((token) => token.text.toLowerCase());

/** Prose only: references, captions and tables would distort every ratio below. */
export function proseParagraphs(paper: Paper, sectionId?: string) {
  const sections = new Set(
    paper.sections.filter((section) => isStanceSection(section)).map((section) => section.id),
  );
  return paper.paragraphs.filter(
    (paragraph) =>
      paragraph.kind === 'body' &&
      sections.has(paragraph.sectionId) &&
      (!sectionId || paragraph.sectionId === sectionId),
  );
}

export interface LanguageMetrics {
  words: number;
  /** Content words as a share of all words. */
  lexicalDensity: number | null;
  /** Distinct words per 1,000, averaged over complete runs of 1,000 so that length does not inflate it. */
  diversity: number | null;
  longWordShare: number | null;
  sentenceWords: number | null;
}

export function languageMetrics(paragraphs: PaperParagraph[]): LanguageMetrics {
  const words = paragraphs.flatMap((paragraph) => wordsOf(paragraph.text));
  const sentences = paragraphs.reduce((sum, paragraph) => sum + segmentSentences(paragraph.text).length, 0);
  const chunks = Math.floor(words.length / CHUNK_WORDS);
  let distinct = 0;
  for (let index = 0; index < chunks; index++)
    distinct += new Set(words.slice(index * CHUNK_WORDS, (index + 1) * CHUNK_WORDS)).size;
  const share = (count: number) => (words.length ? count / words.length : null);
  return {
    words: words.length,
    lexicalDensity: share(words.filter((word) => !FUNCTION_WORDS.has(word)).length),
    diversity: chunks ? distinct / chunks : null,
    longWordShare: share(words.filter((word) => Array.from(word).length >= LONG_WORD).length),
    sentenceWords: sentences ? words.length / sentences : null,
  };
}

export interface RepeatedPhrase {
  phrase: string;
  count: number;
  paragraphs: number;
  per1000: number;
  location: Finding['locations'][number];
}

/** Word sequences that recur across paragraphs. Punctuation and citations break a sequence. */
export function repeatedPhrases(paragraphs: PaperParagraph[]): RepeatedPhrase[] {
  const found = new Map<string, Omit<RepeatedPhrase, 'per1000' | 'paragraphs'> & { ids: Set<string> }>();
  let total = 0;
  for (const paragraph of paragraphs) {
    const tokens = tokenize(paragraph.text);
    total += tokens.filter((token) => token.kind === 'word').length;
    for (let index = 0; index + BUNDLE_WORDS <= tokens.length; index++) {
      const window = tokens.slice(index, index + BUNDLE_WORDS);
      if (window.some((token) => token.kind !== 'word')) continue;
      const words = window.map((token) => token.text.toLowerCase());
      if (words.every((word) => FUNCTION_WORDS.has(word))) continue;
      const phrase = words.join(' ');
      const first = window[0];
      const last = window.at(-1);
      if (!first || !last) continue;
      const entry = found.get(phrase) ?? {
        phrase,
        count: 0,
        ids: new Set<string>(),
        location: { paragraphId: paragraph.id, start: first.start, end: last.end },
      };
      entry.count++;
      entry.ids.add(paragraph.id);
      found.set(phrase, entry);
    }
  }
  return [...found.values()]
    .filter((entry) => entry.count >= BUNDLE_MIN_COUNT && entry.ids.size >= 2)
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
    .slice(0, BUNDLE_LIMIT)
    .map(({ phrase, count, ids, location }) => ({
      phrase,
      count,
      paragraphs: ids.size,
      per1000: total ? (count / total) * 1000 : 0,
      location,
    }));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return null;
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export type LanguageBaseline = Record<Exclude<keyof LanguageMetrics, 'words'>, number | null> & {
  papers: number;
};

/** The median of the user's other papers. Too few of them make no baseline at all, rather than a weak one. */
export function languageBaseline(others: Paper[]): LanguageBaseline | null {
  const rows = others.map((paper) => languageMetrics(proseParagraphs(paper))).filter((row) => row.words > 0);
  if (rows.length < BASELINE_MIN_PAPERS) return null;
  const of = (key: Exclude<keyof LanguageMetrics, 'words'>) =>
    median(rows.flatMap((row) => (row[key] === null ? [] : [row[key]])));
  return {
    papers: rows.length,
    lexicalDensity: of('lexicalDensity'),
    diversity: of('diversity'),
    longWordShare: of('longWordShare'),
    sentenceWords: of('sentenceWords'),
  };
}
