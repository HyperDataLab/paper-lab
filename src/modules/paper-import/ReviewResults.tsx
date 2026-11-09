import { useState } from 'react';
import { LENSES, LensSchema, ReviewDimensionSchema, ReviewPointSchema } from '@/core/prompts';
import type { Paper, PaperReviewRun, PaperReviewsRecord, ReviewDecision } from '@/core/schemas';
import { Stat, StatGrid } from '@/shared/ui/ActionBar';
import { Card } from '@/shared/ui/Card';
import { Chip } from '@/shared/ui/Chip';
import { Select } from '@/shared/ui/Select';
import { DIMENSION_LABELS, KIND_LABELS } from './reviewLabels';
import { ReviewPointCard } from './ReviewPointCard';
import styles from './review.module.css';

export function ReviewResults({
  paper,
  run,
  decisions,
  onLocation,
  onReview,
}: {
  paper: Paper;
  run: PaperReviewRun;
  decisions: PaperReviewsRecord['decisions'];
  onLocation: (anchor: PaperReviewRun['merged'][number]['anchor']) => void;
  onReview: (id: string, status: ReviewDecision['status'] | 'candidate') => void;
}) {
  const [kind, setKind] = useState('all');
  const [dimension, setDimension] = useState('all');
  const [lens, setLens] = useState('all');
  const visible = run.merged.filter((point) =>
    point.wordings.some(
      (wording) =>
        (kind === 'all' || wording.kind === kind) &&
        (dimension === 'all' || wording.dimension === dimension) &&
        (lens === 'all' || wording.lens === lens),
    ),
  );
  return (
    <section aria-label="Kết quả phản biện" className={styles.results}>
      <Card>
        <p className={styles.note}>
          Phản biện AI chỉ mang tính tham khảo: không chấm điểm, không đề xuất chấp nhận hay từ chối.
        </p>
        <StatGrid>
          <Stat
            value={`${run.metrics.anchoring.anchored}/${run.metrics.anchoring.total}`}
            label="Tỷ lệ neo trích dẫn"
          />
          <Stat
            value={
              run.metrics.similarity.mean === null
                ? 'Không đủ góc nhìn'
                : run.metrics.similarity.mean.toFixed(2)
            }
            label="Độ trùng ý giữa các góc nhìn"
          />
          <Stat value={run.metrics.templates.length} label="Cụm khuôn mẫu" />
          <Stat
            value={`${run.metrics.agreement.matching}/${run.metrics.agreement.total}`}
            label="Đồng thuận với nhận xét của bạn"
          />
        </StatGrid>
        {run.metrics.similarity.similarPairs.map((pair, index) => (
          <p key={index}>
            Trùng ý:{' '}
            {pair.lenses
              .map((item) => {
                const parsed = LensSchema.safeParse(item);
                return parsed.success ? LENSES[parsed.data].label : item;
              })
              .join(' · ')}{' '}
            ({pair.similarity.toFixed(2)})
          </p>
        ))}
        <p className={styles.note}>
          Model: {run.model} · Prompt: {run.promptVersion}
        </p>
      </Card>
      <Card padding="md">
        <div className={styles.filters}>
          <Chip aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            Tất cả
          </Chip>
          {ReviewPointSchema.shape.kind.options.map((value) => (
            <Chip key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>
              {KIND_LABELS[value]}
            </Chip>
          ))}
        </div>
        <div className={styles.filters}>
          <Select
            label="Khía cạnh"
            size="sm"
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
          >
            <option value="all">Tất cả</option>
            {ReviewDimensionSchema.options.map((value) => (
              <option key={value} value={value}>
                {DIMENSION_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select label="Góc nhìn" size="sm" value={lens} onChange={(e) => setLens(e.target.value)}>
            <option value="all">Tất cả</option>
            {run.lenses.map((value) => (
              <option key={value} value={value}>
                {LENSES[value].label}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      {visible.map((point) => (
        <ReviewPointCard
          key={point.id}
          paper={paper}
          point={point}
          decision={decisions.find((d) => d.pointId === point.id)}
          templates={run.metrics.templates.map((t) => t.phrase)}
          onLocation={onLocation}
          onReview={onReview}
        />
      ))}
      {!visible.length && <p>Không có nhận xét phù hợp.</p>}
      <Card>
        <h2>Chưa xác định vị trí</h2>
        {run.reviews.flatMap((review) =>
          review.unanchored.map((item, index) => (
            <p key={`${review.lens}-${index}`}>
              {LENSES[review.lens].label}: {item.point} · {item.reason}
            </p>
          )),
        )}
      </Card>
      <Card>
        <h2>Không đánh giá được</h2>
        {run.reviews.flatMap((review) =>
          review.cannotJudge.map((item, index) => (
            <p key={`${review.lens}-${index}`}>
              {LENSES[review.lens].label} · {DIMENSION_LABELS[item.dimension]}: {item.reason}
            </p>
          )),
        )}
      </Card>
      <Card>
        <h2>Tóm tắt theo góc nhìn</h2>
        {run.reviews.map((review) => (
          <div key={review.lens}>
            <h3>{LENSES[review.lens].label}</h3>
            <p>{review.summary}</p>
          </div>
        ))}
      </Card>
    </section>
  );
}
