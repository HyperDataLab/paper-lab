import { z } from 'zod';
import type { Inputs } from './contracts';
import { evidenceScope, text } from './stage-fields';

const claimSchema = z.strictObject({ id: text, clusterId: text, text });
const evidenceLink = z.strictObject({
  cardId: text,
  claimId: text,
  relation: z.enum(['supports', 'contradicts', 'unrelated']),
  rationale: text,
});
const rationaleSchema = z.strictObject({
  claimId: text,
  hypothesisId: text,
  polarity: z.enum(['supports', 'contradicts']),
  rationale: text,
});
export const argumentDirections = {
  supports: ['evidence', 'claim'],
  contradicts: ['evidence', 'claim'],
  substantiates: ['claim', 'gap'],
  motivates: ['gap', 'question'],
  decomposes_into: ['question', 'question'],
  proposes_answer_to: ['hypothesis', 'question'],
  provides_rationale_for: ['claim', 'hypothesis'],
  depends_on: ['hypothesis', 'assumption'],
  addresses: ['hypothesis', 'gap'],
  informs: ['hypothesis', 'contribution'],
  targets: ['contribution', 'gap'],
} as const;
const entityType = z.enum([
  'gap',
  'question',
  'hypothesis',
  'claim',
  'evidence',
  'assumption',
  'contribution',
]);
const entity = z.strictObject({ id: text, type: entityType, text, evidence_scope: evidenceScope.optional() });
const relation = z.strictObject({
  from: text,
  to: text,
  relation: z.enum(Object.keys(argumentDirections) as (keyof typeof argumentDirections)[]),
  status: z.enum(['stated', 'derived', 'unreviewed']),
  rationale: text,
});
const proposedEntities = entity.omit({ evidence_scope: true }).extend({
  type: z.enum(['assumption', 'contribution']),
});
const proposedRelations = relation.extend({
  relation: z.enum(['substantiates', 'depends_on', 'informs', 'targets']),
});
const judgments = z.strictObject({
  claims: z.array(claimSchema).min(1),
  evidence_links: z.array(evidenceLink),
  rationales: z.array(rationaleSchema),
});
export const argumentOutputSchema = judgments.extend({
  entities: z.array(proposedEntities),
  relations: z.array(proposedRelations),
});
export const s9Schema = judgments.extend({
  graph: z.strictObject({ entities: z.array(entity), relations: z.array(relation) }),
});
type ArgumentOutput = z.infer<typeof argumentOutputSchema>;
type ArgumentMap = z.infer<typeof s9Schema>;
type Entity = z.infer<typeof entity>;
type Relation = z.infer<typeof relation>;
type Judgments = z.infer<typeof judgments>;

export function argumentClusters(prior: Inputs) {
  return (prior.S7?.clusters ?? []).map((cluster, index) => ({ ...cluster, id: `cluster:${index + 1}` }));
}

function argumentBackbone(prior: Inputs, { claims, evidence_links, rationales }: Judgments) {
  const node = (type: Entity['type'], id: string, text: string): Entity => ({
    id: `${type}:${id}`,
    type,
    text,
  });
  const cardIds = new Set(argumentClusters(prior).flatMap((cluster) => cluster.cardIds));
  const link = (
    from: string,
    relation: Relation['relation'],
    to: string,
    rationale: string,
    status: Relation['status'] = 'stated',
  ): Relation => ({ from, to, relation, rationale, status });
  const root = prior.S1?.charter.question;
  const questions = prior.S2?.subQuestions ?? [];
  const gaps = prior.S7?.gaps ?? [];
  const hypotheses = prior.S8?.hypotheses ?? [];
  return {
    entities: [
      ...(root ? [node('question', 'charter', root)] : []),
      ...questions.map((q) => node('question', `sub:${q.id}`, q.question)),
      ...gaps.map((g) => node('gap', g.id, g.text)),
      ...hypotheses.map((h) => node('hypothesis', h.id, h.statement)),
      ...claims.map((c) => node('claim', c.id, c.text)),
      ...(prior.S6?.cards ?? [])
        .filter((card) => cardIds.has(card.id))
        .map((card) => ({
          ...node(
            'evidence',
            card.id,
            card.findings ??
              card.method ??
              card.problem ??
              card.data ??
              card.metrics ??
              card.limitations ??
              '',
          ),
          evidence_scope: card.evidence_scope,
        })),
    ],
    relations: [
      ...questions.map((q) =>
        link('question:charter', 'decomposes_into', `question:sub:${q.id}`, 'Approved decomposition.'),
      ),
      ...gaps.flatMap((g) =>
        g.subQuestionIds.map((q) =>
          link(
            `gap:${g.id}`,
            'motivates',
            `question:sub:${q}`,
            'Question linked to the gap in the synthesis.',
          ),
        ),
      ),
      ...hypotheses.flatMap((h) => [
        link(`hypothesis:${h.id}`, 'addresses', `gap:${h.gapId}`, 'Gap linked to the hypothesis.'),
        ...h.subQuestionIds.map((q) =>
          link(
            `hypothesis:${h.id}`,
            'proposes_answer_to',
            `question:sub:${q}`,
            'Question linked to the hypothesis.',
          ),
        ),
      ]),
      ...evidence_links.flatMap((e) =>
        e.relation === 'unrelated'
          ? []
          : [link(`evidence:${e.cardId}`, e.relation, `claim:${e.claimId}`, e.rationale, 'derived')],
      ),
      ...rationales.map((r) =>
        link(
          `claim:${r.claimId}`,
          'provides_rationale_for',
          `hypothesis:${r.hypothesisId}`,
          r.rationale,
          'derived',
        ),
      ),
    ],
  };
}

export function buildArgumentMap(prior: Inputs, output: ArgumentOutput): ArgumentMap {
  const { entities, relations, ...judgments } = output;
  const backbone = argumentBackbone(prior, judgments);
  return {
    ...judgments,
    graph: {
      entities: [...backbone.entities, ...entities],
      relations: [...backbone.relations, ...relations],
    },
  };
}

const relationKey = ({ from, relation, to }: Relation) => JSON.stringify([from, relation, to]);

export function validArgumentMap(value: ArgumentMap, prior: Inputs) {
  const clusters = argumentClusters(prior);
  const clusterIds = new Set(clusters.map(({ id }) => id));
  const cardClusters = new Map(clusters.flatMap(({ id, cardIds }) => cardIds.map((cardId) => [cardId, id])));
  const claims = new Map(value.claims.map((claim) => [claim.id, claim]));
  const hypotheses = new Set(prior.S8?.hypotheses.map(({ id }) => id));
  const judgedCards = new Set(value.evidence_links.map(({ cardId }) => cardId));
  const justifiedHypotheses = new Set(value.rationales.map(({ hypothesisId }) => hypothesisId));
  if (
    !prior.S1 ||
    !prior.S2 ||
    !hypotheses.size ||
    claims.size !== value.claims.length ||
    !claims.size ||
    value.claims.some((claim) => !clusterIds.has(claim.clusterId)) ||
    judgedCards.size !== cardClusters.size ||
    judgedCards.size !== value.evidence_links.length ||
    value.evidence_links.some(
      ({ cardId, claimId }) =>
        !cardClusters.has(cardId) || claims.get(claimId)?.clusterId !== cardClusters.get(cardId),
    ) ||
    justifiedHypotheses.size !== hypotheses.size ||
    new Set(value.rationales.map(({ claimId, hypothesisId }) => JSON.stringify([claimId, hypothesisId])))
      .size !== value.rationales.length ||
    value.rationales.some(
      ({ claimId, hypothesisId }) => !claims.has(claimId) || !hypotheses.has(hypothesisId),
    )
  )
    return false;
  const backbone = argumentBackbone(prior, value);
  const expectedEntities = new Map(backbone.entities.map((item) => [item.id, item]));
  const expectedRelations = new Map(backbone.relations.map((item) => [relationKey(item), item]));
  const entities = new Map(value.graph.entities.map((item) => [item.id, item]));
  const relations = new Map(value.graph.relations.map((item) => [relationKey(item), item]));
  if (
    entities.size !== value.graph.entities.length ||
    relations.size !== value.graph.relations.length ||
    [...expectedEntities.keys()].some((id) => !entities.has(id)) ||
    [...expectedRelations.keys()].some((id) => !relations.has(id))
  )
    return false;
  return (
    value.graph.entities.every(({ id, type, text, evidence_scope }) => {
      const expected = expectedEntities.get(id);
      return expected
        ? expected.type === type && expected.text === text && expected.evidence_scope === evidence_scope
        : (type === 'assumption' || type === 'contribution') &&
            id.startsWith(`${type}:`) &&
            id.length > type.length + 1 &&
            evidence_scope === undefined &&
            value.graph.relations.some((edge) => edge.from === id || edge.to === id);
    }) &&
    value.graph.relations.every((edge) => {
      const direction = argumentDirections[edge.relation];
      if (
        !direction ||
        edge.from === edge.to ||
        entities.get(edge.from)?.type !== direction[0] ||
        entities.get(edge.to)?.type !== direction[1]
      )
        return false;
      const expected = expectedRelations.get(relationKey(edge));
      if (expected)
        return (
          !['supports', 'contradicts', 'provides_rationale_for'].includes(edge.relation) ||
          edge.rationale === expected.rationale
        );
      return proposedRelations.shape.relation.safeParse(edge.relation).success;
    })
  );
}
