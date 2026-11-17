import { describe, expect, it } from 'vitest';
import { buildPaperModel } from '../paperModel/buildPaperModel';
import { examplePaper, exampleInsights, examplePaperModel, exampleStance } from '../paperModel/contract';
import { defaultRhetoricSections } from '../rhetoric';
import { defaultStanceSections } from '../stance';
import { BOILERPLATE_HEADING, bodyBlocks, measurePaper, measurePaperDetail, otherShare } from './measure';
import { FEATURE_REGISTRY, registryDigest } from './registry';

describe('C5a registry and paper measurement', () => {
  it('C5a has stable unique valid feature identifiers and digest', async () => {
    const ids = FEATURE_REGISTRY.features.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/u.test(id))).toBe(true);
    expect(await registryDigest()).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
  it('C5a excludes boilerplate and descendants, and uses only body blocks', () => {
    const model = examplePaperModel();
    model.document.sections.push({
      id: 'fund',
      parentId: null,
      title: 'Funding',
      level: 1,
      role: 'other',
      page: null,
    });
    model.document.sections.push({
      id: 'child',
      parentId: 'fund',
      title: 'Details',
      level: 2,
      role: 'other',
      page: null,
    });
    model.document.blocks.push({
      id: 'funding',
      sectionId: 'child',
      kind: 'body',
      page: null,
      text: 'Funding words.',
      textHash: 'x',
    });
    expect(bodyBlocks(model).some((block) => block.id === 'funding')).toBe(false);
    const measured = measurePaper(model);
    expect(measured['section.ABSTRACT.word_share']).toBeGreaterThan(0);
    expect(measured['paragraph.length']).toBeGreaterThan(0);
    expect(measured['claim.causal']).toBeNull();
    expect(measured['stance.boosters']).toBeNull();
    expect(measured['rhetoric.occupy']).toBeNull();
  });
  it('C5a removes declaration headings as boilerplate', () => {
    for (const heading of [
      'Declaration of competing interest',
      'Declarations of interest:',
      'CRediT authorship contribution statement',
    ])
      expect(BOILERPLATE_HEADING.test(heading), heading).toBe(true);
    expect(BOILERPLATE_HEADING.test('Funding and competition')).toBe(false);
  });
  it('C5a counts label features when the run covers the default labelling sections, appendix included', () => {
    const paper = examplePaper();
    const extra = (id: string, heading: string, role: 'appendix' | 'other') => {
      paper.sections.push({ id, heading, role, level: 1, pageStart: 6 });
      paper.paragraphs.push({
        id: `${id}1`,
        sectionId: id,
        order: 0,
        text: 'Extra synthetic detail for this section.',
        pageStart: 6,
        kind: 'body',
        textHash: 'sha256:0',
      });
    };
    extra('app', 'Appendix A', 'appendix');
    // Not boilerplate by the end-anchored rule, but the labellers skip it by prefix.
    extra('fun', 'Funding sources', 'other');
    const insights = exampleInsights(paper);
    const stance = exampleStance(paper);
    const rhetoricRun = insights.rhetoricRuns[0],
      stanceRun = stance.runs[0];
    if (!rhetoricRun || !stanceRun) throw new Error('missing run');
    rhetoricRun.sectionIds = defaultRhetoricSections(paper);
    stanceRun.sectionIds = defaultStanceSections(paper);
    expect(rhetoricRun.sectionIds).not.toContain('app');
    expect(stanceRun.sectionIds).not.toContain('fun');
    const model = buildPaperModel({ paper, metadata: null, insights, stance, now: new Date(0) });
    const { values, labels } = measurePaperDetail(model, insights, stance);
    expect(values['stance.boosters']).toBeGreaterThan(0);
    expect(values['stance.hedges']).toBe(0);
    expect(values['rhetoric.occupy']).toBe(1);
    // The dismissed limitation does not count; the confirmed occupy label is not a machine label.
    expect(values['rhetoric.limitation']).toBe(0);
    expect(labels['rhetoric.occupy']).toEqual({ total: 1, machine: 0 });
    expect(labels['stance.boosters']).toEqual({ total: 1, machine: 1 });
  });
  it('P1 reports the OTHER share of body words and sections', () => {
    const model = examplePaperModel();
    expect(otherShare(model).words).toBe(0);
    model.document.sections.push({
      id: 'odd',
      parentId: null,
      title: 'Odd notes',
      level: 1,
      role: 'other',
      page: null,
    });
    model.document.blocks.push({
      id: 'odd1',
      sectionId: 'odd',
      kind: 'body',
      page: null,
      text: 'Synthetic words in an unrecognised section.',
      textHash: 'x',
    });
    const share = otherShare(model);
    expect(share.words).toBeGreaterThan(0);
    expect(share.words).toBe(measurePaper(model)['section.OTHER.word_share']);
    const bodySections = new Set(bodyBlocks(model).map((block) => block.sectionId));
    expect(share.sections).toBe(1 / bodySections.size);
    model.document.blocks = [];
    expect(otherShare(model)).toEqual({ words: null, sections: null });
  });
});
