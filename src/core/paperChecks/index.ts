import type { Paper, PaperCheckReport } from '../schemas';
import { validateLocations } from './common';
import { citationsReferences, figuresTables } from './references';
import { acronyms } from './acronyms';
import { numbersConsistency, claimStrengthDrift, unsupportedClaims } from './language';

export { validateLocations } from './common';
export { IGNORED_ACRONYMS } from './acronyms';
export function runPaperChecks(paper: Paper, now = new Date()): PaperCheckReport {
  let droppedLocations = 0;
  const checks = [
    citationsReferences(paper),
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
