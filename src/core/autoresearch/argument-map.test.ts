import { expect, it } from 'vitest';
import { argumentDirections, buildArgumentMap, s9Schema } from './argument-map';
import { argumentJudgments, outputs } from './fixtures';
import { passStage } from './validation';

const extra: Parameters<typeof buildArgumentMap>[1] = {
  ...argumentJudgments(['h-agree', 'h-repeat']),
  entities: [
    { id: 'assumption:memory', type: 'assumption', text: 'Reviewers remember their examples.' },
    { id: 'contribution:protocol', type: 'contribution', text: 'An evaluation protocol for agreement.' },
  ],
  relations: [
    {
      from: 'claim:claim-a',
      to: 'gap:g-agree',
      relation: 'substantiates',
      status: 'derived',
      rationale: 'Motivates calibration.',
    },
    {
      from: 'hypothesis:h-agree',
      to: 'assumption:memory',
      relation: 'depends_on',
      status: 'unreviewed',
      rationale: 'Carryover could affect results.',
    },
    {
      from: 'hypothesis:h-agree',
      to: 'contribution:protocol',
      relation: 'informs',
      status: 'derived',
      rationale: 'Tests a procedure.',
    },
    {
      from: 'contribution:protocol',
      to: 'gap:g-agree',
      relation: 'targets',
      status: 'derived',
      rationale: 'Provides a way to test calibration.',
    },
  ],
};

it('S9 validates every directed semantic relation and the fixed vocabularies', () => {
  const map = buildArgumentMap(outputs, extra);
  expect(s9Schema.safeParse(map).success).toBe(true);
  expect(passStage('S9', map, outputs)).toBeNull();
  const contradiction = buildArgumentMap(outputs, {
    ...extra,
    evidence_links: extra.evidence_links.map((item) => ({ ...item, relation: 'contradicts' })),
  });
  expect(passStage('S9', contradiction, outputs)).toBeNull();
  expect(
    new Set([...map.graph.relations, ...contradiction.graph.relations].map(({ relation }) => relation)),
  ).toEqual(new Set(Object.keys(argumentDirections)));
  for (const relation of map.graph.relations) {
    const reversed = { ...relation, from: relation.to, to: relation.from };
    expect(
      passStage(
        'S9',
        {
          ...map,
          graph: {
            ...map.graph,
            relations: map.graph.relations.map((edge) => (edge === relation ? reversed : edge)),
          },
        },
        outputs,
      ),
    ).toBe('INVALID_ARGUMENT_MAP');
  }
  for (const patch of [{ relation: 'mentions' }, { status: 'confirmed' }])
    expect(
      s9Schema.safeParse({
        ...map,
        graph: { ...map.graph, relations: [{ ...map.graph.relations[0], ...patch }] },
      }).success,
    ).toBe(false);
});

it('S9 requires a rationale per accepted hypothesis and exactly one in-cluster judgment per clustered card', () => {
  const map = outputs.S9;
  const [link] = map.evidence_links;
  if (!link) throw new Error('Missing evidence link fixture');
  const unrelated = buildArgumentMap(outputs, {
    ...extra,
    evidence_links: [{ ...link, relation: 'unrelated' }],
  });
  expect(passStage('S9', unrelated, outputs)).toBeNull();
  expect(unrelated.graph.relations.some(({ from }) => from === 'evidence:card-a')).toBe(false);
  const prior: typeof outputs = {
    ...outputs,
    S7: {
      ...outputs.S7,
      clusters: [
        ...outputs.S7.clusters,
        { label: 'Other topic', summary: 'Separate studies', cardIds: ['card-b'] },
      ],
    },
  };
  for (const value of [
    { ...map, evidence_links: [] },
    { ...map, evidence_links: [link, link] },
    { ...map, rationales: map.rationales.slice(0, 1) },
    {
      ...map,
      evidence_links: [link, { ...link, cardId: 'card-b' }],
    },
  ]) {
    expect(
      passStage(
        'S9',
        value,
        value.evidence_links.length === 2 && value.evidence_links[1]?.cardId === 'card-b' ? prior : outputs,
      ),
    ).toBe('INVALID_ARGUMENT_MAP');
  }
});
