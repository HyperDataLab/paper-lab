import { useEffect, useMemo, useState } from 'react';
import {
  buildPaperProfile,
  type DimensionId,
  type DimensionState,
  type ProfileView,
} from '@/core/paperProfile';
import type {
  Analysis,
  MeasurementsRecord,
  Paper,
  PaperChecksRecord,
  PaperContextRecord,
  PaperInsightsRecord,
  StanceRecord,
} from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Stat } from '@/shared/ui/ActionBar';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import styles from './profile.module.css';

const STATES: Record<DimensionState, { label: string; tone: 'neutral' | 'warning' | 'success' }> = {
  empty: { label: 'Chưa phân tích', tone: 'neutral' },
  partial: { label: 'Một phần', tone: 'warning' },
  ready: { label: 'Đã phân tích', tone: 'success' },
};

/** The five questions a reader brings to a paper, each answered from what has been analysed so far. */
export function PaperProfile({
  paper,
  analyses,
  checks,
  onOpen,
  only,
  label = 'Hồ sơ bài báo',
}: {
  paper: Paper;
  analyses: Analysis[];
  checks?: PaperChecksRecord;
  onOpen: (view: ProfileView) => void;
  /** The dimensions to show; each space shows the ones it is about. */
  only?: DimensionId[];
  label?: string;
}) {
  const repo = useRepositories();
  const [measurement, setMeasurement] = useState<MeasurementsRecord>();
  const [stance, setStance] = useState<StanceRecord>();
  const [scholarly, setScholarly] = useState<PaperContextRecord>();
  const [insights, setInsights] = useState<PaperInsightsRecord>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([
      repo.measurements.get(paper.id),
      repo.stance.get(paper.id),
      repo.paperContext.get(paper.id),
      repo.paperInsights.get(paper.id),
    ])
      .then(([savedMeasurement, savedStance, savedScholarly, savedInsights]) => {
        if (!active) return;
        setMeasurement(savedMeasurement);
        setStance(savedStance);
        setScholarly(savedScholarly);
        setInsights(savedInsights);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [paper.id, repo]);
  const dimensions = useMemo(
    () =>
      buildPaperProfile({ paper, analyses, checks, measurement, stance, scholarly, insights }).filter(
        (dimension) => !only || only.includes(dimension.id),
      ),
    [paper, analyses, checks, measurement, stance, scholarly, insights, only],
  );
  return (
    <section aria-label={label} className={styles.profile}>
      {error && <p role="alert">Không tải được một phần dữ liệu của hồ sơ.</p>}
      <div className={styles.grid}>
        {dimensions.map((dimension) => {
          const measured = dimension.indicators.filter((indicator) => indicator.value !== null);
          const pending = dimension.indicators.filter((indicator) => indicator.value === null);
          const empty = dimension.state === 'empty' && measured.length === 0;
          return (
            <Card key={dimension.id} padding="md">
              <article aria-label={dimension.title} className={styles.card} data-empty={empty}>
                <header className={styles.head}>
                  <span aria-hidden="true" className={styles.letter}>
                    {dimension.letter}
                  </span>
                  <div className={styles.titles}>
                    <h2>{dimension.title}</h2>
                    <p>{dimension.question}</p>
                  </div>
                  {dimension.state === 'partial' && <Badge tone="warning">{STATES.partial.label}</Badge>}
                </header>
                {measured.length > 0 && (
                  <div className={styles.indicators}>
                    {measured.map((indicator) => (
                      <Stat
                        key={indicator.id}
                        value={indicator.value}
                        label={
                          indicator.source === 'ai' ? (
                            <>
                              {indicator.label} <span className={styles.ai}>AI</span>
                            </>
                          ) : (
                            indicator.label
                          )
                        }
                      />
                    ))}
                  </div>
                )}
                {!empty && pending.length > 0 && (
                  <p className={styles.planned}>
                    Chưa đo: {pending.map((indicator) => indicator.label.toLowerCase()).join(', ')}.
                  </p>
                )}
                {dimension.attention && <p className={styles.attention}>{dimension.attention}</p>}
                <footer className={styles.foot}>
                  <span>{empty ? 'Chưa phân tích' : dimension.coverage}</span>
                  {dimension.target && (
                    <Button
                      size="sm"
                      variant={empty ? 'secondary' : 'ghost'}
                      onClick={() => dimension.target && onOpen(dimension.target)}
                    >
                      {empty ? 'Mở để phân tích' : 'Xem chi tiết'}
                    </Button>
                  )}
                </footer>
              </article>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
