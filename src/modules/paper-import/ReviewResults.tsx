import { useState } from 'react';
import { LENSES, LensSchema, ReviewDimensionSchema, ReviewPointSchema } from '@/core/prompts';
import type { PaperReviewRun, PaperReviewsRecord, ReviewDecision } from '@/core/schemas';
import { Card } from '@/shared/ui/Card';
import { Select } from '@/shared/ui/Select';
import { DIMENSION_LABELS, KIND_LABELS } from './reviewLabels';
import { ReviewPointCard } from './ReviewPointCard';

export function ReviewResults({
  run,
  decisions,
  onLocation,
  onReview,
}: {
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
    <section aria-label="Kết quả phản biện">
      <Card>
        <p>Phản biện AI chỉ mang tính tham khảo: không chấm điểm, không đề xuất chấp nhận hay từ chối.</p>
        <p>
          Tỷ lệ neo trích dẫn: {run.metrics.anchoring.anchored}/{run.metrics.anchoring.total}
        </p>
        <p>
          Độ trùng ý giữa các góc nhìn:{' '}
          {run.metrics.similarity.mean === null
            ? 'Không đủ góc nhìn'
            : run.metrics.similarity.mean.toFixed(2)}
        </p>
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
        <p>Cụm khuôn mẫu: {run.metrics.templates.length}</p>
        <p>
          Đồng thuận với nhận xét của bạn: {run.metrics.agreement.matching}/{run.metrics.agreement.total}
        </p>
        <p>
          Model: {run.model} · Prompt: {run.promptVersion}
        </p>
      </Card>
      <Card>
        <h2>Lọc nhận xét</h2>
        <Select label="Loại nhận xét" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">Tất cả</option>
          {ReviewPointSchema.shape.kind.options.map((value) => (
            <option key={value} value={value}>
              {KIND_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select label="Khía cạnh" value={dimension} onChange={(e) => setDimension(e.target.value)}>
          <option value="all">Tất cả</option>
          {ReviewDimensionSchema.options.map((value) => (
            <option key={value} value={value}>
              {DIMENSION_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select label="Góc nhìn" value={lens} onChange={(e) => setLens(e.target.value)}>
          <option value="all">Tất cả</option>
          {run.lenses.map((value) => (
            <option key={value} value={value}>
              {LENSES[value].label}
            </option>
          ))}
        </Select>
      </Card>
      {visible.map((point) => (
        <ReviewPointCard
          key={point.id}
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
