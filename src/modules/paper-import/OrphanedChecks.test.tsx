import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { runPaperChecks } from '@/core/paperChecks';
import { grobidPaper, grobidResult } from '@/test/grobidFixtures';
import { OrphanedChecks } from './OrphanedChecks';

it('lists an unmatched reviewed finding with its evidence and decision', () => {
  const report = runPaperChecks(grobidPaper, new Date(), grobidResult);
  const finding = report.checks
    .flatMap((check) => check.findings)
    .find((item) => item.id.includes('missing:grobid:'));
  if (!finding) throw new Error('Expected synthetic finding');
  render(
    <OrphanedChecks
      record={{
        schemaVersion: 1,
        paperId: grobidPaper.id,
        report,
        decisions: [],
        orphanedDecisions: [
          {
            finding,
            decision: {
              findingId: finding.id,
              status: 'dismissed_by_human',
              note: 'reviewed',
              at: '2026-01-01T00:00:00.000Z',
            },
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/Quyết định chưa ghép lại được/u)).toBeInTheDocument();
  expect(screen.getByText(/\[9\].*Đã bác bỏ.*reviewed/u)).toBeInTheDocument();
});
