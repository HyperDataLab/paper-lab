import type { PaperFinding } from '@/core/paperFindings';
import { labels as issueLabels } from '@/modules/evaluate';

/** The line a reader sees for a finding: sentence-level writing issues carry a type code, the rest their own words. */
export const findingTitle = (finding: PaperFinding) =>
  (finding.code && issueLabels[finding.code as keyof typeof issueLabels]) || finding.title;
