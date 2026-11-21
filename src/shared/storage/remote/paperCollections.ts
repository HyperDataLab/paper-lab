import type { CollectionName } from '@/core/storage/collections';

export const PAPER_COLLECTIONS = [
  'papers',
  'paperRuns',
  'paperOverviews',
  'paperChecks',
  'paperReviews',
  'paperProbes',
  'measurements',
  'stance',
  'paperContext',
  'paperInsights',
  'grobid',
  'scgRuns',
  'analyses',
  'revisions',
  'generations',
  'reviewNgrams',
  'paperCheckpointParts',
] as const satisfies readonly CollectionName[];
