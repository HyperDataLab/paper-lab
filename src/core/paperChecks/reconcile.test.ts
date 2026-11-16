import { expect, it } from 'vitest';
import { grobidPaper, grobidResult } from '@/test/grobidFixtures';
import { runPaperChecks } from './index';
import { reconcileCheckDecisions } from './reconcile';

it('reattaches a reviewed GROBID finding when its generated reference ID changes and keeps unmatched decisions', () => {
  const report = runPaperChecks(grobidPaper, new Date(), grobidResult);
  const findings = report.checks.flatMap((check) => check.findings);
  const unused = findings.find((finding) => finding.id.includes('unused:grobid:'));
  const missing = findings.find((finding) => finding.id.includes('missing:grobid:'));
  if (!unused || !missing) throw new Error('Expected synthetic findings');
  const at = '2026-01-01T00:00:00.000Z';
  const current = {
    schemaVersion: 1 as const,
    paperId: grobidPaper.id,
    report,
    decisions: [
      { findingId: unused.id, status: 'dismissed_by_human' as const, note: 'reviewed', at },
      { findingId: missing.id, status: 'confirmed_by_human' as const, note: '', at },
    ],
  };
  const next = {
    ...report,
    checks: report.checks.map((check) => ({
      ...check,
      findings: check.findings
        .filter((finding) => finding.id !== missing.id)
        .map((finding) => (finding.id === unused.id ? { ...finding, id: 'new-reference-id' } : finding)),
    })),
  };
  const result = reconcileCheckDecisions(grobidPaper, current, next);
  expect(result.decisions).toContainEqual({ ...current.decisions[0], findingId: 'new-reference-id' });
  expect(result.orphanedDecisions).toEqual([{ decision: current.decisions[1], finding: missing }]);
  const restored = reconcileCheckDecisions(grobidPaper, { ...current, report: next, ...result }, report);
  expect(restored.decisions.map((decision) => decision.findingId)).toEqual(
    expect.arrayContaining([unused.id, missing.id]),
  );
  expect(restored.orphanedDecisions).toEqual([]);
});
