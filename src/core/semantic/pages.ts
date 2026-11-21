import { KG_TABLE_CONCEPTS } from './kgSchema';

/**
 * Semantic layer, step 2: the page map (docs/plans/SEMANTIC_LAYER.md). One entry per route the app serves, with
 * the concepts each page shows, reads and writes, and its main actions. Plain data, so `core` stays free of `app`
 * and `modules`; `src/app/semanticPages.test.ts` compares it with the real route and module registry.
 *
 * Facts come from the page components: `reads` are the records a page loads, `shows` what it puts on screen,
 * `writes` what any of its actions saves. An action with `ai: true` calls the LLM and is gated on consent.
 */

export interface PageParam {
  /** A `:name` in the path, or a query parameter. */
  name: string;
  /** The concept whose id the parameter carries. */
  concept: string;
}

export interface PageAction {
  labelVi: string;
  /** What the action does, in Vietnamese. */
  effect: string;
  writes?: readonly string[];
  /** Calls the LLM; the app asks for privacy consent first. */
  ai?: boolean;
}

export interface PageTab {
  id: string;
  labelVi: string;
  /** How the tab is addressed: a query parameter value such as `view=gap`, or `state` when it is not in the URL. */
  via: string;
}

export interface Page {
  id: string;
  /** A react-router pattern; `:name` matches one path segment. */
  path: string;
  /** The folder under `src/modules` that renders the page. */
  module: string;
  titleVi: string;
  name: string;
  purpose: string;
  params: readonly PageParam[];
  query: readonly PageParam[];
  shows: readonly string[];
  reads: readonly string[];
  writes: readonly string[];
  actions: readonly PageAction[];
  /**
   * Behind the shell's `StorageProvider` gate: without a ResearchHub project and a HyperDataLab SSO session the
   * page shows the project or sign-in card instead.
   */
  requiresSignIn: boolean;
  /** The page a person comes from (its id). */
  parent?: string;
  tabs?: readonly PageTab[];
}

type PageInput = Omit<Page, 'params' | 'query' | 'requiresSignIn'> &
  Partial<Pick<Page, 'params' | 'query' | 'requiresSignIn'>>;

const page = (input: PageInput): Page => ({
  params: [],
  query: [],
  requiresSignIn: true,
  ...input,
});

const PAPER_PANES: PageTab[] = [
  { id: 'fulltext', labelVi: 'Full text', via: 'pane=fulltext' },
  { id: 'summary', labelVi: 'Summary', via: 'pane=summary' },
  { id: 'issues', labelVi: 'Issues', via: 'view=issues' },
  { id: 'citations', labelVi: 'Citations', via: 'view=context-references' },
  { id: 'info', labelVi: 'Publication info', via: 'view=metadata' },
  { id: 'arguments', labelVi: 'Arguments', via: 'view=gap' },
  { id: 'writing', labelVi: 'Writing style', via: 'view=organization' },
  { id: 'extract', labelVi: 'Trích xuất', via: 'view=extraction' },
  { id: 'data', labelVi: 'Contribution graph', via: 'view=data-table' },
  { id: 'openkg', labelVi: 'Đồ thị tri thức (OpenKG)', via: 'view=openkg' },
];

const RESEARCH_DESIGN_SECTIONS: PageTab[] = [
  { id: 'topic', labelVi: 'Topic và research gaps', via: 'design=topic' },
  { id: 'questions', labelVi: 'Research questions và hypotheses', via: 'design=questions' },
  { id: 'design', labelVi: 'Research design', via: 'design=design' },
  { id: 'measurement', labelVi: 'Measurement', via: 'design=measurement' },
  { id: 'bank', labelVi: 'Writing Bank', via: 'design=bank' },
  { id: 'analyses', labelVi: 'Statistical analysis', via: 'design=analyses' },
  { id: 'runs', labelVi: 'Ma trận chạy', via: 'design=runs' },
  { id: 'evidence', labelVi: 'Bảng so sánh', via: 'design=evidence' },
  { id: 'package', labelVi: 'Gói kế hoạch', via: 'design=package' },
  { id: 'autoresearch', labelVi: 'AutoResearch', via: 'ar=S1' },
];

export const PAGES: readonly Page[] = [
  page({
    id: 'home',
    path: '/',
    module: 'home',
    titleVi: 'Trang chủ',
    name: 'Home',
    purpose:
      'Điểm bắt đầu: mở lại bài báo và project gần đây, xem số bài, project và corpus, hoặc mở project mới từ một research question.',
    shows: ['paper', 'extraction-project', 'corpus'],
    reads: ['paper', 'paper-context', 'extraction-project', 'corpus'],
    writes: ['extraction-project'],
    actions: [
      {
        labelVi: 'Bắt đầu project',
        effect: 'Tạo extraction project mới với research question đã nhập rồi mở project đó.',
        writes: ['extraction-project'],
      },
    ],
  }),
  page({
    id: 'papers',
    path: '/papers',
    module: 'paper-import',
    titleVi: 'Bài báo',
    name: 'Papers',
    purpose:
      'Nhập bài báo (PDF, LaTeX, Markdown, text) để tách thành section và paragraph, và quản lý Thư viện DOI.',
    shows: ['paper', 'library-item'],
    reads: ['paper', 'paper-context', 'library-item'],
    writes: ['paper', 'original-pdf', 'library-item'],
    tabs: [
      { id: 'papers', labelVi: 'Bài đã nhập', via: 'state' },
      { id: 'library', labelVi: 'Thư viện DOI', via: 'state' },
    ],
    actions: [
      {
        labelVi: 'Nhập bài báo',
        effect:
          'Tách tệp trên máy thành paper; PDF gốc được lưu vào kho lab (R2). Bài trùng mã băm được mở lại.',
        writes: ['paper', 'original-pdf'],
      },
      {
        labelVi: 'Xoá bài báo',
        effect: 'Xoá paper và gỡ liên kết của nó khỏi Thư viện DOI.',
        writes: ['paper'],
      },
      {
        labelVi: 'Thêm và tra cứu',
        effect: 'Thêm DOI (dán hoặc từ tệp CSV) vào Thư viện và tra cứu metadata.',
        writes: ['library-item'],
      },
      {
        labelVi: 'Xoá khỏi thư viện',
        effect: 'Xoá các mục đã chọn khỏi Thư viện DOI.',
        writes: ['library-item'],
      },
    ],
  }),
  page({
    id: 'paper',
    path: '/papers/:id',
    module: 'paper-import',
    titleVi: 'Bài báo',
    name: 'Paper workspace',
    purpose:
      'Không gian đọc một bài báo: full text và PDF, Summary, Issues, Citations, và các không gian Arguments, Writing style, Trích xuất, Contribution graph, OpenKG. Mọi kết quả AI là ứng viên để người dùng duyệt.',
    parent: 'papers',
    params: [{ name: 'id', concept: 'paper' }],
    query: [{ name: 'p', concept: 'paragraph' }],
    tabs: PAPER_PANES,
    shows: [
      'paper',
      'paper-section',
      'paragraph',
      'original-pdf',
      'paper-context',
      'grobid',
      'reference',
      'paper-checks',
      'paper-check',
      'paper-insights',
      'rhetoric-item',
      'argument',
      'contribution-sentence',
      'measurement',
      'measurement-profile',
      'construct',
      'metric-usage',
      'experiment',
      'reported-result',
      'research-claim',
      'stance',
      'stance-marker',
      'style-probe',
      'paper-review',
      'review-point',
      'paper-overview',
      'analysis',
      'issue',
      'scg-run',
      'scg-contribution',
      'extraction-project',
      'extraction-field',
      'extraction-cell',
    ],
    reads: [
      'paper',
      'original-pdf',
      'paper-context',
      'grobid',
      'paper-checks',
      'paper-insights',
      'measurement',
      'stance',
      'style-probe',
      'paper-review',
      'paper-overview',
      'analysis',
      'audit-event',
      'paper-run',
      'paper-checkpoint-part',
      'scg-run',
      'library-item',
      'extraction-project',
    ],
    writes: [
      'paper',
      'original-pdf',
      'paper-context',
      'paper-checks',
      'paper-insights',
      'measurement',
      'stance',
      'style-probe',
      'paper-review',
      'paper-overview',
      'analysis',
      'paper-run',
      'paper-checkpoint-part',
      'scg-run',
      'extraction-project',
      'extraction-cell',
    ],
    actions: [
      {
        labelVi: 'Chạy tất cả',
        effect: 'Chạy lần lượt các phân tích AI còn thiếu của bài.',
        writes: ['paper-insights', 'measurement', 'stance', 'style-probe', 'paper-review', 'analysis'],
        ai: true,
      },
      {
        labelVi: 'Tóm tắt',
        effect: 'Tạo bản tóm tắt (digest) của bài.',
        writes: ['paper-insights'],
        ai: true,
      },
      {
        labelVi: 'Key facts',
        effect: 'Trích bảy thông tin cốt lõi của nghiên cứu, mỗi giá trị kèm câu trích.',
        writes: ['paper-insights'],
        ai: true,
      },
      {
        labelVi: 'Research gap & contribution',
        effect: 'Tìm các câu nêu research gap và contribution của bài.',
        writes: ['paper-insights'],
        ai: true,
      },
      {
        labelVi: 'Claims & reasoning',
        effect: 'Dựng các argument theo Toulmin và AIF, theo từng section.',
        writes: ['paper-insights'],
        ai: true,
      },
      {
        labelVi: 'Validity & rhetorical moves',
        effect: 'Gắn nhãn threats to validity, data availability và các rhetorical moves.',
        writes: ['paper-insights'],
        ai: true,
      },
      {
        labelVi: 'Evidence & measurement',
        effect: 'Trích constructs, metrics, experiments, results và claims kèm câu nguyên tử làm căn cứ.',
        writes: ['measurement'],
        ai: true,
      },
      {
        labelVi: 'Coherence & sentences',
        effect: 'Phân tích từng paragraph thân bài theo lô, có checkpoint, và mạch nối giữa các paragraph.',
        writes: ['analysis', 'paper-run', 'paper-checkpoint-part', 'paper-overview'],
        ai: true,
      },
      {
        labelVi: 'Stance & engagement',
        effect: 'Gắn nhãn stance và engagement markers theo section.',
        writes: ['stance'],
        ai: true,
      },
      {
        labelVi: 'Chạy kiểm tra độ bền (AI)',
        effect: 'Đo xem điểm AI có đổi khi chỉ đổi văn phong hay không.',
        writes: ['style-probe'],
        ai: true,
      },
      {
        labelVi: 'AI peer review',
        effect: 'Lấy các góc nhìn phản biện của AI kèm câu trích; người dùng ghi chú và duyệt từng điểm.',
        writes: ['paper-review'],
        ai: true,
      },
      {
        labelVi: 'Dựng contribution graph',
        effect: 'Trích contributions và prerequisites của bài thành một SCG run; người dùng duyệt kết quả.',
        writes: ['scg-run'],
        ai: true,
      },
      {
        labelVi: 'Kiểm tra tự động',
        effect: 'Chạy các kiểm tra không dùng AI (số liệu, hình bảng, viết tắt, trích dẫn ↔ references).',
        writes: ['paper-checks'],
      },
      {
        labelVi: 'Chấp nhận / loại bỏ phát hiện',
        effect: 'Ghi quyết định của người dùng cho một phát hiện vào bản ghi nguồn của nó.',
        writes: ['paper-checks', 'paper-insights', 'measurement', 'stance', 'paper-review', 'analysis'],
      },
      {
        labelVi: 'Đổi vai trò section',
        effect: 'Sửa vai trò (role) của section đang chọn.',
        writes: ['paper'],
      },
      {
        labelVi: 'Thông tin xuất bản',
        effect: 'Tra metadata (OpenAlex hoặc Thư viện DOI) và cho người dùng sửa.',
        writes: ['paper-context'],
      },
      {
        labelVi: 'Gắn PDF gốc',
        effect: 'Tải PDF gốc lên kho lab cho bài chưa có PDF.',
        writes: ['original-pdf'],
      },
      { labelVi: 'Lấy lại từ GROBID', effect: 'Yêu cầu GROBID phân tích lại bài; kết quả hiện ở Citations.' },
      {
        labelVi: 'Đối chiếu tài liệu với Crossref',
        effect: 'Kiểm tra references với Crossref, không dùng AI.',
      },
      {
        labelVi: 'Trích xuất',
        effect: 'Mở bảng trích xuất riêng của bài và cho mô hình điền các ô, kèm câu trích làm căn cứ.',
        writes: ['extraction-project', 'extraction-cell'],
        ai: true,
      },
      { labelVi: 'Công bố paper model', effect: 'Công bố mô hình bài báo và experiment facts lên kho lab.' },
    ],
  }),
  page({
    id: 'extraction',
    path: '/extraction',
    module: 'extraction',
    titleVi: 'Projects',
    name: 'Extraction projects',
    purpose: 'Danh sách các extraction project: tạo, mở hoặc xoá một project.',
    shows: ['extraction-project'],
    reads: ['extraction-project'],
    writes: ['extraction-project'],
    actions: [
      {
        labelVi: 'Tạo project',
        effect: 'Tạo extraction project mới rồi mở nó.',
        writes: ['extraction-project'],
      },
      { labelVi: 'Xoá project', effect: 'Xoá extraction project đã chọn.', writes: ['extraction-project'] },
    ],
  }),
  page({
    id: 'extraction-project',
    path: '/extraction/:id',
    module: 'extraction',
    titleVi: 'Project',
    name: 'Extraction project',
    purpose:
      'Một project nghiên cứu: liên kết corpus chủ đề, lập Research design hoặc chạy AutoResearch, và deep research (kế hoạch tìm kiếm, tìm bài, sàng lọc, tổng hợp có trích dẫn).',
    parent: 'extraction',
    params: [{ name: 'id', concept: 'extraction-project' }],
    query: [{ name: 'arRun', concept: 'autoresearch-run' }],
    tabs: RESEARCH_DESIGN_SECTIONS,
    shows: [
      'extraction-project',
      'extraction-paper',
      'corpus',
      'research-design',
      'topic-check',
      'research-question',
      'hypothesis',
      'design-type',
      'threat-to-validity',
      'variable',
      'design-metric',
      'dataset',
      'condition',
      'statistical-analysis',
      'run-matrix',
      'frozen-plan',
      'research-design-bank',
      'autoresearch-run',
      'charter',
      'autoresearch-stage',
      'stage-artifact',
      'obligation',
    ],
    reads: [
      'extraction-project',
      'corpus',
      'research-design',
      'research-design-bank',
      'paper',
      'measurement',
      'autoresearch-run',
    ],
    writes: [
      'extraction-project',
      'extraction-paper',
      'corpus',
      'research-design',
      'research-design-bank',
      'autoresearch-run',
    ],
    actions: [
      {
        labelVi: 'Liên kết với Extraction',
        effect: 'Liên kết project với một corpus chủ đề đã có.',
        writes: ['extraction-project'],
      },
      {
        labelVi: 'Tạo corpus từ dự án',
        effect: 'Tạo corpus chủ đề từ project rồi liên kết hai bên.',
        writes: ['corpus', 'extraction-project'],
      },
      {
        labelVi: 'Đề xuất kế hoạch (AI)',
        effect: 'Mô hình đề xuất queries và tiêu chí chọn/loại cho research question.',
        writes: ['extraction-project'],
        ai: true,
      },
      {
        labelVi: 'Duyệt kế hoạch',
        effect: 'Người dùng sửa rồi duyệt kế hoạch tìm kiếm.',
        writes: ['extraction-project'],
      },
      {
        labelVi: 'Tìm theo kế hoạch',
        effect: 'Tìm bài trên OpenAlex theo các query đã duyệt và gộp vào danh sách ứng viên.',
        writes: ['extraction-project'],
      },
      {
        labelVi: 'Mở rộng theo trích dẫn',
        effect: 'Tìm bài trích dẫn và được trích bởi các bài đã chọn (OpenAlex).',
        writes: ['extraction-project'],
      },
      {
        labelVi: 'Gợi ý sàng lọc (AI)',
        effect: 'Mô hình chấm điểm từng ứng viên theo lô, có checkpoint; chỉ là đề xuất.',
        writes: ['extraction-project'],
        ai: true,
      },
      {
        labelVi: 'Chọn / Loại / Chưa chắc',
        effect: 'Ghi quyết định sàng lọc của người dùng, hoặc nhận một nhóm đề xuất của AI sau khi xác nhận.',
        writes: ['extraction-project'],
      },
      {
        labelVi: 'Đưa bài đã chọn vào ma trận',
        effect: 'Thêm các ứng viên đã chọn vào danh sách bài của project.',
        writes: ['extraction-project', 'extraction-paper'],
      },
      {
        labelVi: 'Tổng hợp (AI)',
        effect: 'Tổng hợp liên bài: chủ đề chung, điểm thống nhất, khác biệt và research gap, kèm trích dẫn.',
        writes: ['extraction-project'],
        ai: true,
      },
      {
        labelVi: 'Sửa Research design',
        effect:
          'Sửa topic check, research questions, hypotheses, design, measurement, analyses và ma trận chạy.',
        writes: ['research-design'],
      },
      {
        labelVi: 'Gợi ý dữ kiện (AI)',
        effect: 'Mô hình gợi ý dữ kiện cho bảng so sánh; người dùng nhận hoặc bỏ.',
        writes: ['research-design'],
        ai: true,
      },
      {
        labelVi: 'Nhập Writing Bank',
        effect: 'Nhập một nguồn Writing Bank vào Research design.',
        writes: ['research-design-bank', 'research-design'],
      },
      {
        labelVi: 'Đóng băng',
        effect: 'Đóng băng gói kế hoạch thành một phiên bản cố định.',
        writes: ['research-design'],
      },
      {
        labelVi: 'Tạo run',
        effect: 'Tạo AutoResearch run cho project, bắt đầu từ charter.',
        writes: ['autoresearch-run'],
      },
      {
        labelVi: 'Chạy stage AutoResearch',
        effect: 'Agent chạy một stage; kết quả dừng ở phiếu duyệt để người dùng duyệt hoặc từ chối.',
        writes: ['autoresearch-run'],
        ai: true,
      },
      {
        labelVi: 'Chép vào Research design',
        effect: 'Chép hypotheses hoặc experiment design của AutoResearch vào Research design.',
        writes: ['research-design'],
      },
    ],
  }),
  page({
    id: 'corpus',
    path: '/corpus',
    module: 'corpus',
    titleVi: 'Corpus',
    name: 'Corpora',
    purpose: 'Danh sách corpus: tập bài báo có tiêu chí chọn rõ ràng. Tạo corpus chủ đề hoặc corpus tạp chí.',
    shows: ['corpus', 'corpus-member', 'corpus-protocol', 'corpus-release'],
    reads: ['corpus'],
    writes: ['corpus', 'corpus-protocol'],
    actions: [
      {
        labelVi: 'Corpus mới',
        effect: 'Tạo corpus với giao thức v1 (research question và tiêu chí, hoặc tạp chí và năm).',
        writes: ['corpus', 'corpus-protocol'],
      },
      { labelVi: 'Tạo cặp ESWA', effect: 'Tạo sẵn một cặp corpus cho tạp chí ESWA.', writes: ['corpus'] },
      { labelVi: 'Xuất manifest', effect: 'Tải manifest JSON của corpus.' },
      { labelVi: 'Xoá', effect: 'Xoá corpus đã chọn.', writes: ['corpus'] },
    ],
  }),
  page({
    id: 'corpus-detail',
    path: '/corpus/:id',
    module: 'corpus',
    titleVi: 'Corpus',
    name: 'Corpus detail',
    purpose:
      'Một corpus: thêm và sàng lọc bài, PRISMA và MMAT, thu thập PDF và dựng paper model, gắn nhãn, profile, chủ đề, keywords, lộ trình contribution, OpenKG, rồi phát hành một bản có mã băm.',
    parent: 'corpus',
    params: [{ name: 'id', concept: 'corpus' }],
    shows: [
      'corpus',
      'corpus-member',
      'screening-decision',
      'corpus-protocol',
      'search-record',
      'corpus-release',
      'corpus-profile',
      'corpus-topics',
      'corpus-topic',
      'topic-name',
      'corpus-keywords',
      'doi-keywords',
      'scg-run',
      'scg-contribution',
      'scg-prerequisite',
      'kg-paper',
    ],
    reads: [
      'corpus',
      'paper',
      'paper-context',
      'paper-insights',
      'stance',
      'library-item',
      'scg-run',
      'corpus-profile',
      'corpus-topics',
      'topic-name',
      'corpus-keywords',
      'doi-keywords',
    ],
    writes: [
      'corpus',
      'corpus-member',
      'screening-decision',
      'corpus-protocol',
      'search-record',
      'corpus-release',
      'paper',
      'original-pdf',
      'paper-insights',
      'stance',
      'scg-run',
      'corpus-profile',
      'corpus-topics',
      'topic-name',
      'corpus-keywords',
      'doi-keywords',
      'kg-ingest-queue',
    ],
    actions: [
      {
        labelVi: 'Thêm bài vào corpus',
        effect: 'Thêm bài từ Library, từ bài đã nhập hoặc danh sách DOI; bài trùng được gộp hoặc hỏi lại.',
        writes: ['corpus-member'],
      },
      {
        labelVi: 'Tìm bài / Nhập kết quả tìm kiếm',
        effect: 'Corpus chủ đề: tìm bài, nhập kết quả tìm kiếm hoặc snowball, ghi lại search record.',
        writes: ['corpus-member', 'search-record'],
      },
      {
        labelVi: 'Sàng lọc bằng AI',
        effect: 'Mô hình chấm điểm sàng lọc từng bài theo lô; người dùng quyết định chọn hay loại.',
        writes: ['screening-decision'],
        ai: true,
      },
      {
        labelVi: 'Lưu đánh giá',
        effect: 'Lưu đánh giá chất lượng MMAT 2018 của một bài.',
        writes: ['corpus-member'],
      },
      {
        labelVi: 'Lấy mẫu từ OpenAlex',
        effect: 'Corpus tạp chí: lấy mẫu bài của các tạp chí trong giao thức.',
        writes: ['corpus-member'],
      },
      {
        labelVi: 'Lấy PDF',
        effect: 'Lấy PDF cho các bài đang tìm, nhập thành paper và cập nhật trạng thái thu thập.',
        writes: ['corpus-member', 'paper', 'original-pdf'],
      },
      {
        labelVi: 'Dựng paper model',
        effect: 'Dựng đầu vào mô hình cho từng bài đã lấy, theo hàng đợi có thể tạm dừng.',
        writes: ['corpus'],
      },
      {
        labelVi: 'Bắt đầu gắn nhãn',
        effect: 'Gắn nhãn rhetoric, argument và stance cho các bài trong corpus theo hàng đợi.',
        writes: ['paper-insights', 'stance', 'corpus'],
        ai: true,
      },
      { labelVi: 'Tính profile', effect: 'Tính profile của corpus tạp chí.', writes: ['corpus-profile'] },
      {
        labelVi: 'Tính chủ đề trên máy chủ',
        effect: 'Tính topic model cho corpus trên máy chủ và lưu snapshot.',
        writes: ['corpus-topics'],
      },
      {
        labelVi: 'Đặt tên chủ đề (AI)',
        effect: 'Mô hình đề xuất tên cho từng chủ đề.',
        writes: ['topic-name'],
        ai: true,
      },
      {
        labelVi: 'Lấy keywords',
        effect: 'Lấy keywords cho các bài theo DOI và tổng hợp keywords của corpus.',
        writes: ['doi-keywords', 'corpus-keywords'],
      },
      {
        labelVi: 'Lộ trình contribution',
        effect: 'Dựng contribution graph cho các bài trong corpus và nối chúng thành lộ trình.',
        writes: ['scg-run'],
        ai: true,
      },
      {
        labelVi: 'Đưa vào KG của lab',
        effect: 'Gửi các bài của corpus vào hàng đợi ingest của KG lab.',
        writes: ['kg-ingest-queue'],
      },
      {
        labelVi: 'Sửa giao thức',
        effect: 'Lưu giao thức thành phiên bản mới; phiên bản cũ được giữ nguyên.',
        writes: ['corpus-protocol'],
      },
      {
        labelVi: 'Phát hành',
        effect: 'Chốt danh sách bài thành một release có mã băm để dẫn lại về sau.',
        writes: ['corpus-release'],
      },
      { labelVi: 'Xuất manifest', effect: 'Tải manifest JSON của corpus.' },
    ],
  }),
  page({
    id: 'lab-kg',
    path: '/lab-kg',
    module: 'lab-kg',
    titleVi: 'KG của lab',
    name: 'Lab knowledge graph',
    purpose:
      'Xem knowledge graph chung của lab, hỏi bằng câu tiếng Việt hoặc tiếng Anh, tìm một nút và đưa bài còn thiếu vào KG.',
    shows: KG_TABLE_CONCEPTS.map(({ id }) => id),
    reads: [...KG_TABLE_CONCEPTS.map(({ id }) => id), 'paper-context', 'corpus'],
    writes: ['kg-ingest-queue'],
    actions: [
      { labelVi: 'Hỏi KG (AI)', effect: 'Dùng AI để tạo SQL chỉ đọc và xem kết quả truy vấn KG.', ai: true },
      { labelVi: 'Tìm trong KG', effect: 'Tìm bài hoặc keyword trong KG của lab.' },
      { labelVi: 'Đặt làm tâm', effect: 'Vẽ lại đồ thị quanh nút đã chọn.' },
      {
        labelVi: 'Đưa vào KG',
        effect: 'Gửi bài còn thiếu, các bài ngoài đồ thị hoặc cả một corpus vào hàng đợi ingest.',
        writes: ['kg-ingest-queue'],
      },
      { labelVi: 'Tải RDF', effect: 'Tải đồ thị đang xem dưới dạng JSON-LD hoặc Turtle.' },
    ],
  }),
  page({
    id: 'transfer',
    path: '/transfer',
    module: 'transfer',
    titleVi: 'Xuất/Nhập',
    name: 'Export and import',
    purpose:
      'Xuất toàn bộ dữ liệu của người dùng từ kho lab thành một tệp JSON, hoặc nhập lại tệp đó sau khi xem trước thay đổi.',
    shows: ['analysis', 'audit-event', 'revision', 'generation', 'paper', 'calibration-label-set'],
    reads: [
      'analysis',
      'audit-event',
      'revision',
      'generation',
      'paper',
      'paper-overview',
      'paper-checks',
      'paper-review',
      'style-probe',
      'calibration-label-set',
      'measurement',
      'library-item',
      'stance',
      'paper-insights',
      'extraction-project',
      'corpus',
      'corpus-profile',
      'research-design',
      'research-design-bank',
      'autoresearch-run',
    ],
    writes: [
      'analysis',
      'audit-event',
      'revision',
      'generation',
      'paper',
      'paper-overview',
      'paper-checks',
      'paper-review',
      'style-probe',
      'calibration-label-set',
      'measurement',
      'library-item',
      'stance',
      'paper-insights',
      'extraction-project',
      'corpus',
      'corpus-profile',
      'research-design',
      'research-design-bank',
      'autoresearch-run',
    ],
    actions: [
      { labelVi: 'Xuất toàn bộ (JSON)', effect: 'Tải gói xuất chứa mọi bản ghi của người dùng.' },
      {
        labelVi: 'Nhập',
        effect:
          'Xem trước rồi nhập các bản ghi từ tệp đã xuất; bản ghi đã có được giữ hoặc thay theo kế hoạch nhập.',
        writes: [
          'analysis',
          'audit-event',
          'revision',
          'generation',
          'paper',
          'calibration-label-set',
          'extraction-project',
          'corpus',
          'research-design',
          'autoresearch-run',
        ],
      },
    ],
  }),
  page({
    id: 'playground',
    path: '/playground',
    module: 'playground',
    titleVi: 'Playground',
    name: 'Playground',
    purpose:
      'Thử trực tiếp các công cụ nghiên cứu của lab (lab research server): chọn công cụ, điền input và xem kết quả. Danh sách công cụ chỉ hiện khi đã đăng nhập.',
    shows: [],
    reads: [],
    writes: [],
    actions: [
      {
        labelVi: 'Chạy công cụ',
        effect: 'Gọi công cụ đã chọn với input đã điền; kết quả chỉ giữ trong phiên.',
      },
    ],
  }),
  page({
    id: 'admin-requests',
    path: '/admin/requests',
    module: 'admin',
    titleVi: 'Duyệt yêu cầu',
    name: 'Request review',
    purpose:
      'Chỉ quản trị viên: duyệt hoặc từ chối các yêu cầu công bố dữ kiện của bài báo do thành viên lab gửi.',
    shows: ['paper'],
    reads: ['paper'],
    writes: [],
    actions: [
      { labelVi: 'Duyệt', effect: 'Chấp nhận yêu cầu công bố của một bài.' },
      { labelVi: 'Từ chối', effect: 'Từ chối yêu cầu kèm lý do.' },
    ],
  }),
  page({
    id: 'settings',
    path: '/settings',
    module: 'settings',
    titleVi: 'Cài đặt',
    name: 'Settings',
    purpose:
      'Kết nối AI (endpoint, model, API key), giới hạn chạy, email tra cứu bài báo, quyền riêng tư (đồng ý gửi dữ liệu cho AI) và tài khoản lab.',
    shows: [],
    reads: [],
    writes: ['corpus'],
    actions: [
      { labelVi: 'Lưu', effect: 'Lưu cấu hình AI, giới hạn chạy hoặc email tra cứu trên trình duyệt này.' },
      { labelVi: 'Kiểm tra kết nối', effect: 'Gửi một yêu cầu thử tới AI.', ai: true },
      { labelVi: 'Thu hồi đồng ý', effect: 'Thu hồi đồng ý gửi dữ liệu cho AI.' },
      { labelVi: 'Đăng nhập / Đăng xuất', effect: 'Đăng nhập hoặc đăng xuất bằng HyperDataLab SSO.' },
      {
        labelVi: 'Nhập corpus cũ',
        effect: 'Chuyển các corpus cũ của tài khoản vào kho lab.',
        writes: ['corpus'],
      },
    ],
  }),
  page({
    id: 'report',
    path: '/report/:id',
    module: 'report',
    titleVi: 'Báo cáo',
    name: 'Analysis report',
    purpose:
      'Bản in của một bản phân tích paragraph: văn bản gốc, câu, cấu trúc, số liệu, điểm, issues, bản sửa hoặc nguồn soạn, giới hạn và phiên bản.',
    params: [{ name: 'id', concept: 'analysis' }],
    shows: ['analysis', 'sentence', 'sentence-annotation', 'issue', 'audit-event', 'revision', 'generation'],
    reads: ['analysis', 'audit-event', 'revision', 'generation'],
    writes: [],
    actions: [{ labelVi: 'In / Lưu PDF', effect: 'Mở hộp thoại in của trình duyệt.' }],
  }),
  page({
    id: 'compare',
    path: '/compare',
    module: 'report',
    titleVi: 'So sánh',
    name: 'Version comparison',
    purpose:
      'So sánh hai bản phân tích (thường là bản gốc và bản sửa): số liệu, điểm, issues và kiểm tra ý nghĩa.',
    query: [
      { name: 'a', concept: 'analysis' },
      { name: 'b', concept: 'analysis' },
    ],
    shows: ['analysis', 'issue', 'revision'],
    reads: ['analysis', 'revision'],
    writes: [],
    actions: [],
  }),
];
