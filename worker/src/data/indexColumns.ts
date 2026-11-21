import type { DocIndexField } from '../../../src/core/storage/collections';

export const INDEX_COLUMN = {
  projectId: 'project_id',
  corpusId: 'corpus_id',
  paperId: 'paper_id',
  refId: 'ref_id',
  doi: 'doi',
  title: 'title',
  kind: 'kind',
  status: 'status',
  sourceSha256: 'source_sha256',
} as const satisfies Record<DocIndexField, string>;
