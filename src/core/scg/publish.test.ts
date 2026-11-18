/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examplePaperModel } from '../paperModel/contract';
import {
  exampleScgPaper,
  exampleScgRun,
  SCG_PAPER_EXAMPLE_FILE,
  SCG_PAPER_SCHEMA_FILE,
  SCG_PAPER_SCHEMA_PUBLIC_FILE,
  scgPaperJsonSchema,
} from './contract';
import { projectScgPaper, scgBodyEtag, ScgPaperPublishSchema } from './publish';

const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
const id = `sha256-${'a'.repeat(64)}`;

describe('SCG paper contract', () => {
  it('generates the published schemas and a valid synthetic example without drift', () => {
    expect(read(SCG_PAPER_SCHEMA_FILE)).toEqual(scgPaperJsonSchema());
    expect(read(SCG_PAPER_SCHEMA_PUBLIC_FILE)).toEqual(scgPaperJsonSchema());
    expect(read(SCG_PAPER_EXAMPLE_FILE)).toEqual(exampleScgPaper());
    expect(ScgPaperPublishSchema.parse(read(SCG_PAPER_EXAMPLE_FILE)).contributions).toHaveLength(2);
  });

  it('leaves out rejected contributions, prerequisites, matches and references to rejected items', () => {
    const graph = projectScgPaper(exampleScgRun(), id);
    expect(graph.contributions.map((c) => c.id)).toEqual([
      '00000000-0000-4000-8000-000000000001.c0',
      '00000000-0000-4000-8000-000000000001.c1',
    ]);
    const [first] = graph.contributions;
    expect(first?.review).toBe('accepted');
    expect(first?.prerequisites.map((p) => p.name)).toEqual(['Toy reference method']);
    expect(first?.prerequisites[0]?.matches.map((m) => m.matchType)).toEqual(['strong']);
    expect(first?.prerequisites[0]?.references.map((r) => r.kind)).toEqual(['paper']);
    expect(JSON.stringify(graph)).not.toContain('rejected');
  });

  it('carries no paper text: evidence is sentence keys of the published model', () => {
    const graph = projectScgPaper(exampleScgRun(), id);
    const keys = new Set(examplePaperModel().sentences.map((sentence) => sentence.key));
    const text = examplePaperModel().sentences.map((sentence) => sentence.text);
    for (const contribution of graph.contributions) {
      expect(contribution.sourceSentenceKeys.every((key) => keys.has(key))).toBe(true);
      for (const prerequisite of contribution.prerequisites)
        expect(prerequisite.sourceSentenceKeys.every((key) => keys.has(key))).toBe(true);
    }
    const body = JSON.stringify(graph);
    for (const sentence of text) expect(body).not.toContain(sentence);
    expect(Object.keys(graph)).not.toContain('progress');
    expect(Object.keys(graph)).not.toContain('reviewCarry');
  });

  it('rejects extra fields, rejected states and other schema versions', () => {
    const graph = exampleScgPaper();
    expect(ScgPaperPublishSchema.safeParse({ ...graph, text: 'x' }).success).toBe(false);
    expect(ScgPaperPublishSchema.safeParse({ ...graph, schemaVersion: 2 }).success).toBe(false);
    const rejected = structuredClone(graph);
    (rejected.contributions[0] as { review: string }).review = 'rejected';
    expect(ScgPaperPublishSchema.safeParse(rejected).success).toBe(false);
  });

  it('gives the same graph the same ETag, and a review change a new one', async () => {
    const a = await scgBodyEtag(JSON.stringify(exampleScgPaper()));
    expect(a).toBe(await scgBodyEtag(new TextEncoder().encode(JSON.stringify(exampleScgPaper())).buffer));
    const run = exampleScgRun();
    run.contributions[1]!.review = 'accepted';
    expect(await scgBodyEtag(JSON.stringify(projectScgPaper(run, id)))).not.toBe(a);
  });
});
