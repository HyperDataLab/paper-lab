import { describe, expect, it } from 'vitest';
import { CorpusProfileV2Schema } from '../schemas/corpusProfileV2';
import { evidenceLevelDistribution, type EvidenceLevel } from '../argument/evidenceLevels';
import { exampleProfileInputs } from './contract';
import { exampleCorpusProfileV2 } from './contractV2';
import { bodySentences } from './measure';
import type { PaperSyntax } from './measureV2';
import { buildCorpusProfile } from './profile';
import { buildCorpusProfileV2 } from './profileV2';
import { FEATURE_REGISTRY_V2 } from './registryV2';
import { benjaminiHochberg } from './stats';

const now = new Date('2026-11-18T00:00:00.000Z');

describe('P2 corpus profile v2', () => {
  it('P2 keeps the v1 profile unchanged as the core family and adds the P2 features', async () => {
    const v1 = await buildCorpusProfile({ ...exampleProfileInputs(), seed: 42, now });
    const v2 = await buildCorpusProfileV2({ ...exampleProfileInputs(), seed: 42, now });
    expect(CorpusProfileV2Schema.parse(v2)).toEqual(v2);
    expect(v2.registry.version).toBe(2);
    expect(v2.features.map((f) => f.featureId)).toEqual(FEATURE_REGISTRY_V2.features.map((f) => f.id));
    for (const feature of v1.features) {
      const row = v2.features.find((f) => f.featureId === feature.featureId);
      expect(row).toMatchObject({ ...feature, fdrFamily: 'core' });
    }
    expect(v2.phrases).toEqual(v1.phrases);
    expect(v2.distinctiveFeatureIds).toEqual(expect.arrayContaining(v1.distinctiveFeatureIds));
    // The synthetic journal introductions are longer: per-section paragraph length is distinctive in its family.
    const length = v2.features.find((f) => f.featureId === 'section.INTRODUCTION.paragraph_length');
    expect(length).toMatchObject({
      fdrFamily: 'paragraphs',
      granularity: 'section',
      extractor: 'deterministic',
    });
    expect(length?.comparison?.effectSize).toBeGreaterThan(0.2);
    expect(v2.distinctiveFeatureIds).toContain('section.INTRODUCTION.paragraph_length');
    // q values are Benjamini–Hochberg within each family, not over the whole registry.
    for (const family of ['structure', 'paragraphs', 'style']) {
      const tested = v2.features.filter((f) => f.fdrFamily === family && f.comparison);
      expect(tested.length).toBeGreaterThan(0);
      const q = benjaminiHochberg(tested.map((f) => f.comparison?.pValue ?? null));
      expect(tested.map((f) => f.comparison?.qValue)).toEqual(q);
    }
    // Absent roles have no values; presence is 0 for every paper.
    const discussion = v2.features.find((f) => f.featureId === 'section.DISCUSSION.paragraph_count');
    expect(discussion?.target.n).toBe(0);
    expect(v2.features.find((f) => f.featureId === 'section.DISCUSSION.presence')?.target.mean).toBe(0);
    // No argument runs: machine-label features have no values, an llm extractor and a machine share block.
    expect(v2.features.find((f) => f.featureId === 'argument.with_data')).toMatchObject({
      extractor: 'llm',
      comparison: null,
      machineShare: { target: null, control: null },
      fdrFamily: 'reasoning',
    });
    // A signature profile below the minimums is exploratory, like v1.
    expect(v2.scope).toBe('signature');
    expect(v2.interpretationStatus).toBe('exploratory');
    expect(v2.features.every((f) => f.status === 'exploratory')).toBe(true);
    expect(v2.evidenceLevel).toBeUndefined();
    expect(v2.warnings.join(' ')).toMatch(/keywords block is empty/);
    // No parser: passive and tense have no values, and the profile says so with the count.
    expect(v2.features.find((f) => f.featureId === 'section.INTRODUCTION.passive')).toMatchObject({
      extractor: 'tool',
      fdrFamily: 'style',
      comparison: null,
      machineShare: null,
      target: { n: 0 },
    });
    expect(v2.warnings).toContain(
      'syntax_unavailable: 12 of 12 profiled papers have no grammar parse, so their passive voice and tense values are null (no parser configured).',
    );
    expect(v2.warnings.join(' ')).toMatch(/evidence_level_unavailable: no evidence levels were given/);
  });
  it('P6 passive and tense from a parse map; unparsed papers are counted, never filled', async () => {
    const inputs = exampleProfileInputs();
    const syntax = new Map<string, PaperSyntax>();
    const members = [...inputs.target.members, ...inputs.control.members];
    for (const [i, member] of members.entries()) {
      const paper = inputs.papers.get(member.memberId);
      if (!paper || i === 0) continue;
      const journal = i < inputs.target.members.length;
      syntax.set(
        member.memberId,
        new Map(
          bodySentences(paper.model).map((s) => [
            s.key,
            { voice: journal ? 'passive' : 'active', tense: journal ? 'past' : 'present' },
          ]),
        ),
      );
    }
    const v2 = await buildCorpusProfileV2({
      ...inputs,
      syntax: { papers: syntax, parser: 'fake-1' },
      seed: 42,
      now,
    });
    const passive = v2.features.find((f) => f.featureId === 'section.INTRODUCTION.passive');
    // Member 0 (a profiled target paper) has no parse, so 5 target values.
    expect(passive?.target).toMatchObject({ n: 5, mean: 1 });
    expect(passive?.control).toMatchObject({ n: 6, mean: 0 });
    expect(v2.features.find((f) => f.featureId === 'section.INTRODUCTION.tense.present')?.control.mean).toBe(
      1,
    );
    expect(v2.warnings.join(' ')).toMatch(/syntax_unavailable: 1 of 12 profiled papers/);
    expect(v2.methodNotes.join(' ')).toMatch(/Parser: fake-1; 11 of 12 profiled papers parsed/);
  });
  it('P7 passes evidence-level shares through, and omits the block when one side has no graded claim', async () => {
    const graded = (...levels: EvidenceLevel[]) =>
      evidenceLevelDistribution([
        {
          arguments: [
            ...levels.map((evidenceLevel) => ({ importance: 'main' as const, evidenceLevel })),
            { importance: 'main' as const, evidenceLevel: null },
          ],
        },
      ]);
    const v2 = await buildCorpusProfileV2({
      ...exampleProfileInputs(),
      evidenceLevel: { target: graded('E3', 'E3', 'E4', 'E1'), control: graded('E2', 'E1') },
      seed: 42,
      now,
    });
    expect(v2.evidenceLevel).toEqual({
      target: { E0: 0, E1: 0.25, E2: 0, E3: 0.5, E4: 0.25, E5: 0 },
      control: { E0: 0, E1: 0.5, E2: 0.5, E3: 0, E4: 0, E5: 0 },
    });
    expect(v2.warnings.join(' ')).not.toMatch(/evidence_level_unavailable/);
    expect(v2.methodNotes.join(' ')).toMatch(
      /Graded main claims 4 target \/ 2 control; without a level 1 \/ 1/,
    );
    const oneSided = await buildCorpusProfileV2({
      ...exampleProfileInputs(),
      evidenceLevel: { target: graded('E3'), control: graded() },
      seed: 42,
      now,
    });
    expect(oneSided.evidenceLevel).toBeUndefined();
    expect(oneSided.warnings.join(' ')).toMatch(
      /evidence_level_unavailable: no graded main claim in the control papers/,
    );
  });
  it('P2 reports headings and section sequences with document share', async () => {
    const inputs = exampleProfileInputs();
    const first = inputs.target.members[0];
    const paper = first && inputs.papers.get(first.memberId);
    if (!paper) throw new Error('missing paper');
    const intro = paper.model.document.sections.find((s) => s.role === 'introduction');
    if (intro) intro.title = '1. INTRODUCTION';
    const v2 = await buildCorpusProfileV2({ ...inputs, seed: 1, now });
    expect(v2.headings.map((h) => h.role)).toEqual(['INTRODUCTION', 'METHODS', 'RESULTS']);
    expect(v2.headings[0]?.items).toEqual([{ heading: 'Introduction', documentShare: 1 }]);
    expect(v2.sectionSequences).toEqual([
      { roles: ['INTRODUCTION', 'METHODS', 'RESULTS'], documentShare: 1 },
    ]);
  });
  it('P2 scope admired is always exploratory and records the sample', async () => {
    const v2 = await exampleCorpusProfileV2();
    expect(v2.scope).toBe('admired');
    expect(v2.sample).toMatchObject({ n: 7, rankingRule: expect.stringContaining('cited_by_count') });
    expect(v2.sample.yearBuckets).toEqual([
      { from: 2024, to: 2024, papers: 4 },
      { from: 2025, to: 2025, papers: 3 },
    ]);
    expect(v2.interpretationStatus).toBe('exploratory');
    expect(v2.interpretationReason).toMatch(/always exploratory/);
    expect(v2.holdoutVerified).toBe(false);
    expect(v2.features.every((f) => f.status === 'exploratory')).toBe(true);
  });
  it('P2 admired stays exploratory even above the section 4 minimums', async () => {
    const inputs = exampleProfileInputs(150);
    for (const corpus of [inputs.target, inputs.control]) {
      const version = corpus.protocol.at(-1);
      if (version && 'samplingRule' in version.body)
        version.body = {
          ...version.body,
          sampling: { scope: 'admired', n: 150, rankedBy: 'cited_by_count within publication year' },
        };
    }
    const v2 = await buildCorpusProfileV2({ ...inputs, seed: 3, now });
    expect(v2.interpretationStatus).toBe('exploratory');
    expect(v2.features.every((f) => f.status === 'exploratory')).toBe(true);
  }, 120_000);
  it('P2 compares keywords with G² and Log Ratio and reports the subfield mix', async () => {
    const v2 = await exampleCorpusProfileV2();
    // Target: all 6 profiled papers carry both keywords; control: 2 of 6 carry the scheme keyword.
    expect(v2.keywords.map((k) => k.id)).toEqual(['keywords/synthetic-scheme', 'keywords/toy-task']);
    const scheme = v2.keywords[0];
    expect(scheme).toMatchObject({ name: 'Synthetic scheme', targetShare: 1, controlShare: 2 / 6 });
    expect(scheme?.g2).toBeGreaterThan(3.84);
    expect(scheme?.logRatio).toBeGreaterThan(0);
    expect(v2.keywords[1]).toMatchObject({ targetShare: 1, controlShare: 1, g2: 0, logRatio: 0 });
    // Held-out members are not profiled, so their keywords and subfields are left out.
    expect(v2.classification.subfields).toEqual([
      { id: 'subfields/1702', name: 'Artificial Intelligence', targetShare: 4 / 6, controlShare: 4 / 6 },
      { id: 'subfields/1710', name: null, targetShare: 2 / 6, controlShare: 2 / 6 },
    ]);
  });
});
