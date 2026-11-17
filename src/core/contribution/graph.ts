import type { PaperModel } from '../schemas';

type Triple = PaperModel['knowledge']['triples'][number];
type Unit = Triple['unit'];

export const CONTRIBUTION_STAGES: { label: string; units: Unit[]; color: string }[] = [
  { label: 'Vấn đề', units: ['ResearchProblem', 'Tasks'], color: 'var(--sec-introduction)' },
  { label: 'Cách làm', units: ['Approach', 'Model', 'Code'], color: 'var(--sec-methods)' },
  {
    label: 'Thực nghiệm',
    units: ['Dataset', 'ExperimentalSetup', 'Hyperparameters', 'Baselines', 'Experiments'],
    color: 'var(--sec-related)',
  },
  { label: 'Kết quả', units: ['Results', 'AblationAnalysis'], color: 'var(--sec-results)' },
];

export function groupContributionStages(triples: Triple[]) {
  return CONTRIBUTION_STAGES.map((stage) => {
    const groups = stage.units
      .map((unit) => ({ unit, triples: triples.filter((triple) => triple.unit === unit) }))
      .filter((group) => group.triples.length > 0);
    return { ...stage, groups, count: groups.reduce((sum, group) => sum + group.triples.length, 0) };
  });
}

export function normalizePhrase(text: string) {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function contributionGraph(knowledge: PaperModel['knowledge']) {
  const phrases = new Map(knowledge.phrases.map((phrase) => [phrase.id, phrase.text]));
  const nodes = new Map<string, { id: string; label: string; degree: number; stage: number }>();
  const edges = knowledge.triples.flatMap((triple, index) => {
    const subject = phrases.get(triple.subject);
    const object = phrases.get(triple.object);
    const predicate = phrases.get(triple.predicate);
    if (!subject || !object || !predicate) return [];
    const stage = CONTRIBUTION_STAGES.findIndex((item) => item.units.includes(triple.unit));
    const source = normalizePhrase(subject);
    const target = normalizePhrase(object);
    for (const [id, label] of [
      [source, subject],
      [target, object],
    ] as const) {
      const node = nodes.get(id) ?? { id, label, degree: 0, stage };
      node.degree++;
      node.stage = Math.min(node.stage, stage);
      nodes.set(id, node);
    }
    return [{ source, target, predicate, stage, triple, index }];
  });
  const ranked = [...nodes.values()].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  const visible = knowledge.triples.length > 40 ? ranked.slice(0, 20) : ranked;
  const ordered = visible.slice(1).sort((a, b) => a.stage - b.stage || a.id.localeCompare(b.id));
  const positioned = visible.slice(0, 1).map((node) => ({ ...node, x: 400, y: 250 }));
  ordered.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / ordered.length - Math.PI / 2;
    positioned.push({ ...node, x: 400 + 310 * Math.cos(angle), y: 250 + 185 * Math.sin(angle) });
  });
  const ids = new Set(positioned.map((node) => node.id));
  return {
    nodes: positioned,
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    allEdges: edges,
  };
}
