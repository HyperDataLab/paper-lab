import { PaperOverviewSchema, type PaperOverview } from '../schemas/paperOverview';
import { STRUCTURE_TYPES } from '../schemas/paragraph';
import type { Analysis, Paper } from '../schemas';
import { sliceCp } from '../text/offsets';

const dimensions = [
  'sentence_structure',
  'verb_word_choice',
  'concision_modifiers',
  'paragraph_organization',
  'flow_coherence',
];
export function paperAnalyses(paper: Paper, analyses: Analysis[]): Map<string, Analysis> {
  const result = new Map<string, Analysis>();
  for (const analysis of analyses) {
    if (analysis.origin?.kind !== 'paper' || analysis.origin.paperId !== paper.id) continue;
    const paragraphId = analysis.origin.paragraphId;
    const paragraph = paper.paragraphs.find((p) => p.id === paragraphId);
    if (!paragraph || paragraph.kind !== 'body' || paragraph.text !== analysis.text.sourceText) continue;
    const previous = result.get(paragraph.id);
    if (
      !previous ||
      analysis.updatedAt > previous.updatedAt ||
      (analysis.updatedAt === previous.updatedAt && analysis.id > previous.id)
    )
      result.set(paragraph.id, analysis);
  }
  return result;
}
function quantile(values: number[], fraction: number): number {
  const index = (values.length - 1) * fraction;
  const lower = Math.floor(index);
  const a = values[lower] ?? 0;
  return a + ((values[Math.ceil(index)] ?? a) - a) * (index - lower);
}
function counts(paragraphIds: string[], selected: Map<string, Analysis>) {
  const analyses = paragraphIds.flatMap((id) => {
    const a = selected.get(id);
    return a ? [a] : [];
  });
  const issuesByCategory: Record<string, number> = {};
  const issuesByType: Record<string, number> = {};
  const structures = Object.fromEntries(STRUCTURE_TYPES.map((type) => [type, 0])) as Record<
    (typeof STRUCTURE_TYPES)[number],
    number
  >;
  for (const a of analyses) {
    if (a.paragraph) structures[a.paragraph.type]++;
    for (const issue of a.issues.filter((i) => i.status !== 'dismissed_by_human' && i.severity !== 'info')) {
      issuesByCategory[issue.category] = (issuesByCategory[issue.category] ?? 0) + 1;
      issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1;
    }
  }
  const scores = Object.fromEntries(
    dimensions.map((id) => {
      const values = analyses
        .flatMap(
          (a) =>
            a.scores?.dimensions
              .filter((d) => d.id === id && d.applicable && d.score !== null)
              .map((d) => d.score as number) ?? [],
        )
        .sort((a, b) => a - b);
      return [
        id,
        values.length
          ? {
              n: values.length,
              median: quantile(values, 0.5),
              q1: quantile(values, 0.25),
              q3: quantile(values, 0.75),
              min: values[0],
              max: values.at(-1),
            }
          : null,
      ];
    }),
  );
  return {
    bodyParagraphs: paragraphIds.length,
    analysed: analyses.length,
    coverage: paragraphIds.length ? Math.round((analyses.length / paragraphIds.length) * 1000) / 1000 : 0,
    issuesByCategory,
    issuesByType,
    scores,
    structures,
  };
}
export function aggregatePaper(paper: Paper, analyses: Analysis[]): PaperOverview {
  const selected = paperAnalyses(paper, analyses);
  const sections = paper.sections.map((section) => ({
    sectionId: section.id,
    ...counts(
      paper.paragraphs.filter((p) => p.sectionId === section.id && p.kind === 'body').map((p) => p.id),
      selected,
    ),
  }));
  const recurring = new Map<
    string,
    { paragraphIds: Set<string>; sectionIds: Set<string>; count: number; examples: string[] }
  >();
  for (const p of paper.paragraphs) {
    const a = selected.get(p.id);
    if (!a) continue;
    for (const issue of a.issues.filter((i) => i.status !== 'dismissed_by_human' && i.severity !== 'info')) {
      const item = recurring.get(issue.type) ?? {
        paragraphIds: new Set<string>(),
        sectionIds: new Set<string>(),
        count: 0,
        examples: [],
      };
      item.paragraphIds.add(p.id);
      item.sectionIds.add(p.sectionId);
      item.count++;
      for (const span of issue.spans) {
        const quote = sliceCp(a.text.sourceText, span.start, span.end);
        if (quote && !item.examples.includes(quote) && item.examples.length < 3) item.examples.push(quote);
      }
      recurring.set(issue.type, item);
    }
  }
  return PaperOverviewSchema.parse({
    schemaVersion: 1,
    paperId: paper.id,
    ...counts(
      paper.paragraphs.filter((p) => p.kind === 'body').map((p) => p.id),
      selected,
    ),
    sections,
    recurringIssues: [...recurring]
      .filter(([, v]) => v.paragraphIds.size >= 3 || v.sectionIds.size >= 2)
      .map(([type, v]) => ({
        type,
        paragraphIds: [...v.paragraphIds],
        sectionIds: [...v.sectionIds],
        count: v.count,
        examples: v.examples,
      })),
    generatedFrom: [...selected.values()].map((a) => ({
      analysisId: a.id,
      updatedAt: a.updatedAt,
      promptVersions: [
        ...new Set(
          [
            a.versions.prompt,
            a.versions.judgePrompt,
            a.versions.structurePrompt,
            a.versions.scoringPrompt,
          ].filter((v): v is string => v !== null),
        ),
      ],
      rubricVersions: [
        ...new Set([a.versions.rubric, a.scores?.rubricVersion].filter((v): v is string => v != null)),
      ],
    })),
  });
}
