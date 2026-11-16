import type { GrobidResult, Paper, PaperCheckReport } from '../schemas';
import { result, validateLocations } from './common';
import { grobidCitationsReferences } from './grobidCitations';
import { grobidFigureGaps } from './grobidGaps';
import { citationsReferences, figuresTables } from './references';
import { acronyms } from './acronyms';
import { numbersConsistency, claimStrengthDrift, unsupportedClaims } from './language';

export { validateLocations } from './common';
export { IGNORED_ACRONYMS } from './acronyms';
/** With a GROBID result that has a reference list, citations are checked against GROBID's links. */
export function runPaperChecks(
  paper: Paper,
  now = new Date(),
  grobid: GrobidResult | null = null,
): PaperCheckReport {
  const fromGrobid = grobid?.references.length ? grobidCitationsReferences(paper, grobid) : null;
  let droppedLocations = fromGrobid?.suppressed ?? 0;
  const figures = figuresTables(paper);
  const gaps = grobid ? grobidFigureGaps(paper, grobid) : null;
  droppedLocations += gaps?.suppressed ?? 0;
  const figureCheck = gaps?.findings.length
    ? result(
        figures.id,
        figures.label,
        true,
        [...figures.findings, ...gaps.findings],
        figures.falsePositiveNotes[0] ?? '',
      )
    : figures;
  const checks = [
    fromGrobid?.check ?? citationsReferences(paper),
    figureCheck,
    acronyms(paper),
    numbersConsistency(paper),
    claimStrengthDrift(paper),
    unsupportedClaims(paper),
  ].map((check) => {
    const validated = validateLocations(paper, check.findings);
    droppedLocations += validated.dropped;
    return { ...check, findings: validated.findings };
  });
  return { version: 'checks-1', generatedAt: now.toISOString(), checks, droppedLocations };
}
