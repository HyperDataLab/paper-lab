import { newCorpus } from '@/core/corpus';

export const ESWA_SEED = 'paperlab-eswa-2026';
export function createEswaPair(targetId: string, controlId: string, at: string) {
  const common = {
    years: [2020, 2021, 2022, 2023, 2024, 2025],
    articleTypes: ['article'],
    versionOfRecordOnly: true,
    seed: ESWA_SEED,
    strata: ['two-year'],
    capPerIssue: 5,
    exclusions: ['retracted', 'editorial', 'errata', 'correction', 'missing DOI'],
  };
  const target = newCorpus({
    id: targetId,
    kind: 'journal',
    title: 'ESWA',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: {
          ...common,
          samplingRule: '150; minimum 20 per two-year bucket; 20% held out',
          venues: [{ name: 'Expert Systems with Applications', issn: [], openalexSourceId: 'S13144211' }],
        },
      },
    ],
  });
  const control = newCorpus({
    id: controlId,
    kind: 'control',
    title: 'ESWA đối chứng',
    createdAt: at,
    protocol: [
      {
        version: 1,
        createdAt: at,
        body: {
          ...common,
          samplingRule: `match:${targetId}`,
          venues: [
            { name: 'Knowledge-Based Systems', issn: [], openalexSourceId: 'S10169007' },
            {
              name: 'Engineering Applications of Artificial Intelligence',
              issn: [],
              openalexSourceId: 'S900972176',
            },
            { name: 'Neurocomputing', issn: [], openalexSourceId: 'S45693802' },
          ],
        },
      },
    ],
  });
  return [target, control];
}
