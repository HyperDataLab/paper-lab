import type { TextAnalysis } from '../schemas/text';

/** Global S2 token indexes, end exclusive. */
export type TokenRange = { start: number; end: number };

export type Voice = 'active' | 'passive';

/** Validated syntax for one sentence. Ranges come from a provider; offsets are always derived by code. */
export type SentenceSyntax = {
  sentenceId: string;
  subject: TokenRange | null;
  subjectHead: number | null;
  mainVerb: TokenRange | null;
  mainVerbHead: number | null;
  topic: TokenRange | null;
  action: TokenRange | null;
  stress: TokenRange | null;
  voice: Voice | null;
  clauseCount: number | null;
  maxClauseDepth: number | null;
  confidence: number | null;
  unresolved: string[];
};

export type SyntaxResult = {
  provider: string;
  providerVersion: string;
  reproducible: boolean;
  model: string | null;
  sentences: SentenceSyntax[];
};

/** ADR-0004: the LLM provider is the default; a spaCy service can implement the same interface later. */
export interface SyntaxProvider {
  analyze(text: TextAnalysis, signal?: AbortSignal): Promise<SyntaxResult>;
}
