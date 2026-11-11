import { normalizeDoi } from '@/core/library/doi';
import { paperDoi } from '@/core/scholarlyContext';
import type { Paper, PaperContextRecord } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';

export async function lookupPaperMetadata(
  paper: Paper,
  context: PaperContextRecord | undefined,
  save: (record: PaperContextRecord) => Promise<PaperContextRecord>,
) {
  const doi = normalizeDoi(context?.paperDoi ?? paperDoi(paper) ?? '');
  if (context?.metadata || !doi) return context;
  const metadata = await createScholarClient({}).paperMetadata(doi);
  if (!metadata) return context;
  return save({
    schemaVersion: 1,
    paperId: paper.id,
    checkedAt: context?.checkedAt ?? metadata.fetchedAt,
    paperDoi: doi,
    checked: context?.checked ?? 0,
    found: context?.found ?? 0,
    retracted: context?.retracted ?? [],
    retractionChecked: context?.retractionChecked ?? false,
    metadata,
  });
}
