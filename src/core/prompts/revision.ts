import { z } from 'zod';
import type { Analysis } from '../schemas/analysis';
import type { Issue } from '../schemas/issue';
import { sliceCp } from '../text/offsets';

export const RevisionOutputSchema = z.object({
  revisedText: z.string(),
  changes: z.array(
    z.object({ issueIds: z.array(z.string()), before: z.string(), after: z.string(), rationale: z.string() }),
  ),
  needsEvidence: z.array(z.object({ issueId: z.string(), note: z.string() })),
});
export type RevisionOutput = z.infer<typeof RevisionOutputSchema>;
export type RevisionConstraints = {
  preserveClaims: true;
  preserveHedging: true;
  noNewFacts: true;
  preserveTerms: string[];
};

export function buildRevisionPrompt(
  analysis: Analysis,
  selectedIssues: Issue[],
  constraints: RevisionConstraints,
) {
  return {
    system:
      'Revise only to address the selected issues. Preserve data, references, numbers, units, negation, hedging, modality and claim strength. Never add evidence, facts or values: put an issue in needsEvidence if evidence is missing. Remove or soften an unsupported intensifier or ask for evidence, never invent an effect size. Keep preserveTerms verbatim. Return the full revised paragraph. For each change quote before and after text, never offsets, and write rationale in Vietnamese.',
    user: `Paragraph: ${analysis.text.sourceText}\nConstraints: ${JSON.stringify(constraints)}\nSelected issues:\n${selectedIssues.map((issue) => `${issue.id} | ${issue.type} | ${issue.spans.map((span) => JSON.stringify(sliceCp(analysis.text.sourceText, span.start, span.end))).join(' / ')} | ${issue.why} | ${issue.suggestedFix ?? ''}`).join('\n')}`,
  };
}
