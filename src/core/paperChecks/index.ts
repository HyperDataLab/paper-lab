import type { GrobidResult, Paper, PaperCheckReport } from '../schemas';
import { validateLocations } from './common';
import { grobidCitationsReferences } from './grobidCitations';
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
  const checks = [
    fromGrobid?.check ?? citationsReferences(paper),
    figuresTables(paper),
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
