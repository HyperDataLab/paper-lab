import type { ReactNode } from 'react';
import { ATOMIC_ROLE_LABELS, evidenceRate, reviewQueueSize, type MeasurementRef } from '@/core/measurement';
import {
  PROTOCOL_FIELDS,
  type MeasurementProfile,
  type MetricUsage,
  type Paper,
  type ProfileField,
  type ProtocolField,
  type ReportedResult,
  type AtomicRole,
} from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Stat } from '@/shared/ui/ActionBar';
import { Card } from '@/shared/ui/Card';
import { FindingCard } from '@/shared/ui/FindingCard';
import {
  AtomicLinks,
  EvidenceLinks,
  FieldRow,
  ItemActions,
  StatusBadges,
  type ItemContext,
} from './MeasurementItems';
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
  claim_evidence_gap: 'Claim rộng hơn evidence',
};
const SEVERITY = { low: 'Thấp', medium: 'Vừa', high: 'Cao' } as const;
const CELL: Record<ProfileField['status'], { mark: string; label: string }> = {
  REPORTED: { mark: '✓', label: 'Tác giả nêu' },
  HUMAN_EDITED: { mark: '✎', label: 'Người duyệt sửa' },
  INFERRED: { mark: '≈', label: 'AI diễn giải' },
  DERIVED: { mark: '≈', label: 'AI tính từ số liệu' },
  NOT_REPORTED: { mark: '–', label: 'Không thấy trong phần đã phân tích' },
  NOT_APPLICABLE: { mark: '∅', label: 'Không áp dụng' },
  NOT_CHECKED: { mark: '?', label: 'Chưa kiểm tra' },
  CONTRADICTORY: { mark: '≠', label: 'Mâu thuẫn trong bài' },
};

export interface ViewProps {
  profile: MeasurementProfile;
  context: ItemContext;
  open: (ref: MeasurementRef) => void;
}
type Row = { label: string; field: ProfileField; path: string };

/** Fields that say something come first; the many "not found" ones fold into a single line. */
function FieldGroup({ rows, itemId, context }: { rows: Row[]; itemId: string; context: ItemContext }) {
  const empty = (row: Row) => row.field.value === null && !row.field.needs_review;
  const filled = rows.filter((row) => !empty(row));
  const missing = rows.filter(empty);
  const render = (row: Row) => (
    <FieldRow
      key={row.path}
      label={row.label}
      field={row.field}
      itemId={itemId}
      path={row.path}
      context={context}
    />
  );
  return (
    <>
      {filled.map(render)}
      {missing.length > 0 && (
        <details className={styles.missing}>
          <summary>
            Không có thông tin ({missing.length}): {missing.map((row) => row.label).join(', ')}
          </summary>
          {missing.map(render)}
        </details>
      )}
    </>
  );
}

function ResultsTable({ results, profile, context, open }: ViewProps & { results: ReportedResult[] }) {
  if (!results.length) return <p className={styles.note}>Chưa có results nào.</p>;
  const metric = (id: string | null) => profile.metrics.find((item) => item.id === id)?.reported_name ?? '—';
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Hệ thống</th>
            <th>Giá trị</th>
            <th>Đơn vị</th>
            <th>Sai số</th>
            <th>Metric</th>
            <th>Nguồn</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {results.map((item) => (
            <tr key={item.id}>
              <td>
                <Button size="sm" variant="ghost" onClick={() => open({ kind: 'result', id: item.id })}>
                  {item.system_or_baseline}
                </Button>
              </td>
              <td>{item.value}</td>
              <td>{item.unit ?? '—'}</td>
              <td>{item.uncertainty ?? '—'}</td>
              <td>{metric(item.metric_usage_id)}</td>
              <td>
                <EvidenceLinks ids={item.evidence_ids} context={context} />
              </td>
              <td>
                <StatusBadges status={item.status} needsReview={item.needs_review} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProtocolMatrix({ profile, open }: Pick<ViewProps, 'profile' | 'open'>) {
  if (!profile.experiments.length) return null;
  return (
    <>
      <h3>Protocol theo thí nghiệm</h3>
      <div className={styles.scroll}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th>Thí nghiệm</th>
              {PROTOCOL_FIELDS.map((key) => (
                <th key={key}>{PROTOCOL_LABELS[key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profile.experiments.map((experiment) => (
              <tr key={experiment.id}>
                <th scope="row">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => open({ kind: 'experiment', id: experiment.id })}
                  >
                    {experiment.name}
                  </Button>
                </th>
                {PROTOCOL_FIELDS.map((key) => {
                  const cell = CELL[experiment.protocol[key].status];
                  return (
                    <td key={key} title={cell.label} aria-label={`${PROTOCOL_LABELS[key]}: ${cell.label}`}>
                      {cell.mark}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>
        ✓ tác giả nêu · ≈ AI diễn giải · ✎ người duyệt sửa · – không thấy · ? chưa kiểm tra · ≠ mâu thuẫn
      </p>
    </>
  );
}

function OverviewDetail({ profile, paper, open }: Pick<ViewProps, 'profile' | 'open'> & { paper: Paper }) {
  const evidence = evidenceRate(profile);
  const heading = (id: string) => paper.sections.find((section) => section.id === id)?.heading ?? id;
  const notRead = [...profile.coverage.failed, ...profile.coverage.not_selected];
  const stat = (value: number, label: string, ref: MeasurementRef) => (
    <div className={styles.overviewStat} key={label}>
      <Stat value={value} label={label} onClick={() => open(ref)} />
    </div>
  );
  return (
    <Card padding="md">
      <div className={styles.overviewHead}>
        <div>
          <h2>Tổng quan hồ sơ measurement</h2>
          <p className={styles.overviewType}>
            Loại bài <Badge tone="accent">{PAPER_TYPE[profile.paper_type]}</Badge>
          </p>
        </div>
        <Badge tone={profile.status === 'partial' ? 'warning' : 'success'}>
          {profile.status === 'partial' ? 'Phân tích một phần' : 'Đã phân tích'}
        </Badge>
      </div>
      <p className={styles.overviewRationale}>{profile.paper_type_rationale}</p>
      {profile.status === 'partial' && (
        <p role="status" className={styles.overviewWarning}>
          Phân tích chưa trọn vẹn.
          {profile.coverage.failed.length > 0 &&
            ` Không đọc được: ${profile.coverage.failed.map(heading).join(', ')}.`}
          {profile.steps.link === 'failed' && ' Bước liên kết không chạy được.'}
          {profile.steps.findings === 'failed' && ' Bước cảnh báo không chạy được.'}
        </p>
      )}
      <div className={styles.overviewStats}>
        {stat(profile.experiments.length, 'thí nghiệm', { kind: 'experiments' })}
        {stat(profile.metrics.length, 'chỉ số', { kind: 'experiments' })}
        {stat(profile.results.length, 'kết quả', { kind: 'experiments' })}
        {stat(profile.claims.length, 'luận điểm', { kind: 'claims' })}
        {profile.atomic_sentences.length > 0 &&
          stat(profile.atomic_sentences.length, 'câu nguyên tử', { kind: 'atomics' })}
        {stat(profile.findings.length, 'cảnh báo AI', { kind: 'findings' })}
        {stat(reviewQueueSize(profile), 'cần xem lại', { kind: 'review' })}
      </div>
      <div className={styles.evidenceCoverage}>
        <span>Evidence có nguồn</span>
        <strong>
          {evidence.withEvidence}/{evidence.total}
          {evidence.rate !== null && ` · ${Math.round(evidence.rate * 100)}%`}
        </strong>
        {evidence.rate !== null && (
          <progress aria-label="Tỷ lệ evidence có nguồn" max={1} value={evidence.rate} />
        )}
      </div>
      <ProtocolMatrix profile={profile} open={open} />
      {notRead.length > 0 && (
        <details className={styles.missing}>
          <summary>{notRead.length} section chưa phân tích</summary>
          <p>{notRead.map(heading).join(', ')}.</p>
        </details>
      )}
      <details className={styles.qualityDetails}>
        <summary>Độ tin cậy và giới hạn hồ sơ</summary>
        <p>
          AI đã bỏ {profile.discarded.unverified_quotes} trích dẫn không tìm lại được trong bài,{' '}
          {profile.discarded.unsupported_findings} cảnh báo không có căn cứ, {profile.discarded.invalid_links}{' '}
          liên kết không hợp lệ. Hồ sơ này không có điểm tổng và không đánh giá phương pháp đúng hay sai.
        </p>
      </details>
    </Card>
  );
}

function metricRows(metric: MetricUsage): Row[] {
  return [
    { label: 'Định nghĩa', field: metric.definition, path: 'definition' },
    { label: 'Công thức (nguyên văn)', field: metric.formula_text, path: 'formula_text' },
    { label: 'Đơn vị', field: metric.unit, path: 'unit' },
    { label: 'Chiều tốt/xấu', field: metric.direction, path: 'direction' },
    { label: 'Phạm vi', field: metric.range, path: 'range' },
    { label: 'Đầu vào', field: metric.method.input_data, path: 'method.input_data' },
    { label: 'Phép tính', field: metric.method.procedure, path: 'method.procedure' },
    { label: 'Nguồn số liệu', field: metric.method.data_source, path: 'method.data_source' },
    { label: 'Tổng hợp', field: metric.method.aggregation, path: 'method.aggregation' },
  ];
}

function ListCard({
  title,
  items,
  empty,
}: {
  title: string;
  items: { key: string; onOpen: () => void; label: string; extra?: ReactNode }[];
  empty: string;
}) {
  return (
    <Card>
      <h2>{title}</h2>
      {items.length === 0 && <p>{empty}</p>}
      <ul className={styles.linkList}>
        {items.map((item) => (
          <li key={item.key}>
            <Button size="sm" variant="ghost" onClick={item.onOpen}>
              {item.label}
            </Button>
            {item.extra}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The right-hand pane: one item in full, chosen from the tree. */
export function MeasurementDetail({
  target,
  paper,
  ...props
}: ViewProps & { target: MeasurementRef; paper: Paper }) {
  const { profile, context, open } = props;
  if (target.kind === 'overview') return <OverviewDetail profile={profile} paper={paper} open={open} />;
  if (target.kind === 'experiments')
    return (
      <Card>
        <h2>Thí nghiệm</h2>
        {profile.experiments.length === 0 && <p>Không tìm thấy thí nghiệm nào trong phần đã phân tích.</p>}
        <ProtocolMatrix profile={profile} open={open} />
      </Card>
    );
  if (target.kind === 'unlinked')
    return (
      <Card>
        <h2>Chưa gắn thí nghiệm</h2>
        <p className={styles.note}>Các mục này chưa nối được với thí nghiệm nào trong bài.</p>
        <ResultsTable {...props} results={profile.results.filter((result) => !result.experiment_id)} />
      </Card>
    );
  if (target.kind === 'claims')
    return (
      <ListCard
        title="Claim của tác giả"
        empty="Không tìm thấy claim nào trong phần đã phân tích."
        items={profile.claims.map((claim) => ({
          key: claim.id,
          label: claim.text,
          onOpen: () => open({ kind: 'claim', id: claim.id }),
          extra: <span className={styles.note}>{claim.linked_result_ids.length} results</span>,
        }))}
      />
    );
  if (target.kind === 'constructs')
    return (
      <ListCard
        title="Thuộc tính đo"
        empty="Không tìm thấy thuộc tính đo nào."
        items={profile.constructs.map((construct) => ({
          key: construct.id,
          label: construct.name,
          onOpen: () => open({ kind: 'construct', id: construct.id }),
        }))}
      />
    );
  if (target.kind === 'findings')
    return (
      <ListCard
        title="Cảnh báo của AI"
        empty="AI không nêu cảnh báo nào."
        items={profile.findings.map((finding) => ({
          key: finding.id,
          label: finding.explanation,
          onOpen: () => open({ kind: 'finding', id: finding.id }),
          extra: <Badge>{FINDING_LABELS[finding.type]}</Badge>,
        }))}
      />
    );
  if (target.kind === 'review')
    return (
      <Card>
        <h2>Cần xem lại</h2>
        <p>Chọn từng mục trong cây bên trái để đối chiếu với nguồn, rồi chấp nhận, sửa hoặc loại bỏ.</p>
        <p className={styles.note}>Còn {reviewQueueSize(profile)} trường và mục cần xem lại.</p>
      </Card>
    );
  if (target.kind === 'taxonomy')
    return (
      <Card>
        <h2>Taxonomy được khảo sát</h2>
        <p>{profile.taxonomy.length} mục trong cây bên trái.</p>
        {profile.review_method && (
          <>
            <h3>Phương pháp tổng quan</h3>
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
          </>
        )}
      </Card>
    );
  if (target.kind === 'taxonomyEntry') {
    const entry = profile.taxonomy.find((item) => item.id === target.id);
    if (!entry) return null;
    return (
      <Card>
        <h2>
          {entry.construct} · {entry.metric}
        </h2>
        <div className={styles.meta}>
          <EvidenceLinks ids={entry.evidence_ids} context={context} />
          <ItemActions itemId={entry.id} context={context} />
        </div>
        <FieldGroup
          itemId={entry.id}
          context={context}
          rows={[
            { label: 'Cách đo', field: entry.how_measured, path: 'how_measured' },
            { label: 'Lĩnh vực', field: entry.domain, path: 'domain' },
          ]}
        />
      </Card>
    );
  }
  if (target.kind === 'experiment') {
    const experiment = profile.experiments.find((item) => item.id === target.id);
    if (!experiment) return null;
    const metrics = profile.metrics.filter((metric) => metric.experiment_ids.includes(experiment.id));
    return (
      <>
        <Card>
          <div className={styles.detailHead}>
            <h2>{experiment.name}</h2>
            <ItemActions itemId={experiment.id} context={context} value={experiment.name} />
          </div>
          <FieldGroup
            itemId={experiment.id}
            context={context}
            rows={PROTOCOL_FIELDS.map((key) => ({
              label: PROTOCOL_LABELS[key],
              field: experiment.protocol[key],
              path: `protocol.${key}`,
            }))}
          />
        </Card>
        <Card>
          <h3>Metric dùng trong thí nghiệm</h3>
          <div className={styles.meta}>
            {metrics.length === 0 && <span className={styles.note}>Chưa có.</span>}
            {metrics.map((metric) => (
              <Button key={metric.id} size="sm" onClick={() => open({ kind: 'metric', id: metric.id })}>
                {metric.reported_name}
              </Button>
            ))}
          </div>
          <h3>Results</h3>
          <ResultsTable
            {...props}
            results={profile.results.filter((result) => result.experiment_id === experiment.id)}
          />
        </Card>
      </>
    );
  }
  if (target.kind === 'metric') {
    const metric = profile.metrics.find((item) => item.id === target.id);
    if (!metric) return null;
    return (
      <>
        <Card>
          <div className={styles.detailHead}>
            <h2>{metric.reported_name}</h2>
            <ItemActions itemId={metric.id} context={context} value={metric.reported_name} />
          </div>
          {metric.aliases.length > 0 && <p className={styles.note}>Tên khác: {metric.aliases.join(', ')}</p>}
          {metric.name_collision && <Badge tone="warning">Trùng tên, định nghĩa có thể khác</Badge>}
          <FieldGroup itemId={metric.id} context={context} rows={metricRows(metric)} />
        </Card>
        <Card>
          <h3>Results dùng metric này</h3>
          <ResultsTable
            {...props}
            results={profile.results.filter((result) => result.metric_usage_id === metric.id)}
          />
        </Card>
      </>
    );
  }
  if (target.kind === 'result') {
    const result = profile.results.find((item) => item.id === target.id);
    if (!result) return null;
    const metric = profile.metrics.find((item) => item.id === result.metric_usage_id);
    const experiment = profile.experiments.find((item) => item.id === result.experiment_id);
    const claims = profile.claims.filter((claim) => claim.linked_result_ids.includes(result.id));
    return (
      <Card>
        <div className={styles.detailHead}>
          <h2>{result.system_or_baseline}</h2>
          <ItemActions itemId={result.id} context={context} value={result.value} />
        </div>
        <p className={styles.bigValue}>
          {[result.value, result.uncertainty && `± ${result.uncertainty}`, result.unit]
            .filter(Boolean)
            .join(' ')}
        </p>
        <div className={styles.meta}>
          <StatusBadges status={result.status} needsReview={result.needs_review} />
          <EvidenceLinks ids={result.evidence_ids} context={context} />
          <AtomicLinks ids={result.atomic_ids} context={context} />
        </div>
        {result.condition && <p>Điều kiện: {result.condition}</p>}
        <div className={styles.meta}>
          {metric && (
            <Button size="sm" onClick={() => open({ kind: 'metric', id: metric.id })}>
              Metric: {metric.reported_name}
            </Button>
          )}
          {experiment && (
            <Button size="sm" onClick={() => open({ kind: 'experiment', id: experiment.id })}>
              Thí nghiệm: {experiment.name}
            </Button>
          )}
        </div>
        {claims.length > 0 && (
          <>
            <h3>Hỗ trợ cho claim</h3>
            <ul className={styles.linkList}>
              {claims.map((claim) => (
                <li key={claim.id}>
                  <Button size="sm" variant="ghost" onClick={() => open({ kind: 'claim', id: claim.id })}>
                    {claim.text}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    );
  }
  if (target.kind === 'claim') {
    const claim = profile.claims.find((item) => item.id === target.id);
    if (!claim) return null;
    return (
      <Card>
        <h2>Claim của tác giả</h2>
        <p className={styles.value}>{claim.text}</p>
        <div className={styles.meta}>
          <StatusBadges status={claim.status} needsReview={claim.needs_review} />
          <EvidenceLinks ids={claim.evidence_ids} context={context} />
          <AtomicLinks ids={claim.atomic_ids} context={context} />
          <ItemActions itemId={claim.id} context={context} value={claim.text} />
        </div>
        {claim.evidence_scope ? (
          <p>
            <Badge>AI diễn giải</Badge> Phạm vi evidence: {claim.evidence_scope}
          </p>
        ) : (
          <p className={styles.note}>Chưa liên kết được với results đã kiểm chứng.</p>
        )}
        <h3>Results liên quan</h3>
        <ResultsTable
          {...props}
          results={profile.results.filter((result) => claim.linked_result_ids.includes(result.id))}
        />
      </Card>
    );
  }
  if (target.kind === 'construct') {
    const construct = profile.constructs.find((item) => item.id === target.id);
    if (!construct) return null;
    const metrics = profile.metrics.filter((metric) => metric.construct_ids.includes(construct.id));
    return (
      <Card>
        <h2>{construct.name}</h2>
        <p>{construct.description}</p>
        <div className={styles.meta}>
          <EvidenceLinks ids={construct.evidence_ids} context={context} />
          <ItemActions itemId={construct.id} context={context} value={construct.name} />
        </div>
        <h3>Đo bằng</h3>
        <div className={styles.meta}>
          {metrics.map((metric) => (
            <Button key={metric.id} size="sm" onClick={() => open({ kind: 'metric', id: metric.id })}>
              {metric.reported_name}
            </Button>
          ))}
        </div>
      </Card>
    );
  }
  if (target.kind === 'atomics') {
    const checked = profile.atomic_sentences.filter((sentence) => sentence.human_checked).length;
    return (
      <Card>
        <h2>Câu nguyên tử</h2>
        <p>
          Đã đối chiếu {checked}/{profile.atomic_sentences.length}
        </p>
        <p className={styles.note}>
          Code đã kiểm tra câu trích, độ dài và con số. Chỉ người đọc mới biết câu có nói đúng điều nguồn nói
          hay không, nên hãy đối chiếu từng câu trước khi dùng lại.
        </p>
        <p className={styles.note}>
          Đã bỏ {profile.discarded.atomic_too_long} câu quá 25 từ, {profile.discarded.atomic_quote_not_found}{' '}
          câu không tìm thấy câu trích, {profile.discarded.atomic_number_not_in_source} câu có số không có
          trong nguồn.
        </p>
      </Card>
    );
  }
  if (target.kind === 'atomicRole')
    return (
      <ListCard
        title={ATOMIC_ROLE_LABELS[target.id as AtomicRole]}
        empty="Không có câu nào."
        items={profile.atomic_sentences
          .filter((sentence) => sentence.role === target.id)
          .map((sentence) => ({
            key: sentence.id,
            label: sentence.text,
            onOpen: () => open({ kind: 'atomic', id: sentence.id }),
            extra: sentence.human_checked ? <Badge tone="success">Đã đối chiếu</Badge> : undefined,
          }))}
      />
    );
  if (target.kind === 'atomic') {
    const atom = profile.atomic_sentences.find((item) => item.id === target.id);
    if (!atom) return null;
    const uses = (ids: string[] | undefined) => ids?.includes(atom.id) ?? false;
    const metrics = profile.metrics.filter((metric) =>
      [
        metric.definition,
        metric.formula_text,
        metric.unit,
        metric.direction,
        metric.range,
        ...Object.values(metric.method),
      ].some((field) => uses(field.atomic_ids)),
    );
    const experiments = profile.experiments.filter((experiment) =>
      PROTOCOL_FIELDS.some((key) => uses(experiment.protocol[key].atomic_ids)),
    );
    const results = profile.results.filter((item) => uses(item.atomic_ids));
    const claims = profile.claims.filter((item) => uses(item.atomic_ids));
    return (
      <Card>
        <h2>Câu nguyên tử</h2>
        <p className={styles.bigValue}>{atom.text}</p>
        <div className={styles.meta}>
          <Badge>{ATOMIC_ROLE_LABELS[atom.role]}</Badge>
          <span>{atom.word_count} từ</span>
          {atom.needs_review && <Badge tone="warning">Cần xem lại</Badge>}
          <EvidenceLinks ids={[atom.evidence_id]} context={context} />
        </div>
        <div className={styles.detailHead}>
          <ItemActions
            itemId={atom.id}
            context={context}
            value={atom.text}
            acceptLabel="Đã đối chiếu với nguồn"
            acceptedLabel="Đã đối chiếu"
          />
        </div>
        {metrics.length + experiments.length + results.length + claims.length > 0 && <h3>Được dùng ở</h3>}
        <div className={styles.meta}>
          {metrics.map((item) => (
            <Button key={item.id} size="sm" onClick={() => open({ kind: 'metric', id: item.id })}>
              Metric: {item.reported_name}
            </Button>
          ))}
          {experiments.map((item) => (
            <Button key={item.id} size="sm" onClick={() => open({ kind: 'experiment', id: item.id })}>
              Thí nghiệm: {item.name}
            </Button>
          ))}
          {results.map((item) => (
            <Button key={item.id} size="sm" onClick={() => open({ kind: 'result', id: item.id })}>
              Results: {item.system_or_baseline}
            </Button>
          ))}
          {claims.map((item) => (
            <Button key={item.id} size="sm" onClick={() => open({ kind: 'claim', id: item.id })}>
              Claim: {item.text.slice(0, 40)}
            </Button>
          ))}
        </div>
      </Card>
    );
  }
  if (!('id' in target)) return null;
  const finding = profile.findings.find((item) => item.id === target.id);
  if (!finding) return null;
  return (
    <FindingCard
      labels={
        <>
          <Badge tone="warning">AI lưu ý</Badge>
          <Badge>{FINDING_LABELS[finding.type]}</Badge>
          <Badge>Mức: {SEVERITY[finding.severity]}</Badge>
        </>
      }
      actions={<ItemActions itemId={finding.id} context={context} value={finding.explanation} />}
    >
      <h2>{FINDING_LABELS[finding.type]}</h2>
      <p>{finding.explanation}</p>
      <p>
        <strong>Câu hỏi cho tác giả: </strong>
        {finding.suggested_question_to_author}
      </p>
      <p className={styles.note}>Giới hạn: {finding.limitation_of_assessment}</p>
      <p className={styles.note}>Đây là câu hỏi để kiểm tra lại, không phải kết luận về lỗi phương pháp.</p>
      <div className={styles.meta}>
        <EvidenceLinks ids={finding.evidence_ids} context={context} />
      </div>
    </FindingCard>
  );
}
