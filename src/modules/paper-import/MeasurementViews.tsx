import { useState } from 'react';
import { evidenceRate, reviewQueueSize } from '@/core/measurement';
import { PROTOCOL_FIELDS, type MeasurementProfile, type Paper, type ProtocolField } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { EvidenceLinks, FieldRow, ItemActions, StatusBadges, type ItemContext } from './MeasurementItems';
import styles from './measurement.module.css';

const PAPER_TYPE: Record<MeasurementProfile['paper_type'], string> = {
  EMPIRICAL: 'Thực nghiệm',
  SURVEY_SLR: 'Khảo sát / Tổng quan hệ thống',
  METHOD_THEORETICAL: 'Phương pháp / Lý thuyết',
  CASE_STUDY: 'Nghiên cứu trường hợp',
  MIXED: 'Hỗn hợp',
};
const PROTOCOL_LABELS: Record<ProtocolField, string> = {
  subject: 'Đối tượng đánh giá',
  data: 'Dữ liệu',
  comparison: 'So sánh',
  environment: 'Môi trường',
  schedule: 'Lịch đo',
  repetitions: 'Số lần lặp',
  seeds: 'Seed ngẫu nhiên',
  statistical_analysis: 'Kiểm định thống kê',
  aggregation: 'Tổng hợp',
};
const FINDING_LABELS: Record<MeasurementProfile['findings'][number]['type'], string> = {
  definition_ambiguity: 'Định nghĩa chưa rõ',
  unit_scale_mismatch: 'Đơn vị/thang đo chưa khớp',
  protocol_incompleteness: 'Protocol chưa đủ',
  aggregation_ambiguity: 'Cách tổng hợp chưa rõ',
  comparability_risk: 'Rủi ro khi so sánh',
  claim_evidence_gap: 'Kết luận rộng hơn bằng chứng',
};
const SEVERITY = { low: 'Thấp', medium: 'Vừa', high: 'Cao' } as const;

export function OverviewView({ profile, paper }: { profile: MeasurementProfile; paper: Paper }) {
  const evidence = evidenceRate(profile);
  const heading = (id: string) => paper.sections.find((section) => section.id === id)?.heading ?? id;
  const notRead = [...profile.coverage.failed, ...profile.coverage.not_selected];
  return (
    <Card>
      <h2>Tổng quan hồ sơ đo lường</h2>
      <p>
        Loại bài: <Badge tone="accent">{PAPER_TYPE[profile.paper_type]}</Badge>
      </p>
      <p>{profile.paper_type_rationale}</p>
      <ul>
        <li>{profile.constructs.length} thuộc tính đo</li>
        <li>{profile.metrics.length} metric</li>
        <li>{profile.experiments.length} thí nghiệm</li>
        <li>{profile.results.length} kết quả</li>
        <li>{profile.findings.length} cảnh báo</li>
        <li>{reviewQueueSize(profile)} mục cần xem lại</li>
        <li>
          Có bằng chứng: {evidence.withEvidence}/{evidence.total}
          {evidence.rate !== null && ` (${Math.round(evidence.rate * 100)} %)`}
        </li>
      </ul>
      {profile.status === 'partial' && (
        <p role="status">
          Phân tích chưa trọn vẹn.
          {profile.coverage.failed.length > 0 &&
            ` Không đọc được: ${profile.coverage.failed.map(heading).join(', ')}.`}
          {profile.steps.link === 'failed' && ' Bước liên kết không chạy được.'}
          {profile.steps.findings === 'failed' && ' Bước cảnh báo không chạy được.'}
        </p>
      )}
      {notRead.length > 0 && <p>Mục chưa phân tích: {notRead.map(heading).join(', ')}.</p>}
      <p className={styles.note}>
        AI đã bỏ {profile.discarded.unverified_quotes} trích dẫn không tìm lại được trong bài,{' '}
        {profile.discarded.unsupported_findings} cảnh báo không có căn cứ, {profile.discarded.invalid_links}{' '}
        liên kết không hợp lệ. Hồ sơ này không có điểm tổng và không đánh giá phương pháp đúng hay sai.
      </p>
    </Card>
  );
}

export function MetricsView({ profile, context }: { profile: MeasurementProfile; context: ItemContext }) {
  const [open, setOpen] = useState<string | null>(null);
  const experiment = (id: string) => profile.experiments.find((item) => item.id === id)?.name ?? id;
  const construct = (id: string) => profile.constructs.find((item) => item.id === id)?.name ?? id;
  if (!profile.metrics.length) return <Card>Không tìm thấy metric nào trong phần đã phân tích.</Card>;
  return (
    <Card>
      <h2>Bảng metric</h2>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Thuộc tính đo</th>
              <th>Công thức / đơn vị</th>
              <th>Thí nghiệm</th>
              <th>Định nghĩa</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {profile.metrics.flatMap((metric) => [
              <tr key={metric.id}>
                <td>
                  {metric.reported_name}
                  {metric.aliases.length > 0 && (
                    <div className={styles.note}>Tên khác: {metric.aliases.join(', ')}</div>
                  )}
                  {metric.name_collision && <Badge tone="warning">Trùng tên, định nghĩa có thể khác</Badge>}
                </td>
                <td>{metric.construct_ids.map(construct).join(', ') || '—'}</td>
                <td>{[metric.formula_text.value, metric.unit.value].filter(Boolean).join(' · ') || '—'}</td>
                <td>{metric.experiment_ids.map(experiment).join(', ') || '—'}</td>
                <td>
                  <StatusBadges
                    status={metric.definition.status}
                    needsReview={metric.definition.needs_review}
                  />
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setOpen(open === metric.id ? null : metric.id)}
                  >
                    {open === metric.id ? 'Thu gọn' : 'Chi tiết'}
                  </Button>
                </td>
              </tr>,
              ...(open === metric.id
                ? [
                    <tr key={`${metric.id}-detail`}>
                      <td colSpan={6}>
                        <ItemActions itemId={metric.id} context={context} value={metric.reported_name} />
                        <FieldRow
                          label="Định nghĩa"
                          field={metric.definition}
                          itemId={metric.id}
                          path="definition"
                          context={context}
                        />
                        <FieldRow
                          label="Công thức (nguyên văn)"
                          field={metric.formula_text}
                          itemId={metric.id}
                          path="formula_text"
                          context={context}
                        />
                        <FieldRow
                          label="Đơn vị"
                          field={metric.unit}
                          itemId={metric.id}
                          path="unit"
                          context={context}
                        />
                        <FieldRow
                          label="Chiều tốt/xấu"
                          field={metric.direction}
                          itemId={metric.id}
                          path="direction"
                          context={context}
                        />
                        <FieldRow
                          label="Phạm vi"
                          field={metric.range}
                          itemId={metric.id}
                          path="range"
                          context={context}
                        />
                        <FieldRow
                          label="Đầu vào"
                          field={metric.method.input_data}
                          itemId={metric.id}
                          path="method.input_data"
                          context={context}
                        />
                        <FieldRow
                          label="Phép tính"
                          field={metric.method.procedure}
                          itemId={metric.id}
                          path="method.procedure"
                          context={context}
                        />
                        <FieldRow
                          label="Nguồn số liệu"
                          field={metric.method.data_source}
                          itemId={metric.id}
                          path="method.data_source"
                          context={context}
                        />
                        <FieldRow
                          label="Tổng hợp"
                          field={metric.method.aggregation}
                          itemId={metric.id}
                          path="method.aggregation"
                          context={context}
                        />
                      </td>
                    </tr>,
                  ]
                : []),
            ])}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ProtocolView({ profile, context }: { profile: MeasurementProfile; context: ItemContext }) {
  if (profile.paper_type === 'SURVEY_SLR')
    return (
      <>
        <Card>
          <h2>Taxonomy được khảo sát</h2>
          {profile.taxonomy.length === 0 && <p>Không tìm thấy mục nào trong phần đã phân tích.</p>}
          {profile.taxonomy.map((entry) => (
            <div key={entry.id} className={styles.item}>
              <h3>
                {entry.construct} · {entry.metric}
              </h3>
              <EvidenceLinks ids={entry.evidence_ids} context={context} />
              <ItemActions itemId={entry.id} context={context} />
              <FieldRow
                label="Cách đo"
                field={entry.how_measured}
                itemId={entry.id}
                path="how_measured"
                context={context}
              />
              <FieldRow
                label="Lĩnh vực"
                field={entry.domain}
                itemId={entry.id}
                path="domain"
                context={context}
              />
            </div>
          ))}
        </Card>
        {profile.review_method && (
          <Card>
            <h2>Phương pháp tổng quan</h2>
            {(
              [
                ['Chiến lược tìm kiếm', 'search_strategy'],
                ['Tiêu chí chọn', 'inclusion_criteria'],
                ['Tổng hợp', 'synthesis'],
              ] as const
            ).map(([label, key]) => (
              <p key={key}>
                <strong>{label}: </strong>
                {profile.review_method?.[key].value ?? '—'}{' '}
                <StatusBadges
                  status={profile.review_method?.[key].status ?? 'NOT_REPORTED'}
                  needsReview={profile.review_method?.[key].needs_review ?? false}
                />
              </p>
            ))}
          </Card>
        )}
      </>
    );
  if (!profile.experiments.length) return <Card>Không tìm thấy thí nghiệm nào trong phần đã phân tích.</Card>;
  return (
    <>
      {profile.experiments.map((experiment) => (
        <Card key={experiment.id}>
          <h2>{experiment.name}</h2>
          <ItemActions itemId={experiment.id} context={context} value={experiment.name} />
          {PROTOCOL_FIELDS.map((key) => (
            <FieldRow
              key={key}
              label={PROTOCOL_LABELS[key]}
              field={experiment.protocol[key]}
              itemId={experiment.id}
              path={`protocol.${key}`}
              context={context}
            />
          ))}
        </Card>
      ))}
    </>
  );
}

export function ResultsView({ profile, context }: { profile: MeasurementProfile; context: ItemContext }) {
  const metric = (id: string | null) => profile.metrics.find((item) => item.id === id)?.reported_name ?? '—';
  const experiment = (id: string | null) => profile.experiments.find((item) => item.id === id)?.name ?? '—';
  const result = (id: string) => profile.results.find((item) => item.id === id);
  return (
    <>
      <Card>
        <h2>Claim và kết quả liên quan</h2>
        {profile.claims.length === 0 && <p>Không tìm thấy claim nào trong phần đã phân tích.</p>}
        {profile.claims.map((claim) => (
          <div key={claim.id} className={styles.item}>
            <p className={styles.value}>{claim.text}</p>
            <div className={styles.meta}>
              <StatusBadges status={claim.status} needsReview={claim.needs_review} />
              <EvidenceLinks ids={claim.evidence_ids} context={context} />
              <ItemActions itemId={claim.id} context={context} value={claim.text} />
            </div>
            {claim.evidence_scope ? (
              <p>
                <Badge>AI diễn giải</Badge> Phạm vi bằng chứng: {claim.evidence_scope}
              </p>
            ) : (
              <p className={styles.note}>Chưa liên kết được với kết quả đã kiểm chứng.</p>
            )}
            {claim.linked_result_ids.length > 0 && (
              <ul>
                {claim.linked_result_ids.map((id) => {
                  const item = result(id);
                  return item ? (
                    <li key={id}>
                      {item.system_or_baseline}: {item.value} {item.unit ?? ''} ·{' '}
                      {metric(item.metric_usage_id)} · {experiment(item.experiment_id)}
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </div>
        ))}
      </Card>
      <Card>
        <h2>Kết quả</h2>
        {profile.results.length === 0 ? (
          <p>Không tìm thấy kết quả nào trong phần đã phân tích.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Hệ thống</th>
                  <th>Giá trị</th>
                  <th>Đơn vị</th>
                  <th>Sai số</th>
                  <th>Metric</th>
                  <th>Thí nghiệm</th>
                  <th>Nguồn</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {profile.results.map((item) => (
                  <tr key={item.id}>
                    <td>{item.system_or_baseline}</td>
                    <td>{item.value}</td>
                    <td>{item.unit ?? '—'}</td>
                    <td>{item.uncertainty ?? '—'}</td>
                    <td>{metric(item.metric_usage_id)}</td>
                    <td>{experiment(item.experiment_id)}</td>
                    <td>
                      <EvidenceLinks ids={item.evidence_ids} context={context} />
                    </td>
                    <td>
                      <StatusBadges status={item.status} needsReview={item.needs_review} />
                    </td>
                    <td>
                      <ItemActions itemId={item.id} context={context} value={item.value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export function IssuesView({ profile, context }: { profile: MeasurementProfile; context: ItemContext }) {
  return (
    <Card>
      <h2>Vấn đề và duyệt</h2>
      <p className={styles.note}>Đây là câu hỏi để kiểm tra lại, không phải kết luận về lỗi phương pháp.</p>
      {profile.findings.length === 0 && <p>AI không nêu cảnh báo nào.</p>}
      {profile.findings.map((finding) => (
        <div key={finding.id} className={styles.item}>
          <div className={styles.meta}>
            <Badge tone="warning">AI lưu ý</Badge>
            <Badge>{FINDING_LABELS[finding.type]}</Badge>
            <Badge>Mức: {SEVERITY[finding.severity]}</Badge>
            <EvidenceLinks ids={finding.evidence_ids} context={context} />
          </div>
          <p>{finding.explanation}</p>
          <p>
            <strong>Câu hỏi cho tác giả: </strong>
            {finding.suggested_question_to_author}
          </p>
          <p className={styles.note}>Giới hạn: {finding.limitation_of_assessment}</p>
          <ItemActions itemId={finding.id} context={context} value={finding.explanation} />
        </div>
      ))}
    </Card>
  );
}
