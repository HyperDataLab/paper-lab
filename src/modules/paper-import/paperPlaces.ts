import type { ProfileView } from '@/core/paperProfile';
import type { Criterion } from './criteria';
import type { JobId } from './paperJobs';

export type ViewId =
  | 'data-table'
  | 'openkg'
  | 'extraction'
  | 'profile'
  | 'snapshot'
  | 'metadata'
  | 'map'
  | 'review'
  | 'gap'
  | 'main-claims'
  | 'atomics'
  | 'arguments-issues'
  | 'writing-issues'
  | 'citation-issues'
  | 'issues'
  | ProfileView;
/** The centre column holds the paper: its full text, or its summary. */
export type Pane = 'fulltext' | 'summary';
/**
 * The right column holds what needs the reader's decision and what is known about the paper: Issues,
 * Citations and Paper info. Arguments and Writing style are spaces behind the paper: each opens full width.
 */
export type Mode = 'issues' | 'citations' | 'info' | Space;
export type Space = 'arguments' | 'writing' | 'extract' | 'data' | 'openkg';
export type Place = 'summary' | Mode;
export type BlockId =
  | 'argIssues'
  | 'writingIssues'
  | 'citationIssues'
  | 'gap'
  | 'mainClaims'
  | 'atomics'
  | 'snapshot'
  | 'checks'
  | 'citationChecks'
  | 'argChecks'
  | 'review'
  | 'measure'
  | 'rhetoric'
  | 'arguments'
  | 'batch'
  | 'stance'
  | 'vocabulary'
  | 'references'
  | 'probe'
  | 'metadata';
/**
 * Every analysis is one block in one place: the paper's Summary in the centre column, a tab of the right
 * column, or one of the two spaces. Names are the scientific terms a researcher already uses; the help line under
 * each says, in Vietnamese, what the block answers. Every former view id still opens its block.
 */
export const BLOCKS: Record<
  BlockId,
  {
    place: Place;
    title: string;
    criterion: Criterion;
    job?: JobId;
    views: { id: ViewId; label: string }[];
  }
> = {
  argIssues: {
    place: 'arguments',
    title: 'Issues',
    criterion: 'claim',
    views: [{ id: 'arguments-issues', label: 'Issues' }],
  },
  argChecks: {
    place: 'arguments',
    title: 'Automated checks',
    criterion: 'evidence',
    views: [{ id: 'science-checks', label: 'Numbers & claims' }],
  },
  gap: {
    place: 'arguments',
    title: 'Research gap & contribution',
    criterion: 'claim',
    views: [{ id: 'gap', label: 'Research gap & contribution' }],
  },
  mainClaims: {
    place: 'arguments',
    title: 'Claims & grounds',
    criterion: 'claim',
    views: [{ id: 'main-claims', label: 'Claims & grounds' }],
  },
  atomics: {
    place: 'arguments',
    title: 'Atomic sentences',
    criterion: 'evidence',
    views: [{ id: 'atomics', label: 'Atomic sentences' }],
  },
  snapshot: {
    place: 'summary',
    title: 'Key facts',
    criterion: 'evidence',
    job: 'snapshot',
    views: [{ id: 'snapshot', label: 'Key facts' }],
  },
  references: {
    place: 'citations',
    title: 'References',
    criterion: 'context',
    views: [{ id: 'context-references', label: 'References' }],
  },
  metadata: {
    place: 'info',
    title: 'Publication info',
    criterion: 'context',
    views: [{ id: 'metadata', label: 'Publication info' }],
  },
  arguments: {
    place: 'arguments',
    title: 'Claims & reasoning',
    criterion: 'claim',
    job: 'arguments',
    views: [
      { id: 'toulmin', label: 'Toulmin model' },
      { id: 'aif', label: 'AIF graph' },
    ],
  },
  measure: {
    place: 'arguments',
    title: 'Evidence & measurement',
    criterion: 'evidence',
    job: 'measure',
    views: [{ id: 'measure', label: 'Evidence & measurement' }],
  },
  rhetoric: {
    place: 'arguments',
    title: 'Validity & rhetorical moves',
    criterion: 'claim',
    job: 'rhetoric',
    views: [
      { id: 'reporting', label: 'Validity & data availability' },
      { id: 'moves', label: 'Rhetorical moves & abstract' },
    ],
  },
  writingIssues: {
    place: 'writing',
    title: 'Issues',
    criterion: 'writing',
    views: [{ id: 'writing-issues', label: 'Issues' }],
  },
  checks: {
    place: 'writing',
    title: 'Automated checks',
    criterion: 'writing',
    views: [
      { id: 'discourse-checks', label: 'Figures & tables' },
      { id: 'writing-checks', label: 'Acronyms & claim strength' },
    ],
  },
  batch: {
    place: 'writing',
    title: 'Coherence & sentences',
    criterion: 'writing',
    job: 'batch',
    views: [
      { id: 'organization', label: 'Paragraph structure & flow' },
      { id: 'language', label: 'Sentences & word choice' },
    ],
  },
  stance: {
    place: 'writing',
    title: 'Stance & engagement',
    criterion: 'writing',
    job: 'stance',
    views: [{ id: 'stance', label: 'Stance & engagement' }],
  },
  vocabulary: {
    place: 'writing',
    title: 'Vocabulary & phrases',
    criterion: 'writing',
    views: [{ id: 'vocabulary', label: 'Vocabulary & phrases' }],
  },
  probe: {
    place: 'writing',
    title: 'Score robustness',
    criterion: 'writing',
    job: 'probe',
    views: [{ id: 'probe', label: 'Score robustness' }],
  },
  citationIssues: {
    place: 'citations',
    title: 'Issues',
    criterion: 'context',
    views: [{ id: 'citation-issues', label: 'Issues' }],
  },
  citationChecks: {
    place: 'citations',
    title: 'Citation checks',
    criterion: 'context',
    views: [{ id: 'context-checks', label: 'Citations ↔ references' }],
  },
  review: {
    place: 'arguments',
    title: 'AI peer review',
    criterion: 'claim',
    job: 'review',
    views: [{ id: 'review', label: 'AI peer review' }],
  },
};
export const BLOCK_IDS = Object.keys(BLOCKS) as BlockId[];
export const blockOf = (view: ViewId) =>
  BLOCK_IDS.find((id) => BLOCKS[id].views.some((item) => item.id === view));
/** Where a view opens: the centre column (full text or summary) or a tab of the right column. */
export const placeOf = (view: ViewId): Pane | Mode => {
  if (view === 'data-table') return 'data';
  if (view === 'openkg') return 'openkg';
  if (view === 'extraction') return 'extract';
  if (view === 'issues') return 'issues';
  if (view === 'map') return 'fulltext';
  if (view === 'profile') return 'summary';
  const block = blockOf(view);
  return block ? BLOCKS[block].place : 'summary';
};
export const isPane = (place: Pane | Mode): place is Pane => place === 'fulltext' || place === 'summary';
export const blocksIn = (place: Place) => BLOCK_IDS.filter((id) => BLOCKS[id].place === place);
export const PANES: { id: Pane; label: string }[] = [
  { id: 'fulltext', label: 'Full text' },
  { id: 'summary', label: 'Summary' },
];
export const MODES: { id: Mode; label: string }[] = [
  { id: 'issues', label: 'Issues' },
  { id: 'citations', label: 'Citations' },
];
export const SPACES: { id: Space; label: string }[] = [
  { id: 'arguments', label: 'Arguments' },
  { id: 'writing', label: 'Writing style' },
  { id: 'extract', label: 'Trích xuất' },
  { id: 'data', label: 'Contribution graph' },
  { id: 'openkg', label: 'Đồ thị tri thức (OpenKG)' },
];
export const isSpace = (mode: Mode): mode is Space => SPACES.some((item) => item.id === mode);
export const DEFAULT_VIEW: Record<Mode, ViewId> = {
  data: 'data-table',
  openkg: 'openkg',
  extract: 'extraction',
  arguments: 'gap',
  writing: 'organization',
  issues: 'issues',
  citations: 'context-references',
  info: 'metadata',
};
export const VIEW_HELP: Record<ViewId, string> = {
  'data-table': 'Data table',
  openkg: 'Các lớp tri thức và nguồn của từng mối liên hệ trong bài.',
  extraction: 'Trích xuất',
  issues: 'Mọi phát hiện về bài ở một chỗ.',
  'arguments-issues':
    'Phát hiện về luận điểm và bằng chứng của bài. Được chấp nhận mặc định; bác bỏ những gì không đúng.',
  'writing-issues': 'Phát hiện về cách viết của bài. Được chấp nhận mặc định; bác bỏ những gì không đúng.',
  'citation-issues':
    'Phát hiện về nguồn và trích dẫn của bài. Được chấp nhận mặc định; bác bỏ những gì không đúng.',
  gap: 'Tác giả nói lĩnh vực còn thiếu gì và bài này đóng góp gì, bằng chính câu trong bài.',
  'main-claims':
    'Các luận điểm chính, căn cứ (Grounds) và giới hạn tác giả tự nêu. Bản đầy đủ theo Toulmin ở Claims & reasoning.',
  atomics:
    'Bài được tách thành các câu nguyên tử: mỗi câu một ý kiểm được, có vai trò và câu gốc. Tách khi chạy Evidence & measurement.',
  snapshot: 'Bảy thông tin cốt lõi của nghiên cứu, mỗi giá trị kèm câu trích trong bài.',
  metadata: 'Thông tin xuất bản của bài từ OpenAlex hoặc Thư viện DOI.',
  toulmin:
    'Luận điểm của tác giả và các thành phần theo mô hình Toulmin. Mô tả cấu trúc, không kết luận đúng hay sai.',
  aif: 'Tiền đề dẫn tới kết luận qua bước suy luận nào, và bị phản bác ở đâu.',
  profile:
    'Mỗi chiều trả lời một câu hỏi riêng nên không có điểm tổng. Số có ghi “AI” là ứng viên từ mô hình, bạn có thể bác bỏ khi xem chi tiết.',
  map: 'Đọc bài theo mục lục, xem bảng và đoạn gốc.',
  measure:
    'Bài báo đo gì, bằng metric nào, dưới protocol nào, kết quả ra sao, và các câu nguyên tử làm căn cứ.',
  'science-checks': 'Đối chiếu tự động số liệu và khẳng định trong bài. Không dùng AI.',
  reporting:
    'Tác giả nêu giới hạn validity nào và có công bố dữ liệu, code không. Mô tả việc báo cáo, không kết luận bài đúng hay sai.',
  moves: 'Bài dẫn dắt người đọc thế nào (CARS, các bước ở phần Bàn luận) và Tóm tắt có khớp nội dung không.',
  organization: 'Cách đoạn văn được tổ chức và nối với nhau. Không phải điểm của bài báo.',
  'discourse-checks': 'Hình và bảng có được nhắc đến và đánh số đúng không. Không dùng AI.',
  language: 'Cấu trúc câu và lựa chọn từ theo từng mục. Không phải điểm của bài báo.',
  stance:
    'Cách tác giả thể hiện lập trường và tương tác với người đọc. Đây là số liệu mô tả, không phải điểm.',
  vocabulary: 'Từ vựng, cụm từ lặp lại và so sánh với các bài khác. Không dùng AI.',
  'writing-checks': 'Kiểm tra tự động chữ viết tắt và mức độ khẳng định. Không dùng AI.',
  probe: 'Đo xem điểm của AI có đổi khi chỉ đổi văn phong hay không.',
  'context-checks': 'Trích dẫn trong bài có tài liệu tham khảo tương ứng không. Không dùng AI.',
  'context-references': 'Độ mới của danh sách tài liệu và tình trạng rút bài. Không dùng AI.',
  review: 'Các góc nhìn phản biện của AI, kèm câu trích trong bài. Xuyên suốt các chiều.',
};

/** Where each AI analysis lives, and what it is called in the running-work strip. */
export const JOBS: Record<JobId, { label: string; views: ViewId[] }> = {
  digest: { label: 'Tóm tắt', views: ['profile'] },
  snapshot: { label: 'Key facts', views: ['snapshot'] },
  measure: { label: 'Evidence & measurement', views: ['measure'] },
  rhetoric: { label: 'Validity & rhetorical moves', views: ['reporting', 'moves'] },
  arguments: { label: 'Claims & reasoning', views: ['toulmin', 'aif'] },
  batch: { label: 'Coherence & sentences', views: ['organization', 'language'] },
  stance: { label: 'Stance & engagement', views: ['stance'] },
  probe: { label: 'Score robustness', views: ['probe'] },
  review: { label: 'AI peer review', views: ['review'] },
};
export const JOB_IDS = Object.keys(JOBS) as JobId[];
/** The analyses whose result is per section and can take a run of one section merged into it. */
export const SECTION_JOBS: JobId[] = ['rhetoric', 'arguments', 'stance', 'batch'];
export const isView = (value: string | null): value is ViewId => value !== null && value in VIEW_HELP;
/** The tab of the right column a view belongs to; a centre view leaves the right column on Issues. */
export const modeOf = (view: ViewId): Mode => {
  const place = placeOf(view);
  return isPane(place) ? 'issues' : place;
};
