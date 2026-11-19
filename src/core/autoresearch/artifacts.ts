import { canonicalDigest } from '../corpus';
import { contracts, STAGES, type Inputs, type Stage, type StageContent } from './contracts';
import type { Artifact, Run, StageState } from './record';

export function currentArtifact(run: Run, stage: Stage) {
  return run.artifacts.findLast((artifact) => artifact.stage === stage && artifact.status !== 'stale');
}

export function contentOf<K extends Stage>(stage: K, artifact: Artifact): StageContent[K] {
  const parse: { [S in Stage]: { parse: (input: unknown) => StageContent[S] } } = contracts;
  return parse[stage].parse(artifact.content);
}

export function selectable(artifact: Artifact | undefined): { id: string; label: string }[] {
  if (!artifact) return [];
  switch (artifact.stage) {
    case 'S5':
      return contentOf('S5', artifact)
        .decisions.filter((d) => d.decision === 'included')
        .map((d) => ({ id: d.id, label: d.reason }));
    case 'S6':
      return contentOf('S6', artifact).cards.map((card) => ({
        id: card.id,
        label: card.findings ?? card.method ?? card.problem ?? card.id,
      }));
    case 'S7':
      return contentOf('S7', artifact).gaps.map((gap) => ({ id: gap.id, label: gap.text }));
    case 'S8':
      return contentOf('S8', artifact).hypotheses.map((h) => ({ id: h.id, label: h.statement }));
    default:
      return [];
  }
}

export function reviewItemIds(artifact: Artifact | undefined): string[] {
  if (!artifact) return [];
  switch (artifact.stage) {
    case 'S2':
      return contentOf('S2', artifact).subQuestions.map((q) => q.id);
    case 'S3':
      return contentOf('S3', artifact).strategies.flatMap((s) => s.queries.map((q) => q.id));
    case 'S4':
      return contentOf('S4', artifact).candidates.map((p) => p.id);
    case 'S5':
      return contentOf('S5', artifact).decisions.map((d) => d.id);
    default:
      return selectable(artifact).map((item) => item.id);
  }
}

export function selectedContent<K extends Stage>(stage: K, artifact: Artifact): StageContent[K] {
  const selections = artifact.selectionIds;
  const content: Inputs = { [stage]: contentOf(stage, artifact) };
  if (selections && content.S5)
    content.S5.decisions = content.S5.decisions.map((d) =>
      d.decision === 'included' && !selections.includes(d.id) ? { ...d, decision: 'uncertain' } : d,
    );
  if (selections && content.S6)
    content.S6.cards = content.S6.cards.filter((card) => selections.includes(card.id));
  if (selections && content.S7)
    content.S7.gaps = content.S7.gaps.filter((gap) => selections.includes(gap.id));
  if (selections && content.S8)
    content.S8.hypotheses = content.S8.hypotheses.filter((h) => selections.includes(h.id));
  return content[stage] ?? contentOf(stage, artifact);
}

export function acceptedInputs(run: Run, before: Stage): Inputs {
  const inputs: Inputs = {};
  const append = <K extends Stage>(stage: K, artifact: Artifact) => {
    inputs[stage] = selectedContent(stage, artifact);
  };
  for (const stage of STAGES.slice(0, STAGES.indexOf(before))) {
    const artifact = currentArtifact(run, stage);
    if (artifact?.status === 'accepted') append(stage, artifact);
  }
  return inputs;
}

export const selectionDigest = (artifact: Pick<Artifact, 'hash' | 'selectionIds' | 'primaryId'>) =>
  canonicalDigest([artifact.hash, artifact.selectionIds, artifact.primaryId]);

export function checkpointDigest(state: StageState) {
  const {
    stage,
    attempt,
    models,
    error,
    reviewError,
    critic,
    previousCritic,
    pi,
    criticProgress,
    piProgress,
    screeningProgress,
    cardProgress,
    cardCursor,
  } = state;
  return canonicalDigest({
    stage,
    attempt,
    models,
    error,
    reviewError,
    critic,
    previousCritic,
    pi,
    criticProgress,
    piProgress,
    screeningProgress,
    cardProgress,
    cardCursor,
  });
}

export function inputHashes(run: Run, before: Stage) {
  return STAGES.slice(0, STAGES.indexOf(before)).flatMap((stage) => {
    const artifact = currentArtifact(run, stage);
    return artifact?.status === 'accepted' && artifact.selectionHash
      ? [{ stage, hash: artifact.selectionHash }]
      : [];
  });
}

export async function canResume(run: Run): Promise<boolean> {
  if (run.charter && (await canonicalDigest(run.charter)) !== run.charterHash) return false;
  for (const row of run.pipeline)
    if (row.state === 'working' && row.checkpointHash !== (await checkpointDigest(row))) return false;
  return (
    await Promise.all(
      run.artifacts
        .filter((a) => a.status !== 'stale')
        .map(
          async (artifact) =>
            artifact.charterHash === run.charterHash &&
            JSON.stringify(artifact.inputHashes) === JSON.stringify(inputHashes(run, artifact.stage)) &&
            artifact.inputHashes.length === STAGES.indexOf(artifact.stage) &&
            artifact.hash === (await canonicalDigest(artifact.content)) &&
            (artifact.status !== 'accepted' || artifact.selectionHash === (await selectionDigest(artifact))),
        ),
    )
  ).every(Boolean);
}
