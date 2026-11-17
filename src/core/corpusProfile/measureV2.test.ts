import { describe, expect, it } from 'vitest';
import { buildPaperModel } from '../paperModel/buildPaperModel';
import { examplePaper, exampleInsights } from '../paperModel/contract';
import type { Argument, PaperInsightsRecord } from '../schemas/paperInsights';
import type { Paper } from '../schemas/paper';
import { measurePaperDetail } from './measure';
import { measurePaperV2Detail, sectionSequence, topSections } from './measureV2';
import { FEATURE_REGISTRY } from './registry';
import { FEATURE_REGISTRY_V2, registryV2Digest } from './registryV2';
import { styleCounts } from './styleLexicon';

const RUN = '00000000-0000-4000-8000-0000000000c1';

/** Synthetic paper: two introduction paragraphs, a combined results-and-discussion section, funding, appendix. */
function paper(): Paper {
  const base = examplePaper();
  const p = (id: string, sectionId: string, text: string) => ({
    id,
    sectionId,
    order: 0,
    text,
    pageStart: 1,
    kind: 'body' as const,
    textHash: 'sha256:0',
  });
  return {
    ...base,
    sections: [
      { id: 'abs', heading: 'Abstract', role: 'abstract', level: 1, pageStart: 1 },
      { id: 'int', heading: '1. Introduction', role: 'introduction', level: 1, pageStart: 1 },
      { id: 'met', heading: '2. Proposed method', role: 'methods', level: 1, pageStart: 2 },
      { id: 'met1', heading: '2.1 Datasets', role: 'methods', level: 2, pageStart: 2 },
      { id: 'rd', heading: '3. Results and discussion', role: 'results', level: 1, pageStart: 3 },
      { id: 'fun', heading: 'Funding', role: 'other', level: 1, pageStart: 4 },
      { id: 'app', heading: 'Appendix A', role: 'appendix', level: 1, pageStart: 5 },
    ],
    paragraphs: [
      p('a1', 'abs', 'We study a toy task.'),
      p('i1', 'int', 'We may clearly improve the toy task.'),
      p('i2', 'int', 'Our scheme seems simple and the US data are toy data.'),
      p('m1', 'met1', 'The method uses toy data only.'),
      p('r1', 'rd', 'The toy method is better than the baseline.'),
      p('f1', 'fun', 'We thank the synthetic funder.'),
      p('x1', 'app', 'Extra toy detail.'),
    ],
  };
}

function span(source: Paper, paragraphId: string) {
  const paragraph = source.paragraphs.find((item) => item.id === paragraphId);
  if (!paragraph) throw new Error(paragraphId);
  return {
    paragraphId,
    sectionId: paragraph.sectionId,
    page: 1,
    start: 0,
    end: 3,
    excerpt: paragraph.text.slice(0, 3),
  };
}

function insights(source: Paper, sectionIds: string[]): PaperInsightsRecord {
  const argument = (id: string, extra: Partial<Argument>): Argument => ({
    id,
    importance: 'main',
    claim: span(source, 'r1'),
    claimType: 'comparative',
    data: [],
    statedWarrant: null,
    inferredWarrant: null,
    backing: [],
    qualifier: null,
    rebuttals: [],
    ...extra,
  });
  return {
    ...exampleInsights(examplePaper()),
    paperId: source.id,
    argumentRuns: [
      {
        id: RUN,
        createdAt: '2026-01-01T00:00:00.000Z',
        model: 'example-model',
        promptVersion: 'example-arguments-1',
        callsUsed: 1,
        sectionIds,
        failedSectionIds: [],
        arguments: [
          argument('arg-1', { data: [span(source, 'm1')], inferredWarrant: 'Toy reading.' }),
          argument('arg-2', { claim: span(source, 'i1'), claimType: 'novelty' }),
          argument('arg-3', { claim: span(source, 'i2'), claimType: 'causal', importance: 'supporting' }),
          argument('arg-4', { claim: span(source, 'i2'), claimType: 'predictive' }),
        ],
        discarded: { claim_not_found: 0, element_not_found: 0, duplicate: 0 },
      },
    ],
    decisions: [
      { run_id: RUN, item_id: 'arg-2', decision: 'confirm', at: '2026-01-01T00:00:00.000Z' },
      { run_id: RUN, item_id: 'arg-4', decision: 'dismiss', at: '2026-01-01T00:00:00.000Z' },
    ],
  };
}

const model = (source: Paper, record?: PaperInsightsRecord) =>
  buildPaperModel({ paper: source, metadata: null, insights: record ?? null, now: new Date(0) });

describe('P2 registry v2', () => {
  it('P2 keeps every v1 feature first and in order, with unique ids and a digest', async () => {
    const ids = FEATURE_REGISTRY_V2.features.map((f) => f.id);
    expect(ids.slice(0, FEATURE_REGISTRY.features.length)).toEqual(
      FEATURE_REGISTRY.features.map((f) => f.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/u.test(id))).toBe(true);
    expect(await registryV2Digest()).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const v1 = FEATURE_REGISTRY_V2.features.slice(0, FEATURE_REGISTRY.features.length);
    expect(v1.every((f) => f.fdrFamily === 'core')).toBe(true);
    const families = new Map<string, number>();
    for (const f of FEATURE_REGISTRY_V2.features)
      families.set(f.fdrFamily, (families.get(f.fdrFamily) ?? 0) + 1);
    expect(Object.fromEntries(families)).toEqual({
      core: 48,
      structure: 12,
      paragraphs: 18,
      style: 27,
      reasoning: 102,
    });
    expect(FEATURE_REGISTRY_V2.features.find((f) => f.id === 'section.METHODS.hedges')).toMatchObject({
      granularity: 'section',
      extractor: 'deterministic',
    });
    expect(FEATURE_REGISTRY_V2.features.find((f) => f.id === 'argument.with_data')).toMatchObject({
      granularity: 'paper',
      extractor: 'llm',
      metricType: 'prevalence',
    });
    // P6 and P7 ids are reserved, never measured.
    const reserved = FEATURE_REGISTRY_V2.reserved.map((r) => r.id);
    expect(reserved).toContain('section.RESULTS.passive');
    expect(reserved).toContain('section.METHODS.tense.past');
    expect(reserved.some((id) => ids.includes(id))).toBe(false);
  });
  it('P2 style word lists count hedges, boosters and first person, not "US" or "I"', () => {
    expect(styleCounts('We may clearly see that I and the US data suggest our view.')).toEqual({
      words: 13,
      hedges: 2,
      boosters: 1,
      first_person: 2,
    });
  });
});

describe('P2 paper measurement v2', () => {
  it('P2 keeps the v1 values unchanged', () => {
    const m = model(paper());
    const { values } = measurePaperV2Detail(m);
    for (const [id, value] of Object.entries(measurePaperDetail(m).values)) expect(values[id]).toBe(value);
    expect(Object.keys(values)).toEqual(FEATURE_REGISTRY_V2.features.map((f) => f.id));
  });
  it('P2 measures structure, paragraphs and style per section role', () => {
    const m = model(paper());
    expect(topSections(m).map((s) => s.id)).toEqual(['abs', 'int', 'met', 'rd', 'app']);
    expect(sectionSequence(m)).toEqual(['INTRODUCTION', 'METHODS', 'RESULTS']);
    const { values } = measurePaperV2Detail(m);
    expect(values['structure.section_count']).toBe(4);
    expect(values['structure.results_discussion_combined']).toBe(1);
    expect(values['structure.other_share']).toBe(0);
    expect(values['section.INTRODUCTION.presence']).toBe(1);
    expect(values['section.DISCUSSION.presence']).toBe(0);
    expect(values['section.INTRODUCTION.paragraph_count']).toBe(2);
    // 7 + 11 words.
    expect(values['section.INTRODUCTION.paragraph_length']).toBe(9);
    expect(values['section.METHODS.paragraph_count']).toBe(1);
    // Absent role: null, not zero, so medians describe papers that have the section.
    expect(values['section.DISCUSSION.paragraph_count']).toBeNull();
    expect(values['section.DISCUSSION.hedges']).toBeNull();
    // Introduction: "may", "seems" / "clearly" / "We", "Our" ("US" excluded) over 18 words.
    expect(values['section.INTRODUCTION.hedges']).toBeCloseTo(2000 / 18);
    expect(values['section.INTRODUCTION.boosters']).toBeCloseTo(1000 / 18);
    expect(values['section.INTRODUCTION.first_person']).toBeCloseTo(2000 / 18);
    // Funding is boilerplate, so its "We" is not counted anywhere.
    expect(values['section.OTHER.presence']).toBe(0);
    // Without an argument run, the reasoning features are null.
    expect(values['argument.with_data']).toBeNull();
    expect(values['section.RESULTS.claim.comparative']).toBeNull();
  });
  it('P2 measures claim types per section and Toulmin elements from a complete argument run', () => {
    const source = paper();
    const record = insights(source, ['abs', 'int', 'met1', 'rd']);
    const { values, labels } = measurePaperV2Detail(model(source, record), record);
    expect(values['section.RESULTS.claim.comparative']).toBe(1);
    expect(values['section.INTRODUCTION.claim.novelty']).toBe(1);
    expect(values['section.INTRODUCTION.claim.causal']).toBe(1);
    // Dismissed arguments do not count.
    expect(values['section.INTRODUCTION.claim.predictive']).toBe(0);
    expect(values['section.METHODS.claim.comparative']).toBe(0);
    expect(values['section.DISCUSSION.claim.comparative']).toBeNull();
    expect(labels['section.INTRODUCTION.claim.novelty']).toEqual({ total: 1, machine: 0 });
    expect(labels['section.RESULTS.claim.comparative']).toEqual({ total: 1, machine: 1 });
    // Main, live arguments: arg-1 (data, inferred warrant) and arg-2 (nothing).
    expect(values['argument.with_data']).toBe(1);
    expect(values['argument.inferred_warrant']).toBe(1);
    expect(values['argument.stated_warrant']).toBe(0);
    expect(values['argument.with_qualifier']).toBe(0);
    expect(values['argument.with_rebuttal']).toBe(0);
    expect(values['argument.unsupported']).toBe(1);
    expect(labels['argument.unsupported']).toEqual({ total: 1, machine: 0 });
  });
  it('P2 leaves reasoning null when the argument run missed a body section', () => {
    const source = paper();
    const record = insights(source, ['abs', 'int', 'rd']);
    const { values } = measurePaperV2Detail(model(source, record), record);
    expect(values['argument.with_data']).toBeNull();
    expect(values['section.RESULTS.claim.comparative']).toBeNull();
  });
});
