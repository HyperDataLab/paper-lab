import type { Criterion } from '@/core/paperFindings';

export type { Criterion };
/** The four things a reader can ask of a paper. Each has one colour, one shape and one letter everywhere. */
export const CRITERIA: Record<Criterion, { label: string; letter: string }> = {
  claim: { label: 'Claims', letter: 'C' },
  evidence: { label: 'Evidence', letter: 'E' },
  writing: { label: 'Writing', letter: 'W' },
  context: { label: 'Sources', letter: 'S' },
};
