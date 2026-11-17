import { emptySyntax } from '../analysis/validateSyntax';
import type { SentenceSyntax, TokenRange } from '../analysis/syntaxTypes';
import type { Sentence, TextAnalysis } from '../schemas/text';
import type { ParsedSentence, ParsedToken } from './schema';

const SUBJECT_DEPS = new Set(['nsubj', 'nsubjpass', 'nsubj:pass', 'csubj', 'csubjpass', 'csubj:pass']);
const AUX_DEPS = new Set(['aux', 'auxpass', 'aux:pass', 'cop']);
const SUBORDINATE_DEPS = new Set([
  'ccomp',
  'xcomp',
  'advcl',
  'relcl',
  'acl',
  'acl:relcl',
  'csubj',
  'csubjpass',
  'csubj:pass',
  'parataxis',
]);
const FINITE_TAGS = new Set(['VBD', 'VBZ', 'VBP', 'MD']);

/**
 * spaCy parse → the S2 `SentenceSyntax` contract (ADR-0004). spaCy tokens are re-aligned to S2 tokens by code-point
 * offsets; only subject, main verb, voice and clause counts come from the parse. Topic/action/stress stay null.
 */
export function sentenceSyntaxFromParse(
  parsed: ParsedSentence | undefined,
  sentence: Sentence,
  text: TextAnalysis,
): SentenceSyntax {
  if (!parsed) return emptySyntax(sentence.id, 'no parse');
  const own = text.tokens.filter((t) => t.index >= sentence.tokenStart && t.index < sentence.tokenEnd);
  const aligned = new Map<number, number>();
  for (const token of parsed.tokens) {
    const start = sentence.start + token.start;
    const end = sentence.start + token.end;
    const match = own.find((s2) => s2.start < end && start < s2.end);
    if (match) aligned.set(token.i, match.index);
  }
  const byIndex = new Map(parsed.tokens.map((token) => [token.i, token]));
  const children = (i: number) => parsed.tokens.filter((t) => t.head === i && t.i !== i);
  const subtree = (i: number): number[] => {
    const seen = new Set<number>([i]);
    const queue = [i];
    while (queue.length)
      for (const child of children(queue.pop() as number)) {
        if (!seen.has(child.i)) {
          seen.add(child.i);
          queue.push(child.i);
        }
      }
    return [...seen];
  };
  const range = (indexes: number[]): TokenRange | null => {
    const s2 = indexes.flatMap((i) => (aligned.has(i) ? [aligned.get(i) as number] : []));
    return s2.length ? { start: Math.min(...s2), end: Math.max(...s2) + 1 } : null;
  };
  const unresolved: string[] = [];
  const root = parsed.root === null ? undefined : byIndex.get(parsed.root);
  if (!root) unresolved.push('no main verb');
  const subjectToken = root && children(root.i).find((t) => SUBJECT_DEPS.has(t.dep));
  const subjectIndexes = subjectToken ? subtree(subjectToken.i) : [];
  // Verb group: auxiliaries left of the root, stopping at the subject (so "Were the samples analysed" keeps "analysed").
  let verbStart = root?.i ?? 0;
  if (root)
    for (const aux of children(root.i)
      .filter((t) => AUX_DEPS.has(t.dep) && t.i < root.i)
      .sort((a, b) => b.i - a.i)) {
      if (subjectIndexes.some((i) => i > aux.i && i < verbStart)) break;
      verbStart = aux.i;
    }
  const verbIndexes = root
    ? parsed.tokens.filter((t) => t.i >= verbStart && t.i <= root.i).map((t) => t.i)
    : [];
  const subject = range(subjectIndexes);
  const mainVerb = range(verbIndexes);
  if (subjectToken && !subject) unresolved.push('subject: not aligned to tokens');
  if (root && !mainVerb) unresolved.push('mainVerb: not aligned to tokens');
  const clauses = root ? clauseStats(parsed.tokens, root, byIndex) : { count: null, depth: null };
  return {
    sentenceId: sentence.id,
    subject,
    subjectHead: subject && subjectToken ? (aligned.get(subjectToken.i) ?? null) : null,
    mainVerb,
    mainVerbHead: mainVerb && root ? (aligned.get(root.i) ?? null) : null,
    topic: null,
    action: null,
    stress: null,
    voice: parsed.voice,
    clauseCount: clauses.count,
    maxClauseDepth: clauses.depth,
    confidence: null,
    unresolved,
  };
}

function clauseStats(tokens: ParsedToken[], root: ParsedToken, byIndex: Map<number, ParsedToken>) {
  const finite = (t: ParsedToken) =>
    FINITE_TAGS.has(t.tag) ||
    tokens.some((c) => c.head === t.i && c.i !== t.i && AUX_DEPS.has(c.dep) && FINITE_TAGS.has(c.tag));
  const isClause = (t: ParsedToken) =>
    SUBORDINATE_DEPS.has(t.dep) || (t.dep === 'conj' && (t.pos === 'VERB' || t.pos === 'AUX'));
  // The main clause always counts; other clause heads count when finite.
  const heads = tokens.filter((t) => t.i === root.i || (isClause(t) && finite(t)));
  // Depth = finite subordinate clauses on the path to the root, counting the clause itself; `conj` adds nothing.
  const depth = (t: ParsedToken) => {
    let value = 0;
    let current: ParsedToken | undefined = t;
    for (let guard = 0; current && current.i !== root.i && guard < tokens.length; guard += 1) {
      if (SUBORDINATE_DEPS.has(current.dep) && finite(current)) value += 1;
      current = byIndex.get(current.head);
    }
    return value;
  };
  return { count: heads.length, depth: Math.max(0, ...heads.map(depth)) };
}
