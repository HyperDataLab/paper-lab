import { AnalysisSchema, type Analysis, type Paper } from '@/core/schemas';
import { ScoresSchema } from '@/core/schemas/scores';
import { analyzeText } from '@/core/text/analyzeText';

export const probeAt = '2026-01-01T00:00:00.000Z';
export const probeScores = ScoresSchema.parse({
  rubricVersion: 'schimel-paragraph-v1',
  dimensions: ['sentence_structure', 'verb_word_choice', 'concision_modifiers'].map((id) => ({
    id,
    label: id,
    weight: 1,
    applicable: true,
    notAssessableReason: null,
    rubric: 2,
    score: 50,
    descriptor: null,
    confidence: 1,
    evidence: { issueIds: [], sentenceIds: [] },
    rationale: null,
  })),
  overall: null,
  overallSuppressedReason: 'unavailable',
  coverage: { applicable: 3, total: 5, value: 0.6 },
  confidence: 1,
  contextLimited: true,
  issueSnapshot: '',
});
export async function probeFixture(): Promise<{ paper: Paper; analyses: Analysis[] }> {
  const paper: Paper = {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Paper',
    createdAt: probeAt,
    updatedAt: probeAt,
    source: { kind: 'text', fileName: 'paper.txt', pageCount: null, sha256: 'source' },
    sections: ['a', 'b', 'c'].map((id) => ({ id, heading: id, role: 'methods', level: 1, pageStart: null })),
    paragraphs: [],
  };
  const analyses: Analysis[] = [];
  for (let i = 0; i < 6; i++) {
    const text = await analyzeText(`The method describes the experiment ${i}.`);
    const sectionId = ['a', 'b', 'c'][Math.floor(i / 2)] ?? 'a';
    const id = `p${i}`;
    paper.paragraphs.push({
      id,
      sectionId,
      order: i,
      text: text.sourceText,
      textHash: text.sourceHash,
      kind: 'body',
      pageStart: null,
    });
    analyses.push(
      AnalysisSchema.parse({
        schemaVersion: 1,
        id: `00000000-0000-4000-8000-00000000000${i + 2}`,
        createdAt: probeAt,
        updatedAt: probeAt,
        text,
        context: { before: null, after: null, audience: null },
        contextLimited: true,
        versions: {
          rubric: 'schimel-paragraph-v1',
          prompt: null,
          model: 'test',
          syntaxProvider: null,
          scoringPrompt: 'score-paper-1',
          scoringModel: 'test',
        },
        sentenceAnnotations: [],
        issues: [],
        scores: probeScores,
        parentAnalysisId: null,
        origin: { kind: 'paper', paperId: paper.id, paragraphId: id },
      }),
    );
  }
  return { paper, analyses };
}
