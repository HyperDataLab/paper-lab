import { CheckCircle2, Unlink } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { Paper, PaperOverviewRecord } from '@/core/schemas';
import { continuityLabels, relationLabels } from '@/modules/evaluate/roleLabels';
import { labels, statuses } from '@/modules/evaluate/issueLabels';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { SECTION_ROLE_LABELS } from './sectionRoles';
import styles from './overview.module.css';

export function OverviewTransitions({
  paper,
  transitions,
  onReview,
}: {
  paper: Paper;
  transitions: PaperOverviewRecord['transitions'];
  onReview: (id: string, status: 'confirmed_by_human' | 'dismissed_by_human' | 'candidate') => void;
}) {
  return (
    <Card>
      <h2>Chuyển đoạn</h2>
      {!transitions?.pairs.length && <p>Chưa có kết quả chuyển đoạn.</p>}
      {transitions &&
        [
          ...new Set([
            ...paper.sections.map((section) => section.id),
            ...transitions.pairs.map((pair) => pair.sectionId),
          ]),
        ].map((sectionId) => {
          const section = paper.sections.find((item) => item.id === sectionId);
          const pairs = transitions.pairs
            .filter((pair) => pair.sectionId === sectionId)
            .sort(
              (a, b) =>
                paper.paragraphs.findIndex((p) => p.id === a.from.paragraphId) -
                paper.paragraphs.findIndex((p) => p.id === b.from.paragraphId),
            );
          if (!pairs.length) return null;
          return (
            <section key={sectionId}>
              <h3>{section ? `${SECTION_ROLE_LABELS[section.role]} · ${section.heading}` : sectionId}</h3>
              <p>
                {pairs.map((pair, index) => (
                  <Fragment key={pair.pairId}>
                    {(index === 0 || pairs[index - 1]?.to.paragraphId !== pair.from.paragraphId) && (
                      <>
                        {index > 0 && ' · '}
                        <Link to={`/evaluate?id=${encodeURIComponent(pair.from.analysisId)}`}>
                          {pair.from.paragraphId}
                        </Link>
                      </>
                    )}
                    {' → '}
                    <Link to={`/evaluate?id=${encodeURIComponent(pair.to.analysisId)}`}>
                      {pair.to.paragraphId}
                    </Link>
                  </Fragment>
                ))}
              </p>
              {pairs.map((pair) => {
                const judgement = transitions.judgements.find((item) => item.pairId === pair.pairId);
                const findings = transitions.findings.filter((item) => item.pairId === pair.pairId);
                return (
                  <div key={pair.pairId} className={styles.transition}>
                    <p>
                      {pair.from.paragraphId} → {pair.to.paragraphId}
                    </p>
                    {judgement?.available === false ? (
                      <p>Không còn hợp lệ</p>
                    ) : judgement?.measured ? (
                      <>
                        <p>
                          {continuityLabels[judgement.continuity]} ·{' '}
                          {relationLabels[judgement.discourseRelation]} ·{' '}
                          {judgement.linked ? (
                            <>
                              <CheckCircle2 aria-hidden="true" size={16} /> Có liên kết
                            </>
                          ) : (
                            <>
                              <Unlink aria-hidden="true" size={16} /> Không liên kết
                            </>
                          )}
                        </p>
                        <p>
                          “{pair.from.quote}” → “{pair.to.quote}”
                        </p>
                        <p>{judgement.rationale}</p>
                      </>
                    ) : (
                      <p>Chưa đo được chuyển đoạn.</p>
                    )}
                    {findings.map((finding) => (
                      <div key={finding.id}>
                        <p>
                          <strong>{labels[finding.type]}</strong> · {statuses[finding.status]}
                        </p>
                        <p>{finding.why}</p>
                        <p>{finding.suggestedFix}</p>
                        {finding.status === 'confirmed_by_human' ||
                        finding.status === 'dismissed_by_human' ? (
                          <Button onClick={() => onReview(finding.id, 'candidate')}>Hoàn tác</Button>
                        ) : (
                          <>
                            <Button
                              disabled={judgement?.available === false}
                              onClick={() => onReview(finding.id, 'confirmed_by_human')}
                            >
                              Xác nhận
                            </Button>{' '}
                            <Button
                              disabled={judgement?.available === false}
                              onClick={() => onReview(finding.id, 'dismissed_by_human')}
                            >
                              Bỏ qua
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </section>
          );
        })}
    </Card>
  );
}
