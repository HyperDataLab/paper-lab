/** The four things a reader can ask of a paper. Each has one colour, one shape and one letter everywhere. */
export type Criterion = 'claim' | 'evidence' | 'writing' | 'context';
export const CRITERIA: Record<Criterion, { label: string; letter: string }> = {
  claim: { label: 'Luận điểm', letter: 'L' },
  evidence: { label: 'Bằng chứng', letter: 'B' },
  writing: { label: 'Cách viết', letter: 'V' },
  context: { label: 'Bối cảnh', letter: 'C' },
};
