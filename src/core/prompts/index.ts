export const PROMPT_VERSIONS = {
  connectionTest: 'conn-test-1',
  sentenceSyntax: 'sent-syntax-1',
  candidateJudge: 'cand-judge-1',
  paragraphStructure: 'para-struct-2',
} as const;
export const CONNECTION_TEST_SYSTEM = 'You are a connection test. Return the requested JSON object.';
export const CONNECTION_TEST_USER =
  'This synthetic sentence tests the connection. Return ok as true and model as your model name.';
export * from './sentenceSyntax';
export * from './candidateJudge';
export * from './paragraphStructure';
