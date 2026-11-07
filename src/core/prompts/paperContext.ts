import type { Section } from '../schemas/paper';

export type PaperContext = {
  role: Section['role'];
  heading: string;
  previousLast: string | null;
  nextFirst: string | null;
};

const conventions: Partial<Record<Section['role'], string>> = {
  methods: 'Passive voice and procedure verbs such as "were conducted" are normal.',
  results: 'Report values with units and statistics; use little interpretation.',
  abstract: 'Be compact; citations are not expected.',
  introduction: 'Provide context and the gap.',
  discussion: 'Hedging is expected.',
};

export function sectionConvention(role: Section['role']): string {
  return conventions[role] ?? 'None.';
}
