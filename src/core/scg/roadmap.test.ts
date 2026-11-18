import { describe, expect, it } from 'vitest';
import type { ScgContribution, ScgPaperRun, ScgPrerequisite, ScgReview } from '../schemas';
import {
  buildScgRoadmap,
  layoutScgChain,
  SCG_CHAIN_LAYOUT,
  SCG_EDGE_WEIGHT,
  type RoadmapMember,
} from './roadmap';

const KEY = 'abcdef0123456789#1';
function prereq(id: string, over: Partial<ScgPrerequisite> = {}): ScgPrerequisite {
  return {
    id,
    name: `Prereq ${id}`,
    description: '',
    explanation: `Builds on ${id}.`,
    coreOrPeripheral: 'core',
    references: [],
    matches: [],
    sourceSentenceKeys: [KEY],
    review: 'candidate',
    ...over,
  };
}
const match = (contributionId: string, review: ScgReview = 'candidate') => ({
  contributionId,
  explanation: '',
  matchType: 'strong' as const,
  review,
});
function contribution(
  id: string,
  prerequisites: ScgPrerequisite[] = [],
  over: Partial<ScgContribution> = {},
) {
  return {
    id,
    name: `Contribution ${id}`,
    description: '',
    types: [{ type: 'models_or_architectures' as const, explanation: '' }],
    sections: [],
    prerequisites,
    sourceSentenceKeys: [KEY],
    review: 'candidate' as ScgReview,
    ...over,
  };
}
function run(
  paperId: string,
  contributions: ScgContribution[],
  over: Partial<ScgPaperRun> = {},
): ScgPaperRun {
  return {
    schemaVersion: 1,
    paperId,
    doi: null,
    s2CorpusId: null,
    s2CheckedAt: null,
    idBase: paperId,
    promptVersion: 'a+b+c',
    promptVersions: { contributions: 'a', prerequisites: 'b', alignment: 'c' },
    requestedModel: 'm',
    model: 'm',
    status: 'complete',
    callsUsed: 0,
    dropped: { quotes: 0, contributions: 0, prerequisites: 0, references: 0, matches: 0 },
    contributions,
    progress: { fingerprint: 'f', contributionBatches: {}, prerequisitesDone: [], alignmentDone: [] },
    reviewCarry: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
const member = (memberId: string, paperIds: string[], year?: number, doi?: string): RoadmapMember => ({
  memberId,
  title: `Paper ${memberId}`,
  identifiers: { paperIds, sha256: [], libraryIds: [], ...(doi ? { doi } : {}) },
  stratum: year === undefined ? {} : { year },
});

describe('buildScgRoadmap', () => {
  it('links matches across papers, contribution refs inside a paper, and coverage by any paper id', () => {
    const runs = [
      run('A', [contribution('A.c0')]),
      run('B', [
        contribution('B.c0', [prereq('B.c0.p0', { matches: [match('A.c0')] })]),
        contribution('B.c1', [
          prereq('B.c1.p0', { references: [{ kind: 'contribution', contributionId: 'B.c0' }] }),
        ]),
      ]),
      run('outside', [contribution('outside.c0')]),
    ];
    const roadmap = buildScgRoadmap(runs, [
      member('m1', ['A'], 2020),
      member('m2', ['old', 'B'], 2022),
      member('m3', ['C']),
    ]);
    expect(roadmap.coverage).toEqual({ members: 3, withRun: 2, complete: 2 });
    expect(roadmap.nodes.has('outside.c0')).toBe(false);
    expect(roadmap.edges.map((e) => [e.from, e.to, e.via])).toEqual([
      ['B.c0', 'A.c0', 'match'],
      ['B.c1', 'B.c0', 'contribution'],
    ]);
    const node = roadmap.nodes.get('B.c0');
    expect(node).toMatchObject({ kind: 'contribution', paperId: 'B', memberId: 'm2', year: 2022 });
    expect(roadmap.edges[0]).toMatchObject({
      paperId: 'B',
      sourceSentenceKeys: [KEY],
      explanation: 'Builds on B.c0.p0.',
    });
  });

  it('groups unmatched references into external nodes by DOI, else title, else prerequisite name', () => {
    const paperRef = (title: string, doi: string | null, year: number | null = null) => ({
      kind: 'paper' as const,
      refId: null,
      title,
      year,
      doi,
      s2CorpusId: null,
    });
    const runs = [
      run('A', [
        contribution('A.c0', [
          prereq('A.c0.p0', { references: [paperRef('BERT', '10.1000/BERT', 2019)] }),
          prereq('A.c0.p1', { references: [paperRef('Some  Tool!', null)] }),
          prereq('A.c0.p2', { name: 'Adam optimizer' }),
          prereq('A.c0.p3', { references: [{ kind: 'tool', url: 'https://example.org/x' }] }),
        ]),
      ]),
      run('B', [
        contribution('B.c0', [
          prereq('B.c0.p0', { references: [paperRef('BERT: pre-training', 'https://doi.org/10.1000/bert')] }),
          // A match in the corpus wins over the reference.
          prereq('B.c0.p1', { references: [paperRef('Foo', '10.1000/foo')], matches: [match('A.c0')] }),
        ]),
      ]),
    ];
    const roadmap = buildScgRoadmap(runs, [member('a', ['A']), member('b', ['B'])]);
    expect(roadmap.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      'A.c0>doi:10.1000/bert',
      'A.c0>title:some tool',
      'A.c0>name:adam optimizer',
      'A.c0>tool:https://example.org/x',
      'B.c0>doi:10.1000/bert',
      'B.c0>A.c0',
    ]);
    expect(roadmap.nodes.get('doi:10.1000/bert')).toMatchObject({
      kind: 'external',
      name: 'BERT',
      year: 2019,
    });
    expect(roadmap.nodes.has('doi:10.1000/foo')).toBe(false);
  });

  it('resolves a reference to a corpus member by S2 corpus id, or by DOI even without a run', () => {
    const ref = (title: string, doi: string | null, s2CorpusId: string | null) => ({
      kind: 'paper' as const,
      refId: null,
      title,
      year: null,
      doi,
      s2CorpusId,
    });
    const runs = [
      run('A', [contribution('A.c0')], { s2CorpusId: '77' }),
      run('B', [
        contribution('B.c0', [
          prereq('B.c0.p0', { references: [ref('A', null, '77')] }),
          prereq('B.c0.p1', { references: [ref('C', 'DOI:10.1000/C', null)] }),
        ]),
      ]),
    ];
    const roadmap = buildScgRoadmap(runs, [
      member('a', ['A']),
      member('b', ['B']),
      member('c', ['C'], undefined, '10.1000/c'),
    ]);
    expect(roadmap.nodes.get('title:a')).toMatchObject({ kind: 'external', memberId: 'a' });
    expect(roadmap.nodes.get('doi:10.1000/c')).toMatchObject({ kind: 'external', memberId: 'c' });
  });

  it('excludes rejected items and keeps candidates as candidates; accepted only filters further', () => {
    const runs = [
      run('A', [
        contribution('A.c0', [], { review: 'accepted' }),
        contribution('A.c1', [], { review: 'rejected' }),
      ]),
      run('B', [
        contribution(
          'B.c0',
          [
            prereq('B.c0.p0', { matches: [match('A.c0', 'accepted')], review: 'accepted' }),
            prereq('B.c0.p1', { matches: [match('A.c1')] }),
            prereq('B.c0.p2', { review: 'rejected', matches: [match('A.c0')] }),
            prereq('B.c0.p3', { matches: [match('A.c0', 'rejected')], name: 'Lost' }),
            // Accepted, but its corpus match is a candidate: hidden in the accepted-only view, not made external.
            prereq('B.c0.p4', {
              review: 'accepted',
              matches: [match('A.c0')],
              references: [
                { kind: 'paper', refId: null, title: 'Alpha', year: null, doi: null, s2CorpusId: null },
              ],
            }),
          ],
          { review: 'accepted' },
        ),
        contribution('B.c1', [prereq('B.c1.p0', { matches: [match('A.c0')] })]),
      ]),
    ];
    const members = [member('a', ['A']), member('b', ['B'])];
    const roadmap = buildScgRoadmap(runs, members);
    expect(roadmap.nodes.has('A.c1')).toBe(false);
    expect(roadmap.edges.map((e) => [e.prerequisiteId, e.to, e.review])).toEqual([
      ['B.c0.p0', 'A.c0', 'accepted'],
      // The rejected match target falls back to the prerequisite's name.
      ['B.c0.p1', 'name:prereq b c0 p1', 'candidate'],
      ['B.c0.p3', 'name:lost', 'candidate'],
      ['B.c0.p4', 'A.c0', 'candidate'],
      ['B.c1.p0', 'A.c0', 'candidate'],
    ]);
    const accepted = buildScgRoadmap(runs, members, { acceptedOnly: true });
    expect(accepted.contributions().map((n) => n.id)).toEqual(['A.c0', 'B.c0']);
    expect(accepted.edges.map((e) => e.prerequisiteId)).toEqual(['B.c0.p0']);
    expect(accepted.nodes.has('title:alpha')).toBe(false);
  });

  it('walks ancestors and descendants to a depth, guarding cycles', () => {
    // c0 → c1 → c2 → c0 (a cycle), and c3 → c0.
    const runs = [
      run('P', [
        contribution('P.c0', [prereq('P.c0.p0', { matches: [match('P.c1')] })]),
        contribution('P.c1', [prereq('P.c1.p0', { matches: [match('P.c2')] })]),
        contribution('P.c2', [prereq('P.c2.p0', { matches: [match('P.c0')] })]),
        contribution('P.c3', [prereq('P.c3.p0', { matches: [match('P.c0')] })]),
      ]),
    ];
    const roadmap = buildScgRoadmap(runs, [member('p', ['P'])]);
    const ids = (chain: ReturnType<typeof roadmap.ancestors>) =>
      chain.nodes.map((item) => `${item.node.id}@${item.depth}`);
    expect(ids(roadmap.ancestors('P.c0', 1))).toEqual(['P.c1@1']);
    expect(ids(roadmap.ancestors('P.c0', 3))).toEqual(['P.c1@1', 'P.c2@2']);
    expect(roadmap.ancestors('P.c0', 3).edges.map((e) => e.prerequisiteId)).toEqual([
      'P.c0.p0',
      'P.c1.p0',
      'P.c2.p0',
    ]);
    expect(ids(roadmap.descendants('P.c0', 1))).toEqual(['P.c2@1', 'P.c3@1']);
    expect(ids(roadmap.descendants('P.c0', 2))).toEqual(['P.c2@1', 'P.c3@1', 'P.c1@2']);
    expect(roadmap.ancestors('P.c3', 0).nodes).toEqual([]);
  });

  it('ranks most built upon by weighted in-degree, one use per dependent at its strongest', () => {
    const runs = [
      run('A', [contribution('A.c0'), contribution('A.c1'), contribution('A.c2')]),
      run('B', [
        contribution('B.c0', [
          // Three prerequisites on A.c1 from one dependent count once, as core.
          prereq('B.c0.p0', { matches: [match('A.c1')], coreOrPeripheral: 'peripheral' }),
          prereq('B.c0.p1', { matches: [match('A.c1')] }),
          prereq('B.c0.p2', { matches: [match('A.c1')] }),
          prereq('B.c0.p3', { matches: [match('A.c0')], coreOrPeripheral: 'peripheral' }),
          prereq('B.c0.p4', { matches: [match('A.c2')], coreOrPeripheral: 'peripheral' }),
        ]),
        contribution('B.c1', [
          prereq('B.c1.p0', { matches: [match('A.c0')], coreOrPeripheral: 'peripheral' }),
          prereq('B.c1.p1', { matches: [match('A.c2')], coreOrPeripheral: 'peripheral' }),
        ]),
      ]),
      run('C', [
        contribution('C.c0', [
          prereq('C.c0.p0', { matches: [match('A.c2')], coreOrPeripheral: 'peripheral' }),
        ]),
      ]),
    ];
    const roadmap = buildScgRoadmap(runs, [member('a', ['A']), member('b', ['B']), member('c', ['C'])]);
    const ranked = roadmap.mostBuiltUpon(10);
    expect(ranked.map((item) => [item.node.id, item.score, item.core, item.peripheral, item.papers])).toEqual(
      [
        ['A.c2', 3 * SCG_EDGE_WEIGHT.peripheral, 0, 3, 2],
        // One core use weighs as much as two peripheral ones; the tie goes to citing papers, then the id.
        ['A.c0', 2 * SCG_EDGE_WEIGHT.peripheral, 0, 2, 1],
        ['A.c1', SCG_EDGE_WEIGHT.core, 1, 0, 1],
      ],
    );
    expect(roadmap.mostBuiltUpon(1).map((item) => item.node.id)).toEqual(['A.c2']);
  });

  it('counts contribution types once per contribution', () => {
    const runs = [
      run('A', [
        contribution('A.c0', [], {
          types: [
            { type: 'resource_dataset', explanation: '' },
            { type: 'resource_dataset', explanation: '' },
          ],
        }),
        contribution('A.c1'),
        contribution('A.c2', [], {
          types: [
            { type: 'resource_dataset', explanation: '' },
            { type: 'models_or_architectures', explanation: '' },
          ],
        }),
      ]),
    ];
    const counts = buildScgRoadmap(runs, [member('a', ['A'])]).typeCounts();
    expect(Object.fromEntries(counts)).toEqual({ resource_dataset: 2, models_or_architectures: 2 });
  });
});

describe('layoutScgChain', () => {
  const runs = [
    run('A', [contribution('A.c0')]),
    run('B', [contribution('B.c0', [prereq('B.c0.p0', { matches: [match('A.c0')] })])]),
    run('C', [contribution('C.c0', [prereq('C.c0.p0', { matches: [match('B.c0')] })])]),
  ];
  it('puts years in columns when every node has one, else steps from the selection', () => {
    const dated = buildScgRoadmap(runs, [
      member('a', ['A'], 2018),
      member('b', ['B'], 2020),
      member('c', ['C'], 2023),
    ]);
    const selected = dated.nodes.get('B.c0')!;
    const layout = layoutScgChain(selected, dated.ancestors('B.c0', 2), dated.descendants('B.c0', 2));
    expect(layout.byYear).toBe(true);
    expect(layout.columns.map((c) => c.label)).toEqual(['2018', '2020', '2023']);
    expect(layout.nodes.find((n) => n.selected)?.node.id).toBe('B.c0');
    expect(layout.edges).toHaveLength(2);
    const undated = buildScgRoadmap(runs, [member('a', ['A']), member('b', ['B'], 2020), member('c', ['C'])]);
    const steps = layoutScgChain(
      undated.nodes.get('B.c0')!,
      undated.ancestors('B.c0', 1),
      undated.descendants('B.c0', 1),
    );
    expect(steps.byYear).toBe(false);
    expect(steps.columns.map((c) => c.label)).toEqual(['Nền 1', 'Đang chọn', 'Kế thừa 1']);
  });

  it('joins two nodes of one column top to bottom, not across the boxes', () => {
    const same = buildScgRoadmap(
      [
        run('A', [
          contribution('A.c0'),
          contribution('A.c1', [
            prereq('A.c1.p0', { references: [{ kind: 'contribution', contributionId: 'A.c0' }] }),
          ]),
        ]),
      ],
      [member('a', ['A'], 2020)],
    );
    const layout = layoutScgChain(
      same.nodes.get('A.c1')!,
      same.ancestors('A.c1', 1),
      same.descendants('A.c1', 1),
    );
    expect(layout.columns).toHaveLength(1);
    const [line] = layout.edges;
    const at = (id: string) => layout.nodes.find((n) => n.node.id === id)!;
    const { nodeWidth, nodeHeight } = SCG_CHAIN_LAYOUT;
    // A.c1 (dependent) is placed first, so the line runs up from A.c0's top to A.c1's bottom.
    expect(line).toMatchObject({
      x1: at('A.c0').x + nodeWidth / 2,
      y1: at('A.c0').y,
      x2: at('A.c1').x + nodeWidth / 2,
      y2: at('A.c1').y + nodeHeight,
    });
  });
});
