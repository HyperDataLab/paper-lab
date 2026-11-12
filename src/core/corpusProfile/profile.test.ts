import { describe, expect, it } from 'vitest';
import { CorpusProfileSchema } from '../schemas/corpusProfile';
import { exampleProfileInputs } from './contract';
import { buildCorpusProfile, PROFILE_THRESHOLDS } from './profile';
import { FEATURE_REGISTRY, registryDigest } from './registry';

const now = new Date('2026-11-12T00:00:00.000Z');

describe('C5a corpus profile', () => {
  it('C5a profiles build members only and finds the planted differences', async () => {
    const inputs = exampleProfileInputs();
    const profile = await buildCorpusProfile({ ...inputs, seed: 42, now });
    expect(CorpusProfileSchema.parse(profile)).toEqual(profile);
    expect(profile.registry).toEqual({
      id: FEATURE_REGISTRY.id,
      version: FEATURE_REGISTRY.version,
      digest: await registryDigest(),
    });
    expect(profile.target).toMatchObject({
      members: 7,
      heldOut: 1,
      fullText: 7,
      profiled: 6,
      notOnDevice: 0,
      releaseId: 'example-journal-r1',
    });
    // Buckets count full-text members, held-out ones included.
    expect(profile.target.yearBuckets).toEqual([{ from: 2024, to: 2025, papers: 7 }]);
    expect(profile.features.map((f) => f.featureId)).toEqual(FEATURE_REGISTRY.features.map((f) => f.id));
    const intro = profile.features.find((f) => f.featureId === 'section.INTRODUCTION.word_share');
    expect(intro?.comparison).toMatchObject({ effectMetric: 'cohens_d', bootstrapUnit: 'paper' });
    expect(intro?.comparison?.effectSize).toBeGreaterThan(0.2);
    const { ci95Low, ci95High, effectSize } = intro?.comparison ?? { ci95Low: 0, ci95High: 0, effectSize: 0 };
    expect(ci95Low).toBeLessThanOrEqual(effectSize);
    expect(ci95High).toBeGreaterThanOrEqual(effectSize);
    expect(intro?.target.n).toBe(6);
    expect(intro?.coverage).toEqual({
      target: { measured: 6, papers: 6 },
      control: { measured: 6, papers: 6 },
    });
    expect(profile.distinctiveFeatureIds).toContain('section.INTRODUCTION.word_share');
    // No labelling runs: label features have no values and no comparison, and are not distinctive.
    const occupy = profile.features.find((f) => f.featureId === 'rhetoric.occupy');
    expect(occupy).toMatchObject({
      extractor: 'llm',
      comparison: null,
      machineShare: { target: null, control: null },
    });
    expect(occupy?.target).toEqual({ n: 0, mean: null, sd: null, median: null, q1: null, q3: null });
    expect(profile.phrases.items.length).toBeGreaterThan(0);
    expect(
      profile.phrases.items.every(
        (p) => p.targetPapers >= 5 && p.qValue < 0.05 && p.logRatio > 0 && p.evidence.length <= 3,
      ),
    ).toBe(true);
    // Six papers per corpus is far below section 4.
    expect(profile.interpretationStatus).toBe('exploratory');
    expect(profile.interpretationReason).toContain(`fewer than ${PROFILE_THRESHOLDS.minPapersPerCorpus}`);
    expect(profile.holdoutVerified).toBe(false);
    // The same seed gives the same profile.
    expect(await buildCorpusProfile({ ...exampleProfileInputs(), seed: 42, now })).toEqual(profile);
  });
  it('C5a warns about a missing release and missing papers', async () => {
    const { target, control, papers } = exampleProfileInputs();
    const first = target.members[0];
    if (!first) throw new Error('missing member');
    papers.delete(first.memberId);
    const profile = await buildCorpusProfile({
      target,
      control: { ...control, releases: [] },
      papers,
      seed: 1,
      now,
    });
    expect(profile.control.releaseId).toBeNull();
    expect(profile.target).toMatchObject({ profiled: 5, notOnDevice: 1 });
    expect(profile.interpretationReason).toMatch(/1 build papers not on this device/);
    expect(profile.warnings.join(' ')).toMatch(/never released/);
    expect(profile.warnings.join(' ')).toMatch(/1 of 6 full-text build members have no paper/);
  });
  it('C5a never claims support without the held-out test, even above the minimums', async () => {
    // 150 full-text members as the sampling draws them, one in seven held out, 75 per year bucket.
    const profile = await buildCorpusProfile({ ...exampleProfileInputs(150), seed: 3, now });
    expect(profile.target).toMatchObject({ fullText: 150, heldOut: 21, profiled: 129, notOnDevice: 0 });
    expect(profile.target.yearBuckets.every((b) => b.papers >= PROFILE_THRESHOLDS.minPapersPerBucket)).toBe(
      true,
    );
    expect(profile.interpretationStatus).toBe('inconclusive');
    expect(profile.interpretationReason).toMatch(/held-out test \(C5b\) has not run/);
  }, 60_000);
});
