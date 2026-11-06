import type { Analysis } from '../schemas/analysis';
import { createOffsetIndex } from '../text/offsets';
import { DIMENSIONS } from './rubric';
import type { Availability } from './availability';

export function buildEvidencePackages(
  analysis: Pick<
    Analysis,
    'text' | 'sentenceAnnotations' | 'paragraph' | 'flowLinks' | 'paragraphMetrics' | 'issues'
  >,
  availability: Availability,
) {
  const index = createOffsetIndex(analysis.text.sourceText);
  const quote = (span: { start: number; end: number } | null) =>
    span ? index.sliceCp(span.start, span.end) : null;
  return DIMENSIONS.filter((dimension) => availability[dimension.id].applicable).map((dimension) => {
    const relevant = analysis.issues.filter(
      (issue) =>
        issue.status !== 'dismissed_by_human' &&
        (dimension.id === 'sentence_structure'
          ? issue.category === 'structure'
          : dimension.id === 'paragraph_organization'
            ? issue.category === 'organization'
            : dimension.id === 'flow_coherence'
              ? issue.category === 'flow'
              : dimension.id === 'verb_word_choice'
                ? ['PASSIVE_PROBLEMATIC', 'FUZZY_VERB', 'NOMINALIZATION', 'JARGON_UNEXPLAINED'].includes(
                    issue.type,
                  )
                : ['WEAK_MODIFIER', 'UNSUPPORTED_INTENSIFIER', 'REDUNDANT_PHRASE', 'METADISCOURSE'].includes(
                    issue.type,
                  )),
    );
    return {
      id: dimension.id,
      ...(dimension.id === 'paragraph_organization' && analysis.paragraph
        ? {
            structure: {
              type: analysis.paragraph.type,
              score: analysis.paragraph.typeScores[analysis.paragraph.type],
              centralPoint: {
                ...analysis.paragraph.centralPoint,
                quote: quote(analysis.paragraph.centralPoint.span),
              },
              roles: analysis.text.sentences.map((sentence) => {
                const annotation = analysis.sentenceAnnotations.find(
                  (item) => item.sentenceId === sentence.id,
                );
                return {
                  sentenceId: sentence.id,
                  role: annotation?.role ?? null,
                  rationale: annotation?.roleRationale ?? null,
                };
              }),
            },
          }
        : {}),
      ...(dimension.id === 'flow_coherence'
        ? {
            links: analysis.flowLinks.map((link) =>
              link.measured
                ? {
                    fromSentenceId: link.fromSentenceId,
                    toSentenceId: link.toSentenceId,
                    continuity: link.continuity,
                    relation: link.discourseRelation,
                    linked: link.linked,
                    confidence: link.confidence,
                    stress: quote(link.fromSpan),
                    topic: quote(link.toSpan),
                    rationale: link.rationale,
                  }
                : {
                    fromSentenceId: link.fromSentenceId,
                    toSentenceId: link.toSentenceId,
                    result: 'no model output',
                  },
            ),
          }
        : {}),
      metrics:
        dimension.id === 'sentence_structure'
          ? { sentenceCount: analysis.text.sentences.length, annotations: analysis.sentenceAnnotations }
          : dimension.id === 'paragraph_organization' || dimension.id === 'flow_coherence'
            ? analysis.paragraphMetrics
            : { sentenceCount: analysis.text.sentences.length, tokenCount: analysis.text.tokens.length },
      issues: relevant.map((issue) => ({
        id: issue.id,
        type: issue.type,
        quote: issue.spans.map((span) => index.sliceCp(span.start, span.end)),
        metric: issue.metric,
        severity: issue.severity,
        status: issue.status,
        confirmedByHuman: issue.status === 'confirmed_by_human',
        acceptable: issue.severity === 'info',
      })),
    };
  });
}
