const metricFieldWords: Record<string, string> = {
  key: 'key',
  unit: 'đơn vị',
  goal: 'hướng tốt',
  aggregation: 'cách gộp',
  protocol: 'quy trình đo',
};
const runFieldWords: Record<string, string> = {
  mlflowExperiment: 'tên experiment',
  conditions: 'điều kiện',
  datasets: 'dataset',
  seeds: 'seed',
  sampleSizeJustification: 'lý do số lần chạy',
};
import type { Missing } from '@/core/researchDesign/draft/freezeGate';
import type { Draft } from '@/core/researchDesign/draft/schema';
import type { ExperimentPlan } from '@/core/researchDesign/plan/schema';
import { TWO_SAMPLE, type PlanIssue } from '@/core/researchDesign/plan/validatePlan';

const rules: Record<string, string> = {
  'PP-01': 'Mỗi đối tượng phải có mã duy nhất.',
  'PP-02': 'Mọi liên kết phải trỏ tới đối tượng trong kế hoạch.',
  'PP-03': 'Lưới chạy phải liệt kê mỗi giá trị một lần và có số lần chạy đúng.',
  'PP-04': 'Mỗi metric phải dùng key MLflow riêng và không trùng tag của kế hoạch.',
  'PP-05': 'Mỗi hypothesis xác nhận phải có phân tích định trước.',
  'PP-06': 'Mỗi dependent variable phải có metric.',
  'PP-07': 'Phép so sánh nên có baseline.',
  'PP-08': 'Phương pháp phân tích nên được SRD hỗ trợ.',
  'PP-09': 'Phiên bản sau phải ghi thay đổi so với phiên bản trước.',
  'PP-10': 'Phân tích phải so sánh điều kiện trong lưới và đúng số lượng cho phương pháp.',
};
export const ruleText = (rule: string) => rules[rule] ?? 'Quy tắc kế hoạch chưa được nhận diện.';
export function issueText(issue: PlanIssue, plan: ExperimentPlan): string {
  const subject = issue.subject ?? 'Kế hoạch';
  if (issue.rule === 'PP-02') {
    const reference = /refers to the missing (\w+) ([^.]+)\./.exec(issue.message);
    const kinds: Record<string, string> = {
      hypothesis: 'hypothesis',
      variable: 'variable',
      metric: 'metric',
      dataset: 'dataset',
      condition: 'điều kiện',
      analysis: 'phân tích',
    };
    if (reference?.[1] && reference[2])
      return `${subject} liên kết đến ${kinds[reference[1]] ?? 'đối tượng'} ${reference[2]} không có trong kế hoạch.`;
  }
  if (issue.rule === 'PP-03') {
    const duplicate = /runMatrix\.(\w+) lists (.+) twice\./.exec(issue.message);
    if (duplicate?.[1] && duplicate[2])
      return `Lưới chạy liệt kê ${duplicate[2]} hai lần trong ${fields[duplicate[1]] ?? duplicate[1]}.`;
    return `Lưới chạy ghi ${plan.runMatrix.expectedRuns} lần chạy nhưng có ${plan.runMatrix.conditions.length * plan.runMatrix.datasets.length * plan.runMatrix.seeds.length} ô.`;
  }
  if (issue.rule === 'PP-04') {
    const key = /"([^"]+)"/.exec(issue.message)?.[1];
    if (key)
      return issue.subject
        ? `${subject} dùng key ${key} dành cho tag của kế hoạch.`
        : `Nhiều metric dùng key MLflow ${key}.`;
  }
  if (issue.rule === 'PP-05') return `${subject} chưa có phân tích định trước.`;
  if (issue.rule === 'PP-06') return `${subject} chưa có metric.`;
  if (issue.rule === 'PP-07') return 'Lưới chạy so sánh các điều kiện nhưng chưa có baseline.';
  if (issue.rule === 'PP-08') return `${subject} dùng phương pháp SRD chưa hỗ trợ ở bản đầu.`;
  if (issue.rule === 'PP-09')
    return plan.planVersion === 1
      ? 'Phiên bản 1 không có phiên bản trước để ghi thay đổi.'
      : `Phiên bản ${plan.planVersion} cần ghi thay đổi so với phiên bản trước.`;
  if (issue.rule === 'PP-10') {
    const analysis = plan.analyses.find((a) => a.id === issue.subject);
    const absent = analysis?.conditions.find(
      (c) => plan.conditions.some((x) => x.id === c) && !plan.runMatrix.conditions.includes(c),
    );
    if (absent && issue.message.includes(absent))
      return `${subject} so sánh ${absent}, điều kiện không nằm trong lưới chạy.`;
    if (analysis && TWO_SAMPLE.includes(analysis.method)) return `${subject} cần so sánh đúng hai điều kiện.`;
  }
  return `${subject}: ${ruleText(issue.rule)}`;
}
const names: Record<Missing['code'], string> = {
  no_hypotheses: 'Chưa có hypothesis nào',
  candidate_hypothesis: 'cần được xác nhận trong Research questions và hypotheses',
  candidate_design: 'Cần xác nhận ứng viên AutoResearch',
  no_variables: 'Chưa có variable nào',
  no_metrics: 'Chưa có metric nào',
  no_datasets: 'Chưa có dataset nào',
  no_conditions: 'Chưa có điều kiện nào',
  hypothesis_without_dependent: 'chưa có dependent variable',
  metric_incomplete: 'còn thiếu',
  dataset_without_source: 'chưa ghi nguồn',
  analysis_without_method: 'chưa chọn phương pháp',
  analysis_without_variables: 'chưa chọn variable',
  grid_incomplete: 'Lưới chạy còn thiếu',
  design_without_assignment: 'research design chưa có cách phân nhóm',
  threat_without_mitigation: 'chưa ghi cách giảm',
  other: 'Kế hoạch chưa hợp lệ',
};
const fields: Record<string, string> = { ...metricFieldWords, ...runFieldWords };
export function missingText(missing: Missing, draft: Draft): string {
  const label = [...draft.threats, ...draft.metrics, ...draft.datasets].find(
    (item) => item.id === missing.subject,
  )?.name;
  return `${missing.subject ? `${missing.subject}${label ? ` «${label}»` : ''} ` : ''}${names[missing.code]}${missing.fields?.length ? `: ${missing.fields.map((f) => fields[f] ?? f).join(', ')}` : ''}${missing.text ? `: ${missing.text}` : ''}.`;
}
export function missingLink(missing: Missing): string {
  const destination: Record<Missing['code'], string> = {
    no_hypotheses: 'questions',
    candidate_hypothesis: 'questions',
    candidate_design: missing.subject ?? 'design',
    hypothesis_without_dependent: 'questions',
    no_variables: 'measurement',
    no_metrics: 'measurement',
    metric_incomplete: 'measurement',
    no_datasets: 'measurement',
    dataset_without_source: 'measurement',
    no_conditions: 'measurement',
    analysis_without_method: 'analyses',
    analysis_without_variables: 'analyses',
    grid_incomplete: 'runs',
    design_without_assignment: 'design',
    threat_without_mitigation: 'design',
    other: 'questions',
  };
  return `?design=${destination[missing.code]}`;
}
