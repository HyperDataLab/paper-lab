export const PROMPT_VERSIONS = {
  corpusTopicName: 'corpus-topic-name-2',
  connectionTest: 'conn-test-1',
  sentenceSyntax: 'sent-syntax-1',
  candidateJudge: 'cand-judge-1',
  paragraphStructure: 'para-struct-2',
  scoring: 'score-2',
  revision: 'revise-1',
  generation: 'gen-2',
  sentenceSyntaxPaper: 'sent-syntax-paper-1',
  sentenceSyntaxPaperBatch: 'sent-syntax-paper-batch-1',
  candidateJudgePaper: 'cand-judge-paper-1',
  paragraphStructurePaper: 'para-struct-paper-1',
  scoringPaper: 'score-paper-1',
  paragraphTransition: 'para-flow-1',
  paperReview: 'paper-review-1',
  styleProbe: 'style-probe-1',
  measurementClassify: 'measure-classify-1',
  measurementExtract: 'measure-extract-2',
  measurementLink: 'measure-link-1',
  measurementFindings: 'measure-findings-1',
  stanceEngagement: 'stance-engagement-1',
  rhetoric: 'rhetoric-1',
  abstractAlignment: 'abstract-align-1',
  argument: 'argument-4',
  snapshot: 'snapshot-1',
  digest: 'digest-1',
  contribution: 'contribution-1',
  extraction: 'extraction-1',
  extractionVerify: 'extraction-verify-1',
  searchPlan: 'search-plan-1',
  screening: 'screening-1',
  synthesis: 'synthesis-3',
  planSuggestion: 'plan-suggestion-2',
} as const;
export const CONNECTION_TEST_SYSTEM = 'You are a connection test. Return the requested JSON object.';
export const CONNECTION_TEST_USER =
  'This synthetic sentence tests the connection. Return ok as true and model as your model name.';
export * from './sentenceSyntax';
export * from './candidateJudge';
export * from './paragraphStructure';
export * from './scoring';
export * from './revision';
export * from './generation';
export * from './paperContext';
export * from './paragraphTransition';
export * from './paperReview';
export * from './styleProbe';
export * from './measurement';
export * from './stance';
export * from './rhetoric';
export * from './digest';
export * from './extraction';
export * from './contribution';
