import { tokenize, TOKENIZER_VERSION } from '../text/tokenize';
import { benjaminiHochberg, keyness } from './stats';

/** Bump when the normalisation below changes: phrase counts are only comparable within one version. */
export const PHRASE_TOKENIZER_VERSION = `paperlab-phrase-1+${TOKENIZER_VERSION}`;
export const PHRASE_NORMALISATION =
  'Body sentences only (publisher boilerplate, references and title removed). Word tokens of the PaperLab tokenizer; NFKC, lower-cased, curly apostrophes made straight; numbers, citation markers, punctuation and symbols dropped. N-grams of 1–5 tokens never cross a sentence boundary.';

/** Owner decision 5 (CORPUS_PLAN section 8), plus the cut-offs of the phrase list. */
export const PHRASE_RULES = {
  maxWords: 5,
  minTargetPrevalence: 0.05,
  minTargetPapers: 5,
  alpha: 0.05,
  top: 50,
  maxEvidence: 3,
  maxExcerptChars: 300,
} as const;

export type PhraseRules = { [K in keyof typeof PHRASE_RULES]: number };
export type PhraseSentence = { key: string; text: string };
export type PhrasePaper = { memberExportId: string; sentences: readonly PhraseSentence[] };
export type PhraseEvidence = { memberExportId: string; sentenceKey: string; excerpt: string };
export type PhraseSignal = {
  phraseId: string;
  text: string;
  words: number;
  targetPapers: number;
  controlPapers: number;
  targetPrevalence: number;
  controlPrevalence: number;
  g2: number;
  logRatio: number;
  pValue: number;
  qValue: number;
  evidence: PhraseEvidence[];
};
export type PhraseResult = {
  /** Phrases that passed decision 5 and were tested; the Benjamini–Hochberg family. */
  tested: number;
  items: PhraseSignal[];
};

type Token = { text: string; start: number; end: number };

function phraseTokenSpans(text: string): Token[] {
  return tokenize(text)
    .filter((token) => token.kind === 'word')
    .map((token) => ({
      text: token.text.normalize('NFKC').toLowerCase().replace(/’/gu, "'"),
      start: token.start,
      end: token.end,
    }));
}

/** The normalised tokens a phrase is made of. */
export const phraseTokens = (text: string): string[] => phraseTokenSpans(text).map((token) => token.text);

/** FNV-1a, 32 bits: a short stable id that fits the signature's id pattern. */
function fnv(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function grams(tokens: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

/** An excerpt of at most `max` characters, centred on the phrase when the sentence is longer. */
function excerptOf(text: string, tokens: readonly Token[], at: number, n: number, max: number) {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  const start = tokens[at]?.start ?? 0,
    end = tokens[at + n - 1]?.end ?? start;
  const room = max - 2;
  const from = Math.max(0, Math.min(start - Math.floor((room - (end - start)) / 2), chars.length - room));
  const body = chars.slice(from, from + room).join('');
  const out = `${from > 0 ? '…' : ''}${body}${from + room < chars.length ? '…' : ''}`;
  return out.length <= max ? out : out.slice(0, max);
}

/**
 * Phrase keyness at the paper level. Each 1–5 word n-gram is counted once per paper (document frequency),
 * so G² and Log Ratio compare the number of papers using it in target and control. Only phrases in at least
 * `minTargetPrevalence` of target papers and at least `minTargetPapers` papers are tested (decision 5);
 * Benjamini–Hochberg runs over every tested phrase; the list keeps phrases the target uses more (Log Ratio
 * above 0) with q below alpha, ordered by G² and then by text, cut to `top`.
 */
export function phraseSignals(
  target: readonly PhrasePaper[],
  control: readonly PhrasePaper[],
  rules: PhraseRules = PHRASE_RULES,
): PhraseResult {
  if (!target.length || !control.length) return { tested: 0, items: [] };
  const order = (papers: readonly PhrasePaper[]) =>
    [...papers].sort((a, b) => a.memberExportId.localeCompare(b.memberExportId));
  const tokenized = (papers: readonly PhrasePaper[]) =>
    order(papers).map((paper) => ({
      paper,
      sentences: paper.sentences.map((sentence) => ({ sentence, tokens: phraseTokenSpans(sentence.text) })),
    }));
  const targetPapers = tokenized(target),
    controlPapers = tokenized(control);
  const minPapers = Math.max(rules.minTargetPapers, Math.ceil(rules.minTargetPrevalence * target.length));
  // Grow n-grams level by level: an n-gram in k papers has both of its (n-1)-grams in at least k papers.
  const survivors: Set<string>[] = [];
  for (let n = 1; n <= rules.maxWords; n++) {
    const previous = survivors[n - 2];
    const counts = new Map<string, number>();
    for (const { sentences } of targetPapers) {
      const seen = new Set<string>();
      for (const { tokens } of sentences) {
        const words = tokens.map((token) => token.text);
        for (let i = 0; i + n <= words.length; i++) {
          if (
            previous &&
            !(
              previous.has(words.slice(i, i + n - 1).join(' ')) &&
              previous.has(words.slice(i + 1, i + n).join(' '))
            )
          )
            continue;
          seen.add(words.slice(i, i + n).join(' '));
        }
      }
      for (const gram of seen) counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    const kept = new Set([...counts].filter(([, count]) => count >= minPapers).map(([gram]) => gram));
    survivors.push(kept);
    if (!kept.size) break;
  }
  const documentFrequency = (papers: typeof targetPapers) => {
    const counts = new Map<string, number>();
    for (const { sentences } of papers) {
      const seen = new Set<string>();
      for (const { tokens } of sentences) {
        const words = tokens.map((token) => token.text);
        survivors.forEach((kept, index) => {
          for (const gram of grams(words, index + 1)) if (kept.has(gram)) seen.add(gram);
        });
      }
      for (const gram of seen) counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };
  const inTarget = documentFrequency(targetPapers),
    inControl = documentFrequency(controlPapers);
  const tested = survivors.flatMap((kept) => [...kept]).sort();
  const scored = tested.map((text) => {
    const a = inTarget.get(text) ?? 0,
      b = inControl.get(text) ?? 0;
    return { text, a, b, ...keyness(a, target.length, b, control.length) };
  });
  const q = benjaminiHochberg(scored.map((item) => item.pValue));
  const items = scored
    .map((item, index) => ({ ...item, qValue: q[index] ?? 1 }))
    .filter((item) => item.logRatio > 0 && item.qValue < rules.alpha)
    .sort((x, y) => y.g2 - x.g2 || x.text.localeCompare(y.text))
    .slice(0, rules.top)
    .map((item): PhraseSignal => {
      const words = item.text.split(' ');
      const evidence: PhraseEvidence[] = [];
      for (const { paper, sentences } of targetPapers) {
        if (evidence.length >= rules.maxEvidence) break;
        for (const { sentence, tokens } of sentences) {
          const at = grams(
            tokens.map((token) => token.text),
            words.length,
          ).indexOf(item.text);
          if (at < 0) continue;
          evidence.push({
            memberExportId: paper.memberExportId,
            sentenceKey: sentence.key,
            excerpt: excerptOf(sentence.text, tokens, at, words.length, rules.maxExcerptChars),
          });
          break;
        }
      }
      return {
        phraseId: `phrase.${words.length}.${fnv(item.text)}`,
        text: item.text,
        words: words.length,
        targetPapers: item.a,
        controlPapers: item.b,
        targetPrevalence: item.a / target.length,
        controlPrevalence: item.b / control.length,
        g2: item.g2,
        logRatio: item.logRatio,
        pValue: item.pValue,
        qValue: item.qValue,
        evidence,
      };
    });
  return { tested: tested.length, items };
}
