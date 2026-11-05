import type { RawSentenceSyntax } from '../prompts/sentenceSyntax';
import type { Sentence, TextAnalysis } from '../schemas/text';
import type { SentenceSyntax, TokenRange } from './syntaxTypes';

type RangeKey = 'subject' | 'mainVerb' | 'topic' | 'action' | 'stress';
const RANGE_KEYS: RangeKey[] = ['subject', 'mainVerb', 'topic', 'action', 'stress'];

export function emptySyntax(sentenceId: string, reason: string): SentenceSyntax {
  return {
    sentenceId,
    subject: null,
    subjectHead: null,
    mainVerb: null,
    mainVerbHead: null,
    topic: null,
    action: null,
    stress: null,
    voice: null,
    clauseCount: null,
    maxClauseDepth: null,
    confidence: null,
    unresolved: [reason],
  };
}

function checkRange(range: TokenRange | null, sentence: Sentence): string | null {
  if (range === null) return null;
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) return 'not an integer range';
  if (range.start >= range.end) return 'empty range';
  if (range.start < sentence.tokenStart || range.end > sentence.tokenEnd) return 'out of sentence range';
  return null;
}

function checkCount(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Turns one model candidate into validated syntax. Anything that cannot be trusted becomes null + reason. */
export function validateSentenceSyntax(raw: RawSentenceSyntax, sentence: Sentence): SentenceSyntax {
  const unresolved: string[] = [];
  const ranges = {} as Record<RangeKey, TokenRange | null>;
  for (const key of RANGE_KEYS) {
    const problem = checkRange(raw[key], sentence);
    if (problem) unresolved.push(`${key}: ${problem}`);
    ranges[key] = problem ? null : raw[key];
  }
  const head = (name: 'subjectHead' | 'mainVerbHead', range: TokenRange | null): number | null => {
    const value = raw[name];
    if (value === null) return null;
    if (range === null || value < range.start || value >= range.end) {
      unresolved.push(`${name}: outside its range`);
      return null;
    }
    return value;
  };
  let confidence = raw.confidence;
  if (confidence !== null && !(confidence >= 0 && confidence <= 1)) {
    unresolved.push('confidence: outside 0..1');
    confidence = null;
  }
  return {
    sentenceId: sentence.id,
    ...ranges,
    subjectHead: head('subjectHead', ranges.subject),
    mainVerbHead: head('mainVerbHead', ranges.mainVerb),
    voice: raw.voice,
    clauseCount: checkCount(raw.clauseCount),
    maxClauseDepth: checkCount(raw.maxClauseDepth),
    confidence,
    unresolved,
  };
}

/** One entry per sentence, in text order. Unknown ids are dropped; the first entry for an id wins. */
export function validateSyntaxOutput(raw: RawSentenceSyntax[], text: TextAnalysis): SentenceSyntax[] {
  const byId = new Map<string, RawSentenceSyntax>();
  for (const entry of raw) if (!byId.has(entry.sentenceId)) byId.set(entry.sentenceId, entry);
  return text.sentences.map((sentence) => {
    const entry = byId.get(sentence.id);
    return entry ? validateSentenceSyntax(entry, sentence) : emptySyntax(sentence.id, 'no model output');
  });
}
