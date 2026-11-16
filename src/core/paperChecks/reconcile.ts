import type { CheckDecision, Finding, Paper, PaperCheckReport, PaperChecksRecord } from '../schemas';

// Match only an unambiguous finding of the same kind, anchored to the same text and section.
function key(paper: Paper, finding: Finding): string {
  const locations = finding.locations.map((location) => {
    const paragraph = paper.paragraphs.find((item) => item.id === location.paragraphId);
    return [
      paragraph?.sectionId ?? '',
      Array.from(paragraph?.text ?? '')
        .slice(location.start, location.end)
        .join('')
        .replace(/\s+/gu, ' ')
        .trim(),
    ];
  });
  const anchors = [...new Set(locations.map((location) => JSON.stringify(location)))].sort();
  return JSON.stringify([finding.checkId, finding.message, anchors]);
}

export function reconcileCheckDecisions(paper: Paper, current: PaperChecksRecord, report: PaperCheckReport) {
  const findings = report.checks.flatMap((check) => check.findings);
  const oldFindings = current.report.checks.flatMap((check) => check.findings);
  const candidates = current.decisions
    .flatMap((decision) => {
      const finding = oldFindings.find((item) => item.id === decision.findingId);
      return finding ? [{ decision, finding }] : [];
    })
    .concat(current.orphanedDecisions ?? []);
  const decisions: CheckDecision[] = [];
  const orphanedDecisions: { decision: CheckDecision; finding: Finding }[] = [];
  for (const entry of candidates) {
    const exact = findings.find((item) => item.id === entry.decision.findingId);
    const matches = findings.filter((item) => key(paper, item) === key(paper, entry.finding));
    const oldMatches = candidates.filter((item) => key(paper, item.finding) === key(paper, entry.finding));
    const match = exact ?? (matches.length === 1 && oldMatches.length === 1 ? matches[0] : undefined);
    if (match) decisions.push({ ...entry.decision, findingId: match.id });
    else orphanedDecisions.push(entry);
  }
  // Older records can already contain decisions whose original report was replaced.
  for (const decision of current.decisions) {
    if (!oldFindings.some((item) => item.id === decision.findingId)) decisions.push(decision);
  }
  return { decisions, orphanedDecisions };
}
