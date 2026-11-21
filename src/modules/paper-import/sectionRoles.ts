import type { Section } from '@/core/schemas';

export const SECTION_ROLE_LABELS: Record<Section['role'], string> = {
  title: 'Title',
  abstract: 'Abstract',
  introduction: 'Introduction',
  methods: 'Methods',
  results: 'Results',
  discussion: 'Discussion',
  conclusion: 'Conclusion',
  related_work: 'Related work',
  references: 'References',
  appendix: 'Appendix',
  other: 'Khác',
};
