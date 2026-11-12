import { planArguments } from '@/core/argument';
import { PROMPT_VERSIONS } from '@/core/prompts';
import { defaultRhetoricSections } from '@/core/rhetoric';
import type { Paper, PaperInsightsRecord, StanceRecord } from '@/core/schemas';
import { defaultStanceSections, planStance } from '@/core/stance';
import { estimateRhetoric } from '@/shared/llm/llmRhetoric';

export type LabelScheme = 'rhetoric' | 'stance' | 'arguments';

export const LABEL_VERSIONS: Record<LabelScheme, string> = {
  rhetoric: `${PROMPT_VERSIONS.rhetoric}+${PROMPT_VERSIONS.abstractAlignment}`,
  stance: PROMPT_VERSIONS.stanceEngagement,
  arguments: PROMPT_VERSIONS.argument,
};

export type LabelPaper = {
  memberId: string;
  paper: Paper;
  insights?: PaperInsightsRecord;
  stance?: StanceRecord;
};

export function labelSections(paper: Paper, scheme: LabelScheme): string[] {
  return scheme === 'stance' ? defaultStanceSections(paper) : defaultRhetoricSections(paper);
}

export function labelCovered(item: LabelPaper, scheme: LabelScheme): boolean {
  const run =
    scheme === 'rhetoric'
      ? item.insights?.rhetoricRuns.at(-1)
      : scheme === 'stance'
        ? item.stance?.runs.at(-1)
        : item.insights?.argumentRuns.at(-1);
  const pending =
    scheme === 'rhetoric'
      ? item.insights?.rhetoricPending
      : scheme === 'stance'
        ? item.stance?.pending
        : item.insights?.argumentPending;
  const expected = labelSections(item.paper, scheme);
  return Boolean(
    run &&
    !pending &&
    run.promptVersion === LABEL_VERSIONS[scheme] &&
    run.failedSectionIds.length === 0 &&
    expected.every((id) => run.sectionIds.includes(id)),
  );
}

export function labelEstimate(item: LabelPaper, scheme: LabelScheme): number {
  if (labelCovered(item, scheme)) return 0;
  const sections = labelSections(item.paper, scheme);
  return scheme === 'rhetoric'
    ? estimateRhetoric(item.paper, sections)
    : scheme === 'stance'
      ? planStance(item.paper, sections).length
      : planArguments(item.paper, sections).length;
}

export function corpusLabelEstimate(items: readonly LabelPaper[], schemes: readonly LabelScheme[]): number {
  return items.reduce(
    (sum, item) => sum + schemes.reduce((n, scheme) => n + labelEstimate(item, scheme), 0),
    0,
  );
}
