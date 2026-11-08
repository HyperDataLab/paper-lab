import type { TransitionFinding, TransitionJudgement, TransitionPair } from '../schemas/paperOverview';

export function transitionFindings(
  pairs: TransitionPair[],
  judgements: TransitionJudgement[],
  previous: TransitionFinding[] = [],
): TransitionFinding[] {
  return judgements.flatMap((judgement) => {
    const pair = pairs.find((item) => item.pairId === judgement.pairId);
    if (
      !pair ||
      !judgement.measured ||
      judgement.continuity !== 'shift' ||
      !['none', 'other'].includes(judgement.discourseRelation)
    )
      return [];
    const strong = !judgement.linked && judgement.confidence >= 0.5;
    const type = strong ? 'FLOW_BREAK_CANDIDATE' : 'UNEXPLAINED_TOPIC_SHIFT';
    const id = `${type}:${pair.pairId}:${pair.from.span.start}-${pair.from.span.end}:${pair.to.span.start}-${pair.to.span.end}`;
    const old = previous.find(
      (item) =>
        item.id === id &&
        item.from.analysisId === pair.from.analysisId &&
        item.to.analysisId === pair.to.analysisId,
    );
    const status =
      old && ['confirmed_by_human', 'dismissed_by_human'].includes(old.status) ? old.status : 'candidate';
    return [
      {
        id,
        type,
        pairId: pair.pairId,
        from: { paragraphId: pair.from.paragraphId, analysisId: pair.from.analysisId, span: pair.from.span },
        to: { paragraphId: pair.to.paragraphId, analysisId: pair.to.analysisId, span: pair.to.span },
        severity: strong ? 'moderate' : 'minor',
        status,
        why: `Đoạn ${pair.to.paragraphId} chuyển chủ đề sau đoạn ${pair.from.paragraphId} mà quan hệ chưa rõ. ${judgement.rationale}`,
        suggestedFix: `Cân nhắc làm rõ quan hệ giữa đoạn ${pair.from.paragraphId} và đoạn ${pair.to.paragraphId}, không thêm dữ kiện mới.`,
        confidence: judgement.confidence,
      } satisfies TransitionFinding,
    ];
  });
}
