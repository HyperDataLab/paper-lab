import {
  PROTOCOL_FIELDS,
  type MeasurementDecision,
  type MeasurementProfile,
  type MeasurementRun,
  type ProfileField,
} from '../schemas/measurement';
import { reviewedProfile } from './review';

export const MEASUREMENT_EXPORT_FORMAT = 'paragraph-lab-measurement';

/** AC-07: the export reflects human edits and also carries the AI original and every action. */
export function measurementJson(run: MeasurementRun, decisions: MeasurementDecision[]) {
  return {
    format: MEASUREMENT_EXPORT_FORMAT,
    version: 1,
    profile: reviewedProfile(run.profile, decisions, run.id),
    ai_original: run.profile,
    review_actions: decisions.filter((decision) => decision.run_id === run.id),
  };
}

function csvCell(value: string | null) {
  let text = value ?? '';
  // A text cell starting with these runs as a formula in spreadsheets. Negative numbers are data.
  if (/^[=+@\t\r]/u.test(text) || /^-(?![\d.])/u.test(text)) text = `'${text}`;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csv = (rows: (string | null)[][]) => rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
const fieldCells = (field: ProfileField) => [field.value, field.status, field.needs_review ? 'yes' : 'no'];

function excerpts(profile: MeasurementProfile, ids: string[]) {
  return ids
    .flatMap((id) => {
      const item = profile.evidence.find((evidence) => evidence.id === id);
      if (!item) return [];
      const place = item.cell ? ` r${item.cell.row}c${item.cell.column}` : '';
      return [`p.${item.page ?? '?'} ${item.blockId}${place}`];
    })
    .join('; ');
}

export function metricsCsv(profile: MeasurementProfile) {
  return csv([
    [
      'id',
      'reported_name',
      'aliases',
      'definition',
      'definition_status',
      'definition_needs_review',
      'formula_text',
      'formula_status',
      'formula_needs_review',
      'unit',
      'unit_status',
      'unit_needs_review',
      'direction',
      'direction_status',
      'direction_needs_review',
      'experiments',
      'evidence',
    ],
    ...profile.metrics.map((metric) => [
      metric.id,
      metric.reported_name,
      metric.aliases.join('; '),
      ...fieldCells(metric.definition),
      ...fieldCells(metric.formula_text),
      ...fieldCells(metric.unit),
      ...fieldCells(metric.direction),
      metric.experiment_ids
        .map((id) => profile.experiments.find((item) => item.id === id)?.name ?? id)
        .join('; '),
      excerpts(profile, metric.evidence_ids),
    ]),
  ]);
}

export function protocolCsv(profile: MeasurementProfile) {
  return csv([
    ['experiment', 'field', 'value', 'status', 'needs_review', 'evidence', 'search_scope'],
    ...profile.experiments.flatMap((experiment) =>
      PROTOCOL_FIELDS.map((key) => {
        const field = experiment.protocol[key];
        return [
          experiment.name,
          key,
          ...fieldCells(field),
          excerpts(profile, field.evidence_ids),
          field.search_scope?.join('; ') ?? '',
        ];
      }),
    ),
  ]);
}

const LABEL: Record<ProfileField['status'], string> = {
  REPORTED: 'Tác giả nêu',
  INFERRED: 'AI diễn giải',
  DERIVED: 'AI tính từ số liệu',
  NOT_REPORTED: 'Không thấy trong phần đã phân tích',
  NOT_APPLICABLE: 'Không áp dụng',
  CONTRADICTORY: 'Mâu thuẫn trong bài',
  NOT_CHECKED: 'Chưa kiểm tra',
};
const line = (label: string, field: ProfileField) =>
  `- **${label}:** ${field.value ?? '—'} _(${LABEL[field.status]}${field.needs_review ? ', cần xem lại' : ''})_`;

export function measurementMarkdown(profile: MeasurementProfile) {
  const out: string[] = [
    `# Hồ sơ đo lường: ${profile.title}`,
    '',
    `Loại bài: ${profile.paper_type}. Model: ${profile.model_id}. Prompt: ${profile.prompt_version}. Parser: ${profile.parser_version ?? 'không rõ'}.`,
    '',
    'Hồ sơ này không có điểm tổng và không đánh giá phương pháp đúng hay sai.',
    '',
    '## Tác giả nêu và AI diễn giải: Metric',
  ];
  for (const metric of profile.metrics)
    out.push(
      '',
      `### ${metric.reported_name}`,
      line('Định nghĩa', metric.definition),
      line('Công thức', metric.formula_text),
      line('Đơn vị', metric.unit),
      line('Chiều tốt/xấu', metric.direction),
      line('Phép tính', metric.method.procedure),
      line('Tổng hợp', metric.method.aggregation),
    );
  out.push('', '## Tác giả nêu và AI diễn giải: Protocol');
  for (const experiment of profile.experiments) {
    out.push('', `### ${experiment.name}`);
    for (const key of PROTOCOL_FIELDS) out.push(line(key, experiment.protocol[key]));
  }
  out.push('', '## Tác giả nêu: Kết quả', '');
  for (const result of profile.results) {
    const uncertainty = result.uncertainty ? ` ± ${result.uncertainty}` : '';
    const flag = result.status === 'REPORTED' ? '' : ' _(chưa kiểm chứng được)_';
    const review = result.needs_review ? ' _(cần xem lại)_' : '';
    out.push(
      `- ${result.system_or_baseline}: ${result.value}${uncertainty} ${result.unit ?? ''} [${excerpts(profile, result.evidence_ids) || 'không có nguồn'}]${flag}${review}`,
    );
  }
  out.push('', '## Claim', '');
  for (const claim of profile.claims)
    out.push(
      `- ${claim.text}${claim.evidence_scope ? ` — _AI diễn giải phạm vi:_ ${claim.evidence_scope}` : ''}`,
    );
  if (profile.taxonomy.length) {
    out.push('', '## Taxonomy được khảo sát', '');
    for (const entry of profile.taxonomy) out.push(`- ${entry.construct} · ${entry.metric}`);
  }
  out.push('', '## AI lưu ý', '');
  for (const finding of profile.findings)
    out.push(
      `- **${finding.type}** (${finding.severity}): ${finding.explanation} Câu hỏi: ${finding.suggested_question_to_author} Giới hạn: ${finding.limitation_of_assessment}`,
    );
  return `${out.join('\n')}\n`;
}
