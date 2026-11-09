export const PROMPT_VERSIONS = {
  connectionTest: 'conn-test-1',
  sentenceSyntax: 'sent-syntax-1',
  candidateJudge: 'cand-judge-1',
  paragraphStructure: 'para-struct-2',
  scoring: 'score-2',
  revision: 'revise-1',
  generation: 'gen-2',
  sentenceSyntaxPaper: 'sent-syntax-paper-1',
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
