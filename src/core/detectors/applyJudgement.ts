import type { CandidateJudgeOutput } from '../prompts/candidateJudge';
import type { Issue, SentenceAnnotation, TextAnalysis } from '../schemas';

export function applyJudgement(
  candidates: Issue[],
  output: CandidateJudgeOutput,
  text: TextAnalysis,
  annotations: SentenceAnnotation[] | null,
): Issue[] {
  const seen = new Set<string>();
  const judgements = new Map<string, CandidateJudgeOutput['judgements'][number]>();
  for (const entry of output.judgements)
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      judgements.set(entry.id, entry);
    }
  const issues = candidates.map((candidate): Issue => {
    const entry = judgements.get(candidate.id);
    if (!entry || entry.verdict === 'uncertain') return candidate;
    if (entry.verdict === 'acceptable')
      return {
        ...candidate,
        findingKind: 'stylistic_suggestion',
        severity: 'info',
        why: entry.why.trim() ? entry.why : candidate.why,
        suggestedFix: null,
        confidence: entry.confidence,
      };
    return {
      ...candidate,
      status: 'confirmed_by_model',
      severity: entry.severity ?? candidate.severity,
      confidence: entry.confidence,
      why: entry.why.trim() ? entry.why : candidate.why,
      suggestedFix: entry.suggestedFix?.trim() ? entry.suggestedFix : candidate.suggestedFix,
    };
  });
  const passiveSeen = new Set<string>();
  for (const entry of output.passive) {
    if (passiveSeen.has(entry.sentenceId)) continue;
    passiveSeen.add(entry.sentenceId);
    const annotation = annotations?.find((a) => a.sentenceId === entry.sentenceId && a.voice === 'passive');
    const span = annotation?.verbSpan;
    if (!entry.problematic || !span || !text.sentences.some((s) => s.id === entry.sentenceId)) continue;
    issues.push({
      id: `PASSIVE_PROBLEMATIC:${entry.sentenceId}:${span.start}-${span.end}`,
      type: 'PASSIVE_PROBLEMATIC',
      category: 'word',
      findingKind: 'review_candidate',
      status: 'confirmed_by_model',
      severity: 'minor',
      spans: [{ ...span, role: 'verb' }],
      sentenceIds: [entry.sentenceId],
      metric: { name: 'voice', value: null, unit: null },
      why: entry.why,
      suggestedFix: entry.suggestedFix,
      sourcePrinciple: 'Schimel Ch. 14, §14.1',
      confidence: entry.confidence,
    });
  }
  return issues;
}
