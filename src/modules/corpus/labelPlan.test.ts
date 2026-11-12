import { describe, expect, it } from 'vitest';
import { exampleInsights, examplePaper, exampleStance } from '@/core/paperModel/contract';
import { LABEL_VERSIONS, corpusLabelEstimate, labelCovered, labelEstimate } from './labelPlan';

describe('C4b corpus labelling plan', () => {
  it('sums the planned calls for each member and scheme', () => {
    const paper = examplePaper();
    const members = [
      { memberId: 'one', paper },
      { memberId: 'two', paper: { ...paper, id: 'another' } },
    ];
    const one = members[0];
    if (!one) throw new Error('missing member');
    expect(corpusLabelEstimate(members, ['rhetoric', 'stance', 'arguments'])).toBe(
      2 * (labelEstimate(one, 'rhetoric') + labelEstimate(one, 'stance') + labelEstimate(one, 'arguments')),
    );
    expect(labelEstimate(one, 'stance')).toBeGreaterThan(0);
  });

  it('treats a latest run from another prompt version as not covered', () => {
    const paper = examplePaper();
    const item = { memberId: 'one', paper, insights: exampleInsights(paper), stance: exampleStance(paper) };
    const run = item.stance.runs.at(-1);
    if (!run) throw new Error('missing run');
    run.sectionIds = paper.sections.map((section) => section.id);
    run.failedSectionIds = [];
    run.promptVersion = LABEL_VERSIONS.stance;
    expect(labelCovered(item, 'stance')).toBe(true);
    run.promptVersion = 'older-prompt';
    expect(labelCovered(item, 'stance')).toBe(false);
    expect(labelEstimate(item, 'stance')).toBeGreaterThan(0);
  });
});
