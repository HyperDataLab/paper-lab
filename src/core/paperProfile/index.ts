import { reviewedProfile } from '../measurement/review';
import { paperAnalyses } from '../paperOverview/aggregatePaper';
import type {
  Analysis,
  MeasurementsRecord,
  Paper,
  PaperChecksRecord,
  PaperContextRecord,
  PaperInsightsRecord,
  StanceRecord,
} from '../schemas';
import { languageMetrics, proseParagraphs } from '../academicLanguage';
import { argumentMetrics } from '../argument';
import { CARS_MOVES, rhetoricMetrics, VALIDITY_THREATS } from '../rhetoric';
import { RECENT_YEARS, referenceList, referenceStats } from '../scholarlyContext';
import { stanceMetrics } from '../stance';

/** The place in the paper page that answers an indicator. */
export type ProfileView =
  | 'measure'
  | 'science-checks'
  | 'organization'
  | 'discourse-checks'
  | 'language'
  | 'stance'
  | 'vocabulary'
  | 'writing-checks'
  | 'probe'
  | 'context-checks'
  | 'context-references'
  | 'reporting'
  | 'moves'
  | 'toulmin'
  | 'aif';

export type DimensionId = 'science' | 'argument' | 'discourse' | 'writing' | 'context';
export type DimensionState = 'empty' | 'partial' | 'ready';

export interface ProfileIndicator {
  id: string;
  label: string;
  /** Null until the analysis behind it has run. */
  value: string | null;
  /** `ai` values are candidates a person can still reject; `count` values are computed by code. */
  source: 'count' | 'ai';
  hint?: string;
}

export interface ProfileDimension {
  id: DimensionId;
  letter: string;
  title: string;
  question: string;
  state: DimensionState;
  coverage: string | null;
  indicators: ProfileIndicator[];
  attention: string | null;
  planned: string[];
  target: ProfileView | null;
}

export interface ProfileInput {
  paper: Paper;
  analyses: Analysis[];
  checks?: PaperChecksRecord;
  measurement?: MeasurementsRecord;
  stance?: StanceRecord;
  scholarly?: PaperContextRecord;
  insights?: PaperInsightsRecord;
}

function rhetoricOf(insights: PaperInsightsRecord | undefined) {
  const run = insights?.rhetoricRuns.at(-1);
  return run && insights ? { run, metrics: rhetoricMetrics(run, insights.decisions) } : null;
}

const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const percent = (part: number, whole: number) =>
  whole > 0 ? `${decimal.format((part / whole) * 100)} %` : null;

/** Findings a person has not dismissed; null when the checks have not run. */
function openFindings(checks: PaperChecksRecord | undefined, checkId: string) {
  if (!checks) return null;
  const dismissed = new Set(
    checks.decisions.filter((d) => d.status === 'dismissed_by_human').map((d) => d.findingId),
  );
  const check = checks.report.checks.find((item) => item.id === checkId);
  return check ? check.findings.filter((finding) => !dismissed.has(finding.id)).length : null;
}

const asText = (value: number | null) => (value === null ? null : String(value));

function science({ measurement, checks, insights }: ProfileInput): ProfileDimension {
  const rhetoric = rhetoricOf(insights);
  const run = measurement?.runs.at(-1);
  const profile = run && measurement ? reviewedProfile(run.profile, measurement.decisions, run.id) : null;
  const claims = profile?.claims ?? [];
  const metrics = profile?.metrics ?? [];
  const fields = (profile?.experiments ?? [])
    .flatMap((experiment) => Object.values(experiment.protocol))
    .filter((field) => field.status !== 'NOT_APPLICABLE');
  const stated = (status: string) => status === 'REPORTED' || status === 'HUMAN_EDITED';
  const findings = profile?.findings ?? [];
  const high = findings.filter((finding) => finding.severity === 'high');
  const units = profile
    ? profile.coverage.analysed.length + profile.coverage.failed.length + profile.coverage.not_selected.length
    : 0;
  return {
    id: 'science',
    letter: 'A',
    title: 'Khoa học và Tri thức',
    question: 'Bài khẳng định gì, đo bằng cách nào và dựa trên đâu?',
    state: !profile ? 'empty' : profile.status === 'complete' ? 'ready' : 'partial',
    coverage: profile ? `Đã đọc ${profile.coverage.analysed.length}/${units} mục` : null,
    indicators: [
      {
        id: 'claims_linked',
        label: 'Luận điểm nối được với kết quả',
        value: profile
          ? `${claims.filter((c) => c.linked_result_ids.length > 0).length}/${claims.length}`
          : null,
        source: 'ai',
      },
      {
        id: 'protocol_reported',
        label: 'Protocol được báo cáo',
        value: profile ? percent(fields.filter((f) => stated(f.status)).length, fields.length) : null,
        source: 'ai',
      },
      {
        id: 'metrics_defined',
        label: 'Metric có định nghĩa',
        value: profile
          ? `${metrics.filter((m) => stated(m.definition.status)).length}/${metrics.length}`
          : null,
        source: 'ai',
      },
      {
        id: 'validity_threats',
        label: 'Loại đe doạ validity tác giả nêu',
        value: rhetoric ? `${rhetoric.metrics.threats.length}/${VALIDITY_THREATS.length}` : null,
        source: 'ai',
      },
      {
        id: 'availability',
        label: 'Công bố dữ liệu / code',
        value: rhetoric
          ? `${rhetoric.metrics.availability.includes('data_availability') ? 'Có nêu' : 'Chưa thấy'} / ${rhetoric.metrics.availability.includes('code_availability') ? 'Có nêu' : 'Chưa thấy'}`
          : null,
        source: 'ai',
      },
      {
        id: 'numbers_open',
        label: 'Số liệu cần đối chiếu',
        value: asText(openFindings(checks, 'numbers_consistency')),
        source: 'count',
      },
    ],
    attention: (high[0] ?? findings[0])?.explanation ?? null,
    planned: [],
    target: 'measure',
  };
}

function argument({ insights }: ProfileInput): ProfileDimension {
  const run = insights?.argumentRuns.at(-1);
  const metrics = run && insights ? argumentMetrics(run, insights.decisions) : null;
  const ratio = (value: { count: number; total: number } | undefined) =>
    value && value.total ? `${value.count}/${value.total}` : null;
  return {
    id: 'argument',
    letter: 'B',
    title: 'Lập luận',
    question: 'Các luận điểm có đứng vững về mặt cấu trúc không?',
    state: !run ? 'empty' : run.failedSectionIds.length ? 'partial' : 'ready',
    coverage: run ? `Đã đọc ${run.sectionIds.length} mục` : null,
    indicators: [
      {
        id: 'main_claims',
        label: 'Luận điểm chính',
        value: metrics ? String(metrics.main.length) : null,
        source: 'ai',
      },
      { id: 'with_data', label: 'Luận điểm có dữ liệu', value: ratio(metrics?.withData), source: 'ai' },
      {
        id: 'warrant_stated',
        label: 'Warrant do tác giả nêu',
        value: ratio(metrics?.statedWarrant),
        source: 'ai',
      },
      { id: 'with_rebuttal', label: 'Có xử lý phản biện', value: ratio(metrics?.withRebuttal), source: 'ai' },
    ],
    attention: metrics?.unsupported.length
      ? `${metrics.unsupported.length} luận điểm chính chưa thấy tiền đề.`
      : null,
    planned: [],
    target: 'toulmin',
  };
}

const IMRAD = ['introduction', 'methods', 'results', 'discussion'];
const openIssues = (analyses: Analysis[], categories: string[]) =>
  analyses
    .flatMap((analysis) => analysis.issues)
    .filter(
      (issue) =>
        categories.includes(issue.category) &&
        issue.status !== 'dismissed_by_human' &&
        issue.severity !== 'info',
    ).length;

const stateOf = (done: number, total: number): DimensionState =>
  done === 0 ? 'empty' : done < total ? 'partial' : 'ready';

function discourse({ paper, analyses, checks, insights }: ProfileInput): ProfileDimension {
  const rhetoric = rhetoricOf(insights);
  const selected = [...paperAnalyses(paper, analyses).values()];
  const body = paper.paragraphs.filter((p) => p.kind === 'body').length;
  const structured = selected.filter((a) => a.paragraph !== null && a.paragraph !== undefined);
  const roles = new Set(paper.sections.map((section) => section.role));
  return {
    id: 'discourse',
    letter: 'C',
    title: 'Diễn ngôn và Tu từ',
    question: 'Bài có được tổ chức để dẫn dắt người đọc không?',
    state: stateOf(structured.length, body),
    coverage: `Đã phân tích cấu trúc ${structured.length}/${body} đoạn`,
    indicators: [
      {
        id: 'imrad_roles',
        label: 'Phần IMRaD nhận diện được',
        value: `${IMRAD.filter((role) => roles.has(role as never)).length}/${IMRAD.length}`,
        source: 'count',
      },
      {
        id: 'structure_issues',
        label: 'Vấn đề tổ chức và mạch',
        value: structured.length ? String(openIssues(structured, ['organization', 'flow'])) : null,
        source: 'ai',
      },
      {
        id: 'cars_moves',
        label: 'Moves CARS ở Mở đầu',
        value: rhetoric ? `${rhetoric.metrics.cars.length}/${CARS_MOVES.length}` : null,
        source: 'ai',
      },
      {
        id: 'abstract_supported',
        label: 'Khẳng định Tóm tắt có đoạn tương ứng',
        value: rhetoric?.run.abstractChecked
          ? `${rhetoric.metrics.supported}/${rhetoric.metrics.claims.length}`
          : null,
        source: 'ai',
      },
      {
        id: 'figures_open',
        label: 'Hình và bảng cần kiểm tra',
        value: asText(openFindings(checks, 'figures_tables')),
        source: 'count',
      },
    ],
    attention: null,
    planned: [],
    target: 'organization',
  };
}

function writing({ paper, analyses, stance }: ProfileInput): ProfileDimension {
  const selected = [...paperAnalyses(paper, analyses).values()];
  const body = paper.paragraphs.filter((p) => p.kind === 'body').length;
  const annotated = selected.filter((analysis) => analysis.sentenceAnnotations.length > 0);
  const annotations = annotated.flatMap((analysis) => analysis.sentenceAnnotations);
  const voiced = annotations.filter((annotation) => annotation.voice !== null);
  const distances = annotations.flatMap((annotation) =>
    annotation.subjectVerbDistanceTokens === null ? [] : [annotation.subjectVerbDistanceTokens],
  );
  const words = selected.reduce(
    (sum, analysis) => sum + analysis.text.tokens.filter((token) => token.kind === 'word').length,
    0,
  );
  const issues = openIssues(selected, ['structure', 'word']);
  const density = languageMetrics(proseParagraphs(paper)).lexicalDensity;
  const run = stance?.runs.at(-1);
  const rates = run && stance ? stanceMetrics(run, stance.decisions).stance.rows : null;
  const rate = (category: string) => {
    const value = rates?.find((row) => row.category === category)?.per1000;
    return value === null || value === undefined ? '—' : decimal.format(value);
  };
  return {
    id: 'writing',
    letter: 'D',
    title: 'Viết học thuật',
    question: 'Ngôn ngữ có chính xác và đúng mực không?',
    state: !annotated.length && !run ? 'empty' : annotated.length >= body && run ? 'ready' : 'partial',
    coverage: `Đã phân tích câu ${annotated.length}/${body} đoạn`,
    indicators: [
      {
        id: 'passive_rate',
        label: 'Câu bị động',
        value: percent(voiced.filter((a) => a.voice === 'passive').length, voiced.length),
        source: 'ai',
      },
      {
        id: 'subject_verb',
        label: 'Khoảng cách chủ–vị trung bình (từ)',
        value: distances.length
          ? decimal.format(distances.reduce((a, b) => a + b, 0) / distances.length)
          : null,
        source: 'ai',
      },
      {
        id: 'issue_density',
        label: 'Vấn đề câu và từ trên 1000 từ',
        value: words ? decimal.format((issues / words) * 1000) : null,
        source: 'count',
      },
      {
        id: 'hedge_booster',
        label: 'Rào đón / Nhấn mạnh trên 1000 từ',
        value: rates ? `${rate('hedges')} / ${rate('boosters')}` : null,
        source: 'ai',
      },
      {
        id: 'lexical_density',
        label: 'Mật độ từ nội dung',
        value: density === null ? null : `${decimal.format(density * 100)} %`,
        source: 'count',
      },
    ],
    attention: null,
    planned: ['Danh sách từ học thuật'],
    target: 'language',
  };
}

const FORMATS: Record<Paper['source']['kind'], string> = {
  pdf: 'PDF',
  latex: 'LaTeX',
  markdown: 'Markdown',
  text: 'Văn bản',
};

function context({ paper, checks, scholarly }: ProfileInput): ProfileDimension {
  const open = openFindings(checks, 'citations_references');
  const stats = referenceStats(referenceList(paper));
  const checked = scholarly?.retractionChecked ? scholarly : undefined;
  const retraction = checked?.retracted[0];
  return {
    id: 'context',
    letter: 'E',
    title: 'Bối cảnh học thuật và Nguồn gốc',
    question: 'Bài đứng ở đâu trong tri thức hiện có, và dữ liệu đến từ đâu?',
    state: checks && checked ? 'ready' : checks || checked ? 'partial' : 'empty',
    coverage: checked ? `Đã tra ${checked.found}/${checked.checked} DOI trên OpenAlex` : null,
    indicators: [
      { id: 'references', label: 'Tài liệu tham khảo', value: String(stats.total), source: 'count' },
      {
        id: 'references_recent',
        label: `Trong ${RECENT_YEARS} năm tính đến năm mới nhất được trích`,
        value: percent(stats.recent, stats.withYear),
        source: 'count',
      },
      {
        id: 'retracted',
        label: 'Bài bị rút được ghi nhận',
        value: checked ? String(checked.retracted.length) : null,
        source: 'count',
      },
      { id: 'citations_open', label: 'Phát hiện về trích dẫn còn mở', value: asText(open), source: 'count' },
      { id: 'source_format', label: 'Định dạng nguồn', value: FORMATS[paper.source.kind], source: 'count' },
    ],
    attention: retraction
      ? `${retraction.isPaper ? 'Bài này' : 'Một tài liệu được trích'} được OpenAlex ghi nhận là đã rút: ${retraction.title ?? retraction.doi}.`
      : open
        ? `${open} phát hiện về trích dẫn và tài liệu tham khảo chưa được xử lý.`
        : null,
    planned: ['Chức năng trích dẫn', 'Định vị đóng góp'],
    target: 'context-references',
  };
}

/** One overview per dimension. There is deliberately no total: the dimensions do not share a scale. */
export function buildPaperProfile(input: ProfileInput): ProfileDimension[] {
  return [science(input), argument(input), discourse(input), writing(input), context(input)];
}
