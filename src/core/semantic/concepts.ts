import type { CollectionName } from '../storage/collections';

/**
 * Semantic layer, step 1: the concepts PaperLab knows (docs/plans/SEMANTIC_LAYER.md). Plain data only, so the
 * MCP server and agents can read it without loading the zod schemas. Field names are checked against the real
 * schemas and the KG migrations by `concepts.test.ts`; only descriptions, synonyms and relations are hand-written.
 */

export type ConceptStore =
  /** A top-level record of the central store (D1 `doc` row, body in R2 or inline). */
  | { kind: 'central'; collection: CollectionName }
  /** A table of the lab KG (D1, `worker/migrations/*.sql`). */
  | { kind: 'kg'; table: string }
  /** A derived table in the central store's D1 (`worker/migrations-data/*.sql`), such as the passage index. */
  | { kind: 'data-table'; table: string }
  /** An object inside another concept's record. `path` is dotted; `[]` steps into array elements. */
  | { kind: 'nested'; parent: string; path: string }
  /** Raw objects in R2 under a key prefix. */
  | { kind: 'r2'; prefix: string };

export interface ConceptField {
  /** Dotted path relative to the concept (e.g. `identifiers.doi`); a column name for KG tables. */
  name: string;
  description: string;
}

export type RelationKind = 'has-many' | 'belongs-to' | 'refers-to';

export interface ConceptRelation {
  to: string;
  kind: RelationKind;
  /** The field (or KG column / edge table) that carries the link. */
  via: string;
}

/** Where the zod schema of a concept is exported, when one is. */
export interface SchemaRef {
  file: string;
  export: string;
}

export interface Concept {
  id: string;
  name: string;
  labelVi: string;
  description: string;
  synonyms: readonly string[];
  store: ConceptStore;
  fields: readonly ConceptField[];
  relations: readonly ConceptRelation[];
  schema?: SchemaRef;
}

type FieldList = readonly (readonly [name: string, description: string])[];
type RelationList = readonly (readonly [kind: RelationKind, to: string, via: string])[];

interface ConceptInput {
  id: string;
  name: string;
  labelVi: string;
  description: string;
  synonyms: readonly string[];
  store: ConceptStore;
  fields: FieldList;
  relations?: RelationList;
  schema?: readonly [file: string, exportName: string];
}

function concept(input: ConceptInput): Concept {
  return {
    id: input.id,
    name: input.name,
    labelVi: input.labelVi,
    description: input.description,
    synonyms: input.synonyms,
    store: input.store,
    fields: input.fields.map(([name, description]) => ({ name, description })),
    relations: (input.relations ?? []).map(([kind, to, via]) => ({ to, kind, via })),
    ...(input.schema ? { schema: { file: input.schema[0], export: input.schema[1] } } : {}),
  };
}

const central = (collection: CollectionName): ConceptStore => ({ kind: 'central', collection });
const nested = (parent: string, path: string): ConceptStore => ({ kind: 'nested', parent, path });
const kg = (table: string): ConceptStore => ({ kind: 'kg', table });
const dataTable = (table: string): ConceptStore => ({ kind: 'data-table', table });

const S = 'src/core/schemas/';
const DRAFT = 'src/core/researchDesign/draft/schema.ts';

// ---------------------------------------------------------------------------------------------------------------
// Papers and their text
// ---------------------------------------------------------------------------------------------------------------

const PAPER_CONCEPTS: Concept[] = [
  concept({
    id: 'paper',
    name: 'Paper',
    labelVi: 'Bài báo',
    description:
      'Một bài báo đã nạp vào PaperLab (từ PDF hoặc văn bản), đã chia thành Section và Paragraph. Tệp PDF gốc nằm riêng trong R2, theo sha256.',
    synonyms: ['bài báo', 'bài', 'paper', 'article', 'manuscript', 'bản thảo', 'tài liệu'],
    store: central('papers'),
    fields: [
      ['id', 'Mã bài báo trong PaperLab.'],
      ['title', 'Tiêu đề (Title) người dùng đặt hoặc đọc từ tệp.'],
      ['source.kind', 'Định dạng nguồn: pdf, latex, markdown hoặc text.'],
      ['source.sha256', 'Mã băm của tệp gốc, cũng là khoá của PDF trong R2.'],
      ['source.pageCount', 'Số trang của PDF.'],
      ['sections', 'Danh sách Section theo thứ tự trong bài.'],
      ['paragraphs', 'Danh sách Paragraph, mỗi đoạn gắn với một Section.'],
      ['createdAt', 'Thời điểm nạp.'],
    ],
    relations: [
      ['has-many', 'paper-section', 'sections'],
      ['has-many', 'paragraph', 'paragraphs'],
      ['refers-to', 'original-pdf', 'source.sha256'],
    ],
    schema: [`${S}paper.ts`, 'PaperSchema'],
  }),
  concept({
    id: 'paper-section',
    name: 'Section',
    labelVi: 'Mục của bài báo',
    description:
      'Một mục (Section) của bài báo như Abstract, Introduction, Methods, Results, Discussion; `role` là vai trò chuẩn hoá của tiêu đề mục.',
    synonyms: ['section', 'mục', 'phần', 'chương mục', 'heading', 'tiêu đề mục', 'IMRaD'],
    store: nested('paper', 'sections[]'),
    fields: [
      ['id', 'Mã mục, duy nhất trong bài.'],
      ['heading', 'Tiêu đề mục như trong bài.'],
      ['role', 'Vai trò chuẩn hoá: Abstract, Introduction, Methods, Results, Discussion…'],
      ['level', 'Cấp tiêu đề.'],
      ['pageStart', 'Trang bắt đầu.'],
      ['combined', 'Các vai trò khi một tiêu đề gộp nhiều phần ("Results and discussion").'],
    ],
    schema: [`${S}paper.ts`, 'SectionSchema'],
  }),
  concept({
    id: 'paragraph',
    name: 'Paragraph',
    labelVi: 'Đoạn văn',
    description:
      'Một Paragraph trong bài báo, thuộc một Section. Có thể là đoạn văn thường, chú thích bảng hay công thức (`kind`).',
    synonyms: ['đoạn văn', 'đoạn', 'paragraph', 'para', 'khối văn bản'],
    store: nested('paper', 'paragraphs[]'),
    fields: [
      ['id', 'Mã đoạn, duy nhất trong bài.'],
      ['sectionId', 'Mục chứa đoạn.'],
      ['order', 'Thứ tự trong bài.'],
      ['text', 'Văn bản gốc, không bị chỉnh sửa.'],
      ['kind', 'Loại khối: body, caption, equation, list, reference, heading_like, footnote hoặc table.'],
      ['textHash', 'Mã băm văn bản, đổi khi văn bản đổi.'],
      ['pageStart', 'Trang bắt đầu.'],
      ['table', 'Nội dung bảng khi khối là bảng.'],
    ],
    relations: [['belongs-to', 'paper-section', 'sectionId']],
    schema: [`${S}paper.ts`, 'PaperParagraphSchema'],
  }),
  concept({
    id: 'analysis',
    name: 'Paragraph analysis',
    labelVi: 'Kết quả đánh giá đoạn',
    description:
      'Kết quả đánh giá một đoạn theo Schimel: tách câu, Topic / Action / Stress, liên kết giữa các câu, điểm theo rubric và các vấn đề (issue). Đoạn có thể đến từ bài báo, bản sửa hoặc bản sinh.',
    synonyms: ['analysis', 'evaluation', 'đánh giá', 'phân tích', 'chấm điểm đoạn', 'evaluate'],
    store: central('analyses'),
    fields: [
      ['id', 'Mã kết quả.'],
      ['title', 'Tên do người dùng đặt.'],
      ['text', 'Văn bản nguồn, câu và token với offset tính bằng code.'],
      ['text.sourceHash', 'Mã băm văn bản nguồn.'],
      ['sentenceAnnotations', 'Chú thích từng câu: Topic, Action, Stress, vai trò, giọng.'],
      ['paragraph', 'Loại đoạn, central point và tính thống nhất.'],
      ['flowLinks', 'Liên kết giữa các câu liền nhau (continuity, discourse relation).'],
      ['scores', 'Điểm theo rubric, kèm coverage, confidence và rubric version.'],
      ['issues', 'Các vấn đề phát hiện được.'],
      ['origin', 'Nguồn của đoạn: paper, generation hoặc revision.'],
      ['origin.paperId', 'Bài báo chứa đoạn, khi đoạn lấy từ bài báo.'],
      ['origin.paragraphId', 'Đoạn trong bài báo.'],
      ['parentAnalysisId', 'Kết quả trước khi đánh giá lại.'],
      ['versions', 'Phiên bản prompt, model, rubric, detector đã dùng.'],
    ],
    relations: [
      ['has-many', 'sentence', 'text.sentences'],
      ['has-many', 'sentence-annotation', 'sentenceAnnotations'],
      ['has-many', 'issue', 'issues'],
      ['refers-to', 'paper', 'origin.paperId'],
      ['refers-to', 'paragraph', 'origin.paragraphId'],
      ['refers-to', 'generation', 'origin.generationId'],
      ['refers-to', 'revision', 'origin.revisionId'],
      ['refers-to', 'analysis', 'parentAnalysisId'],
    ],
    schema: [`${S}analysis.ts`, 'AnalysisSchema'],
  }),
  concept({
    id: 'sentence',
    name: 'Sentence',
    labelVi: 'Câu',
    description:
      'Một câu của đoạn đã đánh giá, với offset bắt đầu / kết thúc do code tính. Câu nằm trong kết quả đánh giá, không nằm trực tiếp trong Paper.',
    synonyms: ['câu', 'sentence', 'câu văn'],
    store: nested('analysis', 'text.sentences[]'),
    fields: [
      ['id', 'Mã câu trong đoạn.'],
      ['start', 'Offset bắt đầu (code point).'],
      ['end', 'Offset kết thúc, không bao gồm.'],
      ['tokenStart', 'Token đầu tiên.'],
      ['tokenEnd', 'Token cuối, không bao gồm.'],
    ],
    schema: [`${S}text.ts`, 'SentenceSchema'],
  }),
  concept({
    id: 'sentence-annotation',
    name: 'Sentence annotation',
    labelVi: 'Chú thích câu',
    description:
      'Phân tích cấu trúc một câu: Topic, Action, Stress, chủ ngữ và động từ, khoảng cách chủ ngữ – động từ, giọng chủ động / bị động.',
    synonyms: [
      'topic',
      'action',
      'stress',
      'topic position',
      'stress position',
      'chủ ngữ',
      'động từ',
      'bị động',
      'passive voice',
    ],
    store: nested('analysis', 'sentenceAnnotations[]'),
    fields: [
      ['sentenceId', 'Câu được chú thích.'],
      ['topicSpan', 'Vị trí Topic.'],
      ['actionSpan', 'Vị trí Action.'],
      ['stressSpan', 'Vị trí Stress.'],
      ['role', 'Vai trò của câu trong đoạn.'],
      ['subjectVerbDistanceTokens', 'Khoảng cách chủ ngữ – động từ, null khi không chắc.'],
      ['voice', 'Chủ động hay bị động.'],
    ],
    relations: [['refers-to', 'sentence', 'sentenceId']],
    schema: [`${S}analysis.ts`, 'SentenceAnnotationSchema'],
  }),
  concept({
    id: 'issue',
    name: 'Issue',
    labelVi: 'Vấn đề viết',
    description:
      'Một vấn đề trong đoạn: ứng viên cần xem lại, gợi ý văn phong hoặc vi phạm đã xác nhận. Trạng thái đi từ candidate đến quyết định của người.',
    synonyms: ['issue', 'vấn đề', 'lỗi', 'finding', 'phát hiện', 'review candidate', 'ứng viên cần xem lại'],
    store: nested('analysis', 'issues[]'),
    fields: [
      ['id', 'Mã vấn đề.'],
      ['type', 'Loại vấn đề.'],
      ['category', 'Nhóm vấn đề.'],
      ['status', 'candidate, confirmed_by_model, confirmed_by_human hoặc dismissed_by_human.'],
      ['severity', 'Mức độ.'],
      ['spans', 'Vị trí trong văn bản.'],
      ['why', 'Giải thích.'],
      ['suggestedFix', 'Gợi ý sửa.'],
      ['confidence', 'Độ tin cậy.'],
    ],
    schema: [`${S}issue.ts`, 'IssueSchema'],
  }),
  concept({
    id: 'audit-event',
    name: 'Audit event',
    labelVi: 'Nhật ký quyết định',
    description: 'Một quyết định của người hoặc hệ thống về một issue, ghi lại trước và sau khi đổi.',
    synonyms: ['audit', 'audit log', 'nhật ký', 'lịch sử quyết định', 'decision log'],
    store: central('auditEvents'),
    fields: [
      ['id', 'Mã sự kiện.'],
      ['analysisId', 'Kết quả đánh giá chứa issue.'],
      ['issueId', 'Issue được quyết định.'],
      ['actor', 'Ai thực hiện.'],
      ['action', 'Hành động.'],
      ['before', 'Giá trị trước.'],
      ['after', 'Giá trị sau.'],
      ['at', 'Thời điểm.'],
    ],
    relations: [
      ['belongs-to', 'analysis', 'analysisId'],
      ['refers-to', 'issue', 'issueId'],
    ],
    schema: [`${S}audit.ts`, 'AuditEventSchema'],
  }),
  concept({
    id: 'revision',
    name: 'Revision',
    labelVi: 'Bản sửa',
    description:
      'Bản sửa của một đoạn đã đánh giá cho các issue được chọn, kèm diff và kiểm tra giữ nghĩa. Không thêm dữ kiện, số hay tài liệu.',
    synonyms: ['revision', 'revise', 'bản sửa', 'sửa đoạn', 'rewrite', 'viết lại'],
    store: central('revisions'),
    fields: [
      ['id', 'Mã bản sửa.'],
      ['sourceAnalysisId', 'Kết quả đánh giá của đoạn gốc.'],
      ['revisedText', 'Văn bản đã sửa.'],
      ['hunks', 'Các khối thay đổi của diff.'],
      ['changes', 'Thay đổi và issue mà nó giải quyết.'],
      ['needsEvidence', 'Chỗ cần thêm Evidence, không được tự bịa.'],
      ['checks', 'Kiểm tra giữ nghĩa (hedging, phủ định, số liệu…).'],
      ['appliedIssueIds', 'Các issue đã áp dụng.'],
      ['model', 'Model đã dùng.'],
    ],
    relations: [
      ['belongs-to', 'analysis', 'sourceAnalysisId'],
      ['refers-to', 'issue', 'appliedIssueIds'],
    ],
    schema: [`${S}revision.ts`, 'RevisionSchema'],
  }),
  concept({
    id: 'generation',
    name: 'Paragraph generation',
    labelVi: 'Đoạn sinh từ Claim',
    description:
      'Một đoạn do AI soạn từ Claim chính và Evidence người dùng cung cấp, kèm vai trò từng câu và kiểm tra neo vào Evidence.',
    synonyms: ['generation', 'generate', 'sinh đoạn', 'soạn đoạn', 'draft', 'bản nháp'],
    store: central('generations'),
    fields: [
      ['id', 'Mã bản sinh.'],
      ['input.mainClaim', 'Claim chính.'],
      ['input.evidence', 'Evidence người dùng đưa vào.'],
      ['paragraph', 'Đoạn đã sinh.'],
      ['sentences', 'Câu và Evidence mỗi câu dùng.'],
      ['needsEvidence', 'Chỗ còn thiếu Evidence.'],
      ['checks', 'Kiểm tra neo và Evidence chưa dùng.'],
      ['model', 'Model đã dùng.'],
    ],
    schema: [`${S}generation.ts`, 'GenerationSchema'],
  }),
  concept({
    id: 'original-pdf',
    name: 'Original PDF',
    labelVi: 'Tệp PDF gốc',
    description: 'Tệp PDF gốc của bài báo, lưu nguyên vẹn trong R2 với khoá là sha256 của tệp.',
    synonyms: ['pdf', 'tệp pdf', 'file gốc', 'original pdf', 'bản pdf'],
    store: { kind: 'r2', prefix: 'paperlab/pdfs/' },
    fields: [],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Paper workspace records (one record per paper)
// ---------------------------------------------------------------------------------------------------------------

const PAPER_RECORD_CONCEPTS: Concept[] = [
  concept({
    id: 'paper-run',
    name: 'Paper run',
    labelVi: 'Lượt chạy theo bài',
    description:
      'Một lượt đánh giá hàng loạt các đoạn của một bài báo, có kế hoạch, ngân sách lượt gọi AI và tiến độ từng đoạn. Bản lớn được chia thành các phần checkpoint.',
    synonyms: ['paper run', 'batch', 'chạy hàng loạt', 'lượt chạy', 'tiến độ'],
    store: central('paperRuns'),
    fields: [
      ['id', 'Mã lượt chạy.'],
      ['paperId', 'Bài báo.'],
      ['status', 'Trạng thái.'],
      ['plan', 'Kế hoạch: mục, bước, đoạn và đoạn bỏ qua.'],
      ['budget', 'Ngân sách lượt gọi AI.'],
      ['callsUsed', 'Số lượt gọi đã dùng.'],
      ['items', 'Tiến độ từng đoạn.'],
      ['parts', 'Các phần checkpoint của bản manifest.'],
      ['model', 'Model đã dùng.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'paper-checkpoint-part', 'parts'],
    ],
    schema: [`${S}paperRun.ts`, 'PaperRunSchema'],
  }),
  concept({
    id: 'paper-checkpoint-part',
    name: 'Paper run checkpoint part',
    labelVi: 'Phần checkpoint của lượt chạy',
    description:
      'Một phần của checkpoint lượt chạy theo bài, tách ra để mỗi lần ghi vừa giới hạn kích thước. Dữ liệu bên trong là chuỗi đã mã hoá.',
    synonyms: ['checkpoint', 'chunk', 'phần lưu tạm'],
    store: central('paperCheckpointParts'),
    fields: [
      ['id', 'Mã phần.'],
      ['paperId', 'Bài báo.'],
      ['kind', 'chunk hoặc measurement.'],
      ['refId', 'Mã chunk.'],
      ['data', 'Dữ liệu đã mã hoá.'],
    ],
    relations: [['belongs-to', 'paper', 'paperId']],
    schema: ['src/core/storage/paperCheckpoints.ts', 'PaperCheckpointPartSchema'],
  }),
  concept({
    id: 'paper-overview',
    name: 'Paper overview',
    labelVi: 'Tổng quan bài báo',
    description:
      'Tổng hợp kết quả đánh giá các đoạn của một bài báo theo mục: độ phủ, issue lặp lại, phân bố điểm, và đánh giá chuyển tiếp giữa các đoạn.',
    synonyms: ['overview', 'tổng quan', 'tóm tắt kết quả', 'transitions', 'chuyển đoạn'],
    store: central('paperOverviews'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['overview', 'Số liệu tổng hợp theo bài và theo mục.'],
      ['overview.recurringIssues', 'Các issue lặp lại ở nhiều đoạn.'],
      ['transitions', 'Đánh giá chuyển tiếp giữa các cặp đoạn.'],
    ],
    relations: [['belongs-to', 'paper', 'paperId']],
    schema: [`${S}paperOverview.ts`, 'PaperOverviewRecordSchema'],
  }),
  concept({
    id: 'paper-checks',
    name: 'Paper checks',
    labelVi: 'Kiểm tra toàn bài',
    description:
      'Các kiểm tra trên toàn bài: số liệu nhất quán, Claim không có chỗ dựa, hình và bảng, viết tắt, độ mạnh Claim, trích dẫn. Kèm quyết định của người.',
    synonyms: ['paper checks', 'kiểm tra', 'consistency', 'acronyms', 'viết tắt', 'figures tables'],
    store: central('paperChecks'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['report', 'Báo cáo kiểm tra.'],
      ['report.checks', 'Kết quả từng kiểm tra.'],
      ['decisions', 'Quyết định của người với từng finding.'],
      ['reviewedAt', 'Lần xem gần nhất.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'paper-check', 'report.checks'],
    ],
    schema: [`${S}paperChecks.ts`, 'PaperChecksRecordSchema'],
  }),
  concept({
    id: 'paper-check',
    name: 'Paper check result',
    labelVi: 'Kết quả một kiểm tra',
    description: 'Kết quả một kiểm tra toàn bài (ví dụ numbers_consistency) với trạng thái và các finding.',
    synonyms: ['check', 'check result', 'kết quả kiểm tra'],
    store: nested('paper-checks', 'report.checks[]'),
    fields: [
      ['id', 'Loại kiểm tra.'],
      ['label', 'Tên hiển thị.'],
      ['status', 'pass, warn, fail hoặc not_applicable.'],
      ['summary', 'Tóm tắt.'],
      ['findings', 'Các finding cùng vị trí.'],
    ],
    schema: [`${S}paperChecks.ts`, 'CheckResultSchema'],
  }),
  concept({
    id: 'paper-review',
    name: 'AI review panel',
    labelVi: 'Phản biện AI',
    description:
      'Các lượt phản biện AI theo nhiều lens (góc nhìn), các ý đã gộp và neo vào văn bản, ghi chú của người viết trước khi xem, và quyết định với từng ý.',
    synonyms: ['review', 'peer review', 'phản biện', 'reviewer', 'review panel', 'lens'],
    store: central('paperReviews'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['runs', 'Các lượt phản biện.'],
      ['humanNotes', 'Ghi chú của người, viết trước khi xem phản biện AI.'],
      ['decisions', 'Quyết định với từng ý.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'review-point', 'runs.merged'],
    ],
    schema: [`${S}paperReview.ts`, 'PaperReviewsRecordSchema'],
  }),
  concept({
    id: 'review-point',
    name: 'Review point',
    labelVi: 'Ý phản biện',
    description: 'Một ý phản biện đã gộp từ các lens, neo vào một vị trí trong bài, có mức độ nghiêm trọng.',
    synonyms: ['review point', 'ý phản biện', 'comment', 'nhận xét'],
    store: nested('paper-review', 'runs[].merged[]'),
    fields: [
      ['id', 'Mã ý.'],
      ['lenses', 'Các lens nêu ý này.'],
      ['anchor', 'Vị trí neo trong văn bản.'],
      ['severity', 'minor, moderate hoặc major.'],
      ['wordings', 'Cách diễn đạt của từng lens.'],
    ],
    schema: [`${S}paperReview.ts`, 'MergedReviewPointSchema'],
  }),
  concept({
    id: 'review-ngram',
    name: 'Review n-gram',
    labelVi: 'N-gram của phản biện',
    description:
      'Mã băm các n-gram trong văn bản phản biện AI của một bài, dùng để phát hiện câu chữ rập khuôn lặp lại giữa các bài. Nhiều mã có thể gộp vào một bucket.',
    synonyms: ['ngram', 'n-gram', 'template phrases', 'câu rập khuôn'],
    store: central('reviewNgrams'),
    fields: [
      ['hash', 'Mã băm n-gram, hoặc mã bucket.'],
      ['hashes', 'Các mã băm trong bucket.'],
      ['paperId', 'Bài báo.'],
    ],
    relations: [['belongs-to', 'paper', 'paperId']],
    schema: [`${S}paperReview.ts`, 'ReviewNgramSchema'],
  }),
  concept({
    id: 'style-probe',
    name: 'Style probe',
    labelVi: 'Thử độ nhạy văn phong',
    description:
      'Các lượt viết lại vài đoạn chỉ đổi văn phong rồi chấm lại, để xem điểm có đổi vì văn phong hay không (insufficient, style_sensitive, stable).',
    synonyms: ['probe', 'style probe', 'thử nghiệm', 'độ ổn định điểm', 'style sensitivity'],
    store: central('paperProbes'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['runs', 'Các lượt thử.'],
      ['updatedAt', 'Lần cập nhật.'],
    ],
    relations: [['belongs-to', 'paper', 'paperId']],
    schema: [`${S}paperProbe.ts`, 'PaperProbesRecordSchema'],
  }),
  concept({
    id: 'stance',
    name: 'Stance markers',
    labelVi: 'Dấu hiệu lập trường',
    description:
      'Các dấu hiệu lập trường (stance) và engagement trong bài, (hedges, boosters, attitude_markers, self_mention; reader_pronouns, directives, questions…), kèm số từ đã đọc theo mục làm mẫu số.',
    synonyms: ['stance', 'hedging', 'booster', 'lập trường', 'engagement', 'rào đón'],
    store: central('stance'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['runs', 'Các lượt gán nhãn.'],
      ['decisions', 'Quyết định của người với từng nhãn.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'stance-marker', 'runs.annotations'],
    ],
    schema: [`${S}stance.ts`, 'StanceRecordSchema'],
  }),
  concept({
    id: 'stance-marker',
    name: 'Stance marker',
    labelVi: 'Một dấu hiệu lập trường',
    description: 'Một dấu hiệu lập trường trong một đoạn, với vị trí do code tìm và lý do.',
    synonyms: ['marker', 'hedge', 'dấu hiệu'],
    store: nested('stance', 'runs[].annotations[]'),
    fields: [
      ['id', 'Mã nhãn.'],
      ['paragraphId', 'Đoạn chứa.'],
      ['sectionId', 'Mục chứa.'],
      ['category', 'Loại dấu hiệu.'],
      ['marker', 'Từ hoặc cụm đánh dấu.'],
      ['excerpt', 'Trích đoạn.'],
      ['rationale', 'Lý do.'],
    ],
    relations: [['refers-to', 'paragraph', 'paragraphId']],
    schema: [`${S}stance.ts`, 'StanceAnnotationSchema'],
  }),
  concept({
    id: 'paper-context',
    name: 'Paper context',
    labelVi: 'Bối cảnh học thuật của bài',
    description:
      'Metadata của bài từ OpenAlex, kiểm tra retraction của bài và các tài liệu được trích, và kiểm tra danh mục References.',
    synonyms: ['context', 'metadata', 'retraction', 'rút bài', 'reference audit', 'kiểm tra trích dẫn'],
    store: central('paperContext'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['paperDoi', 'DOI của bài.'],
      ['retracted', 'Các tài liệu đã bị rút.'],
      ['metadata', 'Metadata (tác giả, venue, năm, keywords…).'],
      ['referenceAudit', 'Kết quả kiểm tra từng tài liệu tham khảo.'],
      ['checkedAt', 'Thời điểm kiểm tra.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['refers-to', 'kg-paper', 'paperDoi'],
    ],
    schema: [`${S}paperContext.ts`, 'PaperContextRecordSchema'],
  }),
  concept({
    id: 'paper-insights',
    name: 'Paper insights',
    labelVi: 'Đọc hiểu bài báo',
    description:
      'Các lượt đọc hiểu bài bằng AI: rhetoric (Move), Argument theo Toulmin, snapshot các trường chính, digest cho người đọc và contribution sentence (OpenKG).',
    synonyms: ['insights', 'đọc hiểu', 'rhetoric', 'digest', 'snapshot', 'tóm tắt cho người đọc'],
    store: central('paperInsights'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['rhetoricRuns', 'Các lượt gán nhãn rhetoric.'],
      ['argumentRuns', 'Các lượt dựng Argument.'],
      ['snapshotRuns', 'Các lượt trích trường chính.'],
      ['digestRuns', 'Các bản digest.'],
      ['contributionRuns', 'Các lượt trích contribution sentence.'],
      ['decisions', 'Quyết định của người.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'argument', 'argumentRuns.arguments'],
      ['has-many', 'rhetoric-item', 'rhetoricRuns.items'],
      ['has-many', 'contribution-sentence', 'contributionRuns.sentences'],
    ],
    schema: [`${S}paperInsights.ts`, 'PaperInsightsRecordSchema'],
  }),
  concept({
    id: 'rhetoric-item',
    name: 'Rhetorical move',
    labelVi: 'Move tu từ',
    description:
      'Một đoạn trích được gán nhãn rhetoric (Move / Step), ví dụ nêu Research gap hay nêu Contribution.',
    synonyms: ['move', 'step', 'rhetoric', 'tu từ', 'rhetorical move'],
    store: nested('paper-insights', 'rhetoricRuns[].items[]'),
    fields: [
      ['id', 'Mã nhãn.'],
      ['paragraphId', 'Đoạn chứa.'],
      ['sectionId', 'Mục chứa.'],
      ['category', 'Loại Move.'],
      ['excerpt', 'Trích đoạn.'],
      ['rationale', 'Lý do.'],
    ],
    relations: [['refers-to', 'paragraph', 'paragraphId']],
    schema: [`${S}paperInsights.ts`, 'RhetoricItemSchema'],
  }),
  concept({
    id: 'argument',
    name: 'Argument',
    labelVi: 'Argument (Toulmin)',
    description:
      'Một Argument dựng theo Toulmin: Claim, Data (Evidence), Warrant tác giả nêu hoặc do người phân tích suy ra, Backing, Qualifier, Rebuttal và mức Evidence.',
    synonyms: ['argument', 'toulmin', 'lập luận', 'warrant', 'qualifier', 'rebuttal', 'backing', 'luận cứ'],
    store: nested('paper-insights', 'argumentRuns[].arguments[]'),
    fields: [
      ['id', 'Mã Argument.'],
      ['importance', 'Mức quan trọng.'],
      ['claim', 'Claim, có trích dẫn trong bài.'],
      ['claimType', 'Loại Claim.'],
      ['data', 'Data / Evidence dẫn ra.'],
      ['statedWarrant', 'Warrant tác giả nêu.'],
      ['inferredWarrant', 'Warrant người phân tích suy ra, không phải của tác giả.'],
      ['backing', 'Backing.'],
      ['qualifier', 'Qualifier.'],
      ['rebuttals', 'Rebuttal.'],
      ['evidenceLevel', 'Loại chỗ dựa mà văn bản báo cáo.'],
    ],
    schema: [`${S}paperInsights.ts`, 'ArgumentSchema'],
  }),
  concept({
    id: 'contribution-sentence',
    name: 'Contribution sentence (OpenKG)',
    labelVi: 'Câu đóng góp (OpenKG)',
    description:
      'Một câu nêu Contribution của bài, gán đơn vị thông tin kiểu NCG và các cụm từ, bộ ba (triple) để đưa vào đồ thị tri thức OpenKG.',
    synonyms: [
      'openkg',
      'ncg',
      'triple',
      'bộ ba',
      'contribution sentence',
      'câu đóng góp',
      'knowledge graph',
    ],
    store: nested('paper-insights', 'contributionRuns[].sentences[]'),
    fields: [
      ['sentenceId', 'Câu trong bài.'],
      ['unit', 'Đơn vị thông tin.'],
      ['phrases', 'Các cụm từ khoa học.'],
      ['triples', 'Các bộ ba chủ thể – quan hệ – đối tượng.'],
    ],
  }),
  concept({
    id: 'grobid',
    name: 'GROBID result',
    labelVi: 'Kết quả GROBID',
    description:
      'Kết quả GROBID cho tệp PDF của bài: header, danh mục References và các trích dẫn trong văn bản. Giữ riêng, không đổi Paper.',
    synonyms: ['grobid', 'header', 'tei', 'trích dẫn trong bài', 'in-text citation'],
    store: central('grobid'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['sha256', 'Mã băm tệp PDF đã xử lý.'],
      ['status', 'Trạng thái.'],
      ['result.header', 'Tiêu đề, tác giả, DOI đọc từ PDF.'],
      ['result.references', 'Danh mục References.'],
      ['result.citations', 'Các trích dẫn trong văn bản.'],
      ['fetchedAt', 'Thời điểm xử lý.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'reference', 'result.references'],
      ['refers-to', 'original-pdf', 'sha256'],
    ],
    schema: [`${S}grobid.ts`, 'GrobidRecordSchema'],
  }),
  concept({
    id: 'reference',
    name: 'Reference',
    labelVi: 'Tài liệu tham khảo',
    description: 'Một mục trong References của bài, do GROBID tách ra: tác giả, tiêu đề, venue, năm, DOI.',
    synonyms: ['reference', 'references', 'tài liệu tham khảo', 'bibliography', 'trích dẫn', 'citation'],
    store: nested('grobid', 'result.references[]'),
    fields: [
      ['id', 'Mã trong GROBID.'],
      ['authors', 'Tác giả.'],
      ['title', 'Tiêu đề.'],
      ['venue', 'Venue.'],
      ['year', 'Năm.'],
      ['doi', 'DOI.'],
      ['rawText', 'Văn bản gốc của mục.'],
    ],
    relations: [['refers-to', 'kg-paper', 'doi']],
  }),
  concept({
    id: 'scg-run',
    name: 'Scientific Contribution Graph run',
    labelVi: 'Lượt trích SCG',
    description:
      'Một lượt trích Contribution của bài theo Scientific Contribution Graph (SCG): các Contribution, Prerequisite và liên kết tới tài liệu được trích.',
    synonyms: ['scg', 'scientific contribution graph', 'đồ thị đóng góp'],
    store: central('scgRuns'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['doi', 'DOI.'],
      ['s2CorpusId', 'Mã Semantic Scholar.'],
      ['status', 'Trạng thái.'],
      ['contributions', 'Các Contribution.'],
      ['model', 'Model đã dùng.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'scg-contribution', 'contributions'],
      ['refers-to', 'kg-paper', 'doi'],
    ],
    schema: [`${S}scg.ts`, 'ScgPaperRunSchema'],
  }),
  concept({
    id: 'scg-contribution',
    name: 'Contribution',
    labelVi: 'Đóng góp (Contribution)',
    description:
      'Một Contribution của bài theo SCG, gán một hoặc nhiều trong 17 loại đóng góp, có câu nguồn và trạng thái review (candidate / accepted).',
    synonyms: ['contribution', 'đóng góp', 'claim', 'novelty', 'tính mới', 'đóng góp khoa học'],
    store: nested('scg-run', 'contributions[]'),
    fields: [
      ['id', 'Mã `<paperKey>.c<n>`.'],
      ['name', 'Tên ngắn.'],
      ['description', 'Mô tả.'],
      ['types', 'Loại đóng góp SCG và giải thích.'],
      ['sections', 'Mục nêu đóng góp.'],
      ['prerequisites', 'Các Prerequisite.'],
      ['sourceSentenceKeys', 'Câu nguồn.'],
      ['review', 'candidate hoặc accepted.'],
    ],
    relations: [['has-many', 'scg-prerequisite', 'prerequisites']],
    schema: [`${S}scg.ts`, 'ScgContributionSchema'],
  }),
  concept({
    id: 'scg-prerequisite',
    name: 'Prerequisite',
    labelVi: 'Tiền đề của đóng góp',
    description:
      'Một tiền đề mà Contribution dựa vào (phương pháp, dữ liệu, công cụ), liên kết tới tài liệu được trích.',
    synonyms: ['prerequisite', 'tiền đề', 'builds on', 'dựa trên'],
    store: nested('scg-contribution', 'prerequisites[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['description', 'Mô tả.'],
      ['coreOrPeripheral', 'Cốt lõi hay phụ.'],
      ['references', 'Tài liệu được trích.'],
      ['matches', 'Khớp với Contribution của bài khác.'],
      ['review', 'candidate hoặc accepted.'],
    ],
    schema: [`${S}scg.ts`, 'ScgPrerequisiteSchema'],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------------------------------------------

const MEASUREMENT_CONCEPTS: Concept[] = [
  concept({
    id: 'measurement',
    name: 'Measurement',
    labelVi: 'Đo lường (Measurement)',
    description:
      'Các lượt trích hồ sơ Measurement của bài: construct, metric, experiment, kết quả báo cáo và Claim, kèm quyết định của người.',
    synonyms: ['measurement', 'đo lường', 'đo', 'metrics', 'phép đo'],
    store: central('measurements'),
    fields: [
      ['paperId', 'Bài báo.'],
      ['runs', 'Các lượt trích.'],
      ['decisions', 'Quyết định của người với từng mục.'],
      ['pending', 'Lượt đang chạy dở.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paperId'],
      ['has-many', 'measurement-profile', 'runs.profile'],
    ],
    schema: [`${S}measurement.ts`, 'MeasurementsRecordSchema'],
  }),
  concept({
    id: 'measurement-profile',
    name: 'Measurement profile',
    labelVi: 'Hồ sơ đo lường của bài',
    description:
      'Hồ sơ đã kiểm chứng của một lượt: loại bài, construct, metric, experiment, kết quả, Claim và finding.',
    synonyms: ['paper profile', 'hồ sơ bài', 'measurement profile', 'paper type'],
    store: nested('measurement', 'runs[].profile'),
    fields: [
      ['paper_type', 'Loại bài.'],
      ['status', 'Trạng thái.'],
      ['constructs', 'Các construct.'],
      ['metrics', 'Các metric được dùng.'],
      ['experiments', 'Các experiment.'],
      ['results', 'Kết quả báo cáo.'],
      ['claims', 'Các Claim.'],
      ['findings', 'Nhận xét về cách đo.'],
    ],
    relations: [
      ['has-many', 'construct', 'constructs'],
      ['has-many', 'metric-usage', 'metrics'],
      ['has-many', 'experiment', 'experiments'],
      ['has-many', 'reported-result', 'results'],
      ['has-many', 'research-claim', 'claims'],
    ],
    schema: [`${S}measurement.ts`, 'MeasurementProfileSchema'],
  }),
  concept({
    id: 'construct',
    name: 'Construct',
    labelVi: 'Khái niệm đo (Construct)',
    description: 'Một khái niệm mà bài muốn đo, ví dụ "độ chính xác" hay "khả năng tổng quát".',
    synonyms: ['construct', 'khái niệm', 'đại lượng'],
    store: nested('measurement-profile', 'constructs[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['description', 'Mô tả.'],
      ['source_type', 'author_statement, ai_interpretation hoặc ai_concern.'],
    ],
    schema: [`${S}measurement.ts`, 'ConstructSchema'],
  }),
  concept({
    id: 'metric-usage',
    name: 'Metric usage',
    labelVi: 'Metric trong bài',
    description: 'Một Metric bài dùng, tên báo cáo, nhãn chuẩn hoá, định nghĩa, công thức và đơn vị.',
    synonyms: ['metric', 'chỉ số', 'thước đo', 'độ đo'],
    store: nested('measurement-profile', 'metrics[]'),
    fields: [
      ['id', 'Mã.'],
      ['reported_name', 'Tên như trong bài.'],
      ['normalized_label', 'Nhãn chuẩn hoá.'],
      ['construct_ids', 'Construct được đo.'],
      ['definition', 'Định nghĩa.'],
      ['formula_text', 'Công thức.'],
      ['unit', 'Đơn vị.'],
    ],
    relations: [['refers-to', 'construct', 'construct_ids']],
    schema: [`${S}measurement.ts`, 'MetricUsageSchema'],
  }),
  concept({
    id: 'experiment',
    name: 'Experiment',
    labelVi: 'Thí nghiệm',
    description: 'Một experiment trong bài, với giao thức đo.',
    synonyms: ['experiment', 'thí nghiệm', 'thực nghiệm'],
    store: nested('measurement-profile', 'experiments[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['protocol', 'Giao thức (input, quy trình, nguồn dữ liệu, aggregation).'],
    ],
    schema: [`${S}measurement.ts`, 'ExperimentSchema'],
  }),
  concept({
    id: 'reported-result',
    name: 'Reported result',
    labelVi: 'Kết quả báo cáo',
    description:
      'Một giá trị kết quả trong Results, gắn experiment, metric, hệ thống hay Baseline và độ bất định.',
    synonyms: ['result', 'results', 'kết quả', 'số liệu', 'giá trị'],
    store: nested('measurement-profile', 'results[]'),
    fields: [
      ['id', 'Mã.'],
      ['experiment_id', 'Experiment.'],
      ['metric_usage_id', 'Metric.'],
      ['system_or_baseline', 'Hệ thống hoặc Baseline.'],
      ['value', 'Giá trị.'],
      ['unit', 'Đơn vị.'],
      ['uncertainty', 'Độ bất định.'],
      ['status', 'Trạng thái kiểm chứng.'],
    ],
    relations: [
      ['refers-to', 'experiment', 'experiment_id'],
      ['refers-to', 'metric-usage', 'metric_usage_id'],
    ],
    schema: [`${S}measurement.ts`, 'ReportedResultSchema'],
  }),
  concept({
    id: 'research-claim',
    name: 'Claim',
    labelVi: 'Claim của bài',
    description:
      'Một Claim trong bài và các kết quả, metric đỡ cho nó. Phạm vi Evidence là cách AI đọc, không phải bằng chứng Claim đúng.',
    synonyms: ['claim', 'luận điểm', 'khẳng định', 'tuyên bố', 'research claim'],
    store: nested('measurement-profile', 'claims[]'),
    fields: [
      ['id', 'Mã.'],
      ['text', 'Câu Claim.'],
      ['status', 'Trạng thái.'],
      ['evidence_scope', 'Phạm vi mà kết quả liên kết thực sự bao phủ.'],
      ['linked_result_ids', 'Kết quả liên kết.'],
      ['linked_metric_ids', 'Metric liên kết.'],
    ],
    relations: [
      ['refers-to', 'reported-result', 'linked_result_ids'],
      ['refers-to', 'metric-usage', 'linked_metric_ids'],
    ],
    schema: [`${S}measurement.ts`, 'ResearchClaimSchema'],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Library and corpora
// ---------------------------------------------------------------------------------------------------------------

const CORPUS_CONCEPTS: Concept[] = [
  concept({
    id: 'library-item',
    name: 'Library item',
    labelVi: 'Mục thư viện',
    description:
      'Một bài trong thư viện của lab, theo DOI: metadata OpenAlex, nguồn open access, taxonomy, keywords và tác giả. Có thể liên kết với Paper đã nạp.',
    synonyms: ['library', 'thư viện', 'doi', 'mục thư viện', 'open access', 'reading list'],
    store: central('library'),
    fields: [
      ['id', 'Mã mục.'],
      ['doi', 'DOI.'],
      ['title', 'Tiêu đề.'],
      ['authors', 'Tác giả.'],
      ['year', 'Năm.'],
      ['venue', 'Venue.'],
      ['access', 'Tình trạng truy cập.'],
      ['oa_sources', 'Các nguồn open access.'],
      ['taxonomy', 'Domain, field, subfield, topic của OpenAlex.'],
      ['keywords', 'Keywords của OpenAlex.'],
      ['openalex_id', 'Mã OpenAlex.'],
      ['paper_id', 'Paper đã nạp, nếu có.'],
    ],
    relations: [
      ['refers-to', 'paper', 'paper_id'],
      ['refers-to', 'kg-paper', 'openalex_id'],
    ],
    schema: [`${S}library.ts`, 'LibraryItemSchema'],
  }),
  concept({
    id: 'corpus',
    name: 'Corpus',
    labelVi: 'Corpus',
    description:
      'Một tập bài báo có Protocol: corpus theo tạp chí (journal), corpus đối chứng (control) hoặc corpus theo chủ đề (topic, kiểu systematic review với PRISMA).',
    synonyms: [
      'corpus',
      'corpora',
      'tập bài',
      'bộ sưu tập',
      'systematic review',
      'literature review',
      'tổng quan tài liệu',
    ],
    store: central('corpora'),
    fields: [
      ['id', 'Mã corpus.'],
      ['title', 'Tên.'],
      ['kind', 'journal, control hoặc topic.'],
      ['protocol', 'Các phiên bản Protocol.'],
      ['searches', 'Các lượt tìm kiếm và nhập.'],
      ['members', 'Các bài thành viên.'],
      ['releases', 'Các bản phát hành cố định.'],
      ['deep', 'Deep research: kế hoạch tìm, ứng viên, tổng hợp.'],
      ['labelQueue', 'Lượt gán nhãn toàn corpus đang chạy.'],
    ],
    relations: [
      ['has-many', 'corpus-member', 'members'],
      ['has-many', 'corpus-protocol', 'protocol'],
      ['has-many', 'search-record', 'searches'],
      ['has-many', 'corpus-release', 'releases'],
    ],
    schema: [`${S}corpus.ts`, 'CorpusSchema'],
  }),
  concept({
    id: 'corpus-member',
    name: 'Corpus member',
    labelVi: 'Bài trong corpus',
    description:
      'Một bài thuộc corpus, với định danh (DOI, OpenAlex, sha256), trạng thái lấy toàn văn, các quyết định sàng lọc và đánh giá chất lượng.',
    synonyms: ['member', 'thành viên', 'bài trong corpus', 'record', 'included study'],
    store: nested('corpus', 'members[]'),
    fields: [
      ['memberId', 'Mã thành viên.'],
      ['title', 'Tiêu đề.'],
      ['identifiers.doi', 'DOI.'],
      ['identifiers.openalexId', 'Mã OpenAlex.'],
      ['identifiers.paperIds', 'Các Paper đã nạp.'],
      ['identifiers.libraryIds', 'Các mục thư viện.'],
      ['role', 'build hoặc held_out.'],
      ['retrieval', 'Đã tìm, đã lấy hay không lấy được toàn văn.'],
      ['textRead', 'Đọc toàn văn, chỉ Abstract hay chỉ metadata.'],
      ['decisions', 'Các quyết định sàng lọc.'],
      ['suggestions', 'Gợi ý sàng lọc của AI, không được tính vào PRISMA.'],
      ['appraisal', 'Đánh giá chất lượng.'],
      ['citedByCount', 'Số trích dẫn khi nhập.'],
    ],
    relations: [
      ['has-many', 'screening-decision', 'decisions'],
      ['refers-to', 'kg-paper', 'identifiers.doi'],
      ['refers-to', 'paper', 'identifiers.paperIds'],
      ['refers-to', 'library-item', 'identifiers.libraryIds'],
    ],
    schema: [`${S}corpus.ts`, 'CorpusMemberSchema'],
  }),
  concept({
    id: 'screening-decision',
    name: 'Screening decision',
    labelVi: 'Quyết định sàng lọc',
    description:
      'Quyết định của người ở một vòng sàng lọc (title-abstract hoặc full-text): include, exclude hay uncertain, kèm lý do. Chỉ quyết định của người mới thay đổi số liệu PRISMA.',
    synonyms: ['sàng lọc', 'screening', 'screen', 'include', 'exclude', 'loại', 'chọn bài', 'prisma'],
    store: nested('corpus-member', 'decisions[]'),
    fields: [
      ['stage', 'Vòng sàng lọc.'],
      ['decision', 'include, exclude hoặc uncertain.'],
      ['reasonCode', 'Mã lý do.'],
      ['reasonText', 'Lý do.'],
      ['decider', 'Người quyết định.'],
      ['acceptedSuggestion', 'Gợi ý AI mà người đã chấp nhận.'],
      ['at', 'Thời điểm.'],
    ],
  }),
  concept({
    id: 'corpus-protocol',
    name: 'Protocol',
    labelVi: 'Protocol của corpus',
    description:
      'Một phiên bản Protocol: với corpus tạp chí là venue, năm, loại bài và cách lấy mẫu; với corpus chủ đề là Research question và tiêu chí include / exclude.',
    synonyms: ['protocol', 'tiêu chí', 'inclusion criteria', 'exclusion criteria', 'sampling', 'lấy mẫu'],
    store: nested('corpus', 'protocol[]'),
    fields: [
      ['version', 'Số phiên bản.'],
      ['createdAt', 'Thời điểm tạo.'],
      ['body.venues', 'Các venue (corpus tạp chí).'],
      ['body.years', 'Các năm.'],
      ['body.sampling', 'Cách lấy mẫu: signature hay admired.'],
      ['body.bank', 'Liên kết với catalog của Writing Bank.'],
      ['body.researchQuestion', 'Research question (corpus chủ đề).'],
      ['body.inclusion', 'Tiêu chí include.'],
      ['body.exclusion', 'Tiêu chí exclude.'],
    ],
    schema: [`${S}corpus.ts`, 'CorpusProtocolVersionSchema'],
  }),
  concept({
    id: 'search-record',
    name: 'Search record',
    labelVi: 'Lượt tìm kiếm',
    description:
      'Một lượt tìm kiếm trên nguồn (ví dụ OpenAlex), một lượt citation searching (snowballing) hoặc một lần nhập tệp RIS / CSV, với số liệu cho PRISMA.',
    synonyms: ['search', 'tìm kiếm', 'search strategy', 'snowballing', 'truy vấn', 'nhập ris'],
    store: nested('corpus', 'searches[]'),
    fields: [
      ['source', 'Nguồn tìm.'],
      ['requestUrl', 'Yêu cầu đã gửi.'],
      ['params', 'Tham số.'],
      ['runAt', 'Thời điểm.'],
      ['totalReported', 'Số nguồn báo có.'],
      ['retrieved', 'Số đã lấy.'],
      ['duplicates', 'Số trùng.'],
      ['added', 'Số thêm vào.'],
      ['seeds', 'Bài gốc khi snowballing.'],
      ['fileName', 'Tệp đã nhập.'],
    ],
  }),
  concept({
    id: 'corpus-release',
    name: 'Corpus release',
    labelVi: 'Bản phát hành corpus',
    description: 'Một bản chụp cố định của corpus theo một phiên bản Protocol, có digest để tham chiếu lại.',
    synonyms: ['release', 'phát hành', 'snapshot', 'phiên bản corpus'],
    store: nested('corpus', 'releases[]'),
    fields: [
      ['id', 'Mã.'],
      ['protocolVersion', 'Phiên bản Protocol.'],
      ['digest', 'Digest.'],
      ['memberCount', 'Số thành viên.'],
    ],
  }),
  concept({
    id: 'corpus-profile',
    name: 'Journal profile',
    labelVi: 'Hồ sơ văn phong tạp chí',
    description:
      'Hồ sơ văn phong của một corpus tạp chí so với corpus đối chứng: các đặc trưng, effect size, kiểm định và holdout. Bản v1 được lưu; bản v2 cho Writing Bank được dựng khi xuất, không lưu.',
    synonyms: [
      'journal profile',
      'corpus profile',
      'hồ sơ tạp chí',
      'văn phong tạp chí',
      'đặc trưng',
      'features',
    ],
    store: central('corpusProfiles'),
    fields: [
      ['corpusId', 'Corpus đích.'],
      ['savedAt', 'Thời điểm lưu.'],
      ['profile.target', 'Tóm tắt corpus đích.'],
      ['profile.control', 'Tóm tắt corpus đối chứng.'],
      ['profile.features', 'Các đặc trưng và so sánh.'],
      ['profile.distinctiveFeatureIds', 'Các đặc trưng khác biệt.'],
      ['profile.holdout', 'Kiểm tra holdout.'],
    ],
    relations: [['belongs-to', 'corpus', 'corpusId']],
    schema: [`${S}corpusProfile.ts`, 'StoredCorpusProfileSchema'],
  }),
  concept({
    id: 'corpus-topics',
    name: 'Topic model snapshot',
    labelVi: 'Bản chụp chủ đề corpus',
    description:
      'Kết quả mô hình chủ đề trên một hoặc nhiều corpus: pipeline, chất lượng so với subfield OpenAlex, các chủ đề và chủ đề của từng thành viên.',
    synonyms: ['topic model', 'topics', 'chủ đề', 'bertopic', 'cụm chủ đề', 'clustering'],
    store: central('corpusTopics'),
    fields: [
      ['snapshotId', 'Mã bản chụp.'],
      ['corpora', 'Các corpus đầu vào.'],
      ['pipeline', 'Mô hình embedding và tham số.'],
      ['quality', 'Chất lượng (NMI, outlier, độ ổn định).'],
      ['topics', 'Các chủ đề.'],
      ['members', 'Chủ đề của từng thành viên.'],
    ],
    relations: [
      ['has-many', 'corpus-topic', 'topics'],
      ['refers-to', 'corpus', 'corpora.corpusId'],
    ],
    schema: [`${S}corpusTopics.ts`, 'CorpusTopicsSchema'],
  }),
  concept({
    id: 'corpus-topic',
    name: 'Corpus topic',
    labelVi: 'Một chủ đề của corpus',
    description:
      'Một chủ đề trong bản chụp: kích thước, từ đặc trưng, thành viên tiêu biểu và subfield OpenAlex.',
    synonyms: ['topic', 'chủ đề', 'cluster'],
    store: nested('corpus-topics', 'topics[]'),
    fields: [
      ['topicId', 'Mã chủ đề.'],
      ['size', 'Số bài.'],
      ['words', 'Từ đặc trưng.'],
      ['representativeMemberIds', 'Thành viên tiêu biểu.'],
      ['openalexSubfields', 'Subfield OpenAlex.'],
    ],
  }),
  concept({
    id: 'topic-name',
    name: 'Topic name',
    labelVi: 'Tên chủ đề',
    description: 'Tên và mô tả của một chủ đề trong bản chụp: tên AI đề xuất và tên người chốt.',
    synonyms: ['topic name', 'tên chủ đề', 'nhãn chủ đề'],
    store: central('topicNames'),
    fields: [
      ['snapshotId', 'Bản chụp.'],
      ['topicId', 'Chủ đề.'],
      ['candidateName', 'Tên AI đề xuất.'],
      ['name', 'Tên đã chốt.'],
      ['description', 'Mô tả.'],
    ],
    relations: [
      ['belongs-to', 'corpus-topics', 'snapshotId'],
      ['refers-to', 'corpus-topic', 'topicId'],
    ],
    schema: [`${S}corpusTopics.ts`, 'TopicNameSchema'],
  }),
  concept({
    id: 'corpus-keywords',
    name: 'Corpus keywords',
    labelVi: 'Keywords của corpus',
    description: 'Keywords OpenAlex tổng hợp trên một corpus: tần suất, theo năm và các cặp đi cùng nhau.',
    synonyms: ['keywords', 'từ khoá', 'co-occurrence', 'đồng xuất hiện'],
    store: central('corpusKeywords'),
    fields: [
      ['corpusId', 'Corpus.'],
      ['memberCount', 'Số thành viên.'],
      ['papers', 'Keywords của từng thành viên.'],
      ['keywords', 'Keywords và tần suất.'],
      ['pairs', 'Các cặp keyword đi cùng.'],
    ],
    relations: [['belongs-to', 'corpus', 'corpusId']],
    schema: [`${S}corpusKeywords.ts`, 'CorpusKeywordsSchema'],
  }),
  concept({
    id: 'doi-keywords',
    name: 'DOI keywords',
    labelVi: 'Keywords theo DOI',
    description: 'Keywords OpenAlex của một DOI, lưu tạm để không phải hỏi lại.',
    synonyms: ['doi keywords', 'keywords cache'],
    store: central('doiKeywords'),
    fields: [
      ['doi', 'DOI.'],
      ['keywords', 'Keywords và điểm.'],
      ['fetchedAt', 'Thời điểm lấy.'],
    ],
    relations: [['refers-to', 'kg-paper', 'doi']],
    schema: [`${S}corpusKeywords.ts`, 'DoiKeywordsSchema'],
  }),
  concept({
    id: 'extraction-project',
    name: 'Extraction project',
    labelVi: 'Bảng trích dữ liệu',
    description:
      'Một bảng trích dữ liệu (data extraction) trên nhiều bài: các trường, các ô có Evidence, các lượt chạy AI và kiểm chứng.',
    synonyms: ['extraction', 'data extraction', 'trích dữ liệu', 'bảng trích', 'matrix', 'evidence table'],
    store: central('extractionProjects'),
    fields: [
      ['id', 'Mã.'],
      ['title', 'Tên.'],
      ['researchQuestion', 'Research question.'],
      ['paperId', 'Paper chính, nếu có.'],
      ['corpusId', 'Corpus, nếu có.'],
      ['papers', 'Các bài.'],
      ['fields', 'Các trường.'],
      ['cells', 'Các ô.'],
      ['runs', 'Các lượt chạy.'],
    ],
    relations: [
      ['has-many', 'extraction-paper', 'papers'],
      ['has-many', 'extraction-field', 'fields'],
      ['has-many', 'extraction-cell', 'cells'],
      ['belongs-to', 'corpus', 'corpusId'],
      ['refers-to', 'paper', 'paperId'],
    ],
    schema: [`${S}extraction.ts`, 'ExtractionProjectSchema'],
  }),
  concept({
    id: 'extraction-paper',
    name: 'Extraction paper',
    labelVi: 'Bài trong bảng trích',
    description: 'Một hàng của bảng trích: bài lấy từ Paper, thư viện hoặc ứng viên deep research.',
    synonyms: ['row', 'hàng', 'study'],
    store: nested('extraction-project', 'papers[]'),
    fields: [
      ['key', 'Khoá hàng.'],
      ['source', 'Nguồn: paper, library hoặc candidate.'],
      ['title', 'Tiêu đề.'],
      ['doi', 'DOI.'],
      ['access', 'Toàn văn hay chỉ Abstract.'],
      ['revision', 'Phiên bản văn bản.'],
      ['screening', 'Trạng thái sàng lọc của hàng.'],
    ],
    schema: [`${S}extraction.ts`, 'ProjectPaperSchema'],
  }),
  concept({
    id: 'extraction-field',
    name: 'Extraction field',
    labelVi: 'Trường trích',
    description:
      'Một cột của bảng trích, có hướng dẫn cho AI; đổi hướng dẫn tạo phiên bản mới và làm ô cũ thành lỗi thời.',
    synonyms: ['field', 'trường', 'cột', 'column'],
    store: nested('extraction-project', 'fields[]'),
    fields: [
      ['key', 'Khoá.'],
      ['label', 'Nhãn.'],
      ['group', 'Nhóm.'],
      ['description', 'Mô tả.'],
      ['instruction', 'Hướng dẫn cho AI.'],
      ['dataType', 'Kiểu dữ liệu.'],
      ['version', 'Phiên bản.'],
      ['hidden', 'Ẩn hay hiện.'],
    ],
    schema: [`${S}extraction.ts`, 'ProjectFieldSchema'],
  }),
  concept({
    id: 'extraction-cell',
    name: 'Extraction cell',
    labelVi: 'Ô dữ liệu',
    description:
      'Giá trị của một trường cho một bài, kèm Evidence trích từ văn bản, trạng thái kiểm chứng và lịch sử sửa.',
    synonyms: ['cell', 'ô', 'giá trị', 'value'],
    store: nested('extraction-project', 'cells[]'),
    fields: [
      ['paperKey', 'Hàng.'],
      ['fieldKey', 'Cột.'],
      ['fieldVersion', 'Phiên bản trường.'],
      ['status', 'Trạng thái.'],
      ['value', 'Giá trị hiển thị.'],
      ['aiValue', 'Giá trị AI đưa ra.'],
      ['evidence', 'Trích dẫn đỡ hoặc mâu thuẫn.'],
      ['verification', 'Kiểm chứng.'],
      ['history', 'Lịch sử sửa.'],
    ],
    relations: [
      ['refers-to', 'extraction-paper', 'paperKey'],
      ['refers-to', 'extraction-field', 'fieldKey'],
    ],
    schema: [`${S}extraction.ts`, 'ExtractionCellSchema'],
  }),
  concept({
    id: 'calibration-label-set',
    name: 'Calibration label set',
    labelVi: 'Bộ nhãn hiệu chỉnh',
    description:
      'Một bộ nhãn người chấm (đúng / sai, hoặc điểm) cho issue, kiểm tra hay ý phản biện, nhập từ tệp để hiệu chỉnh độ tin cậy của các detector.',
    synonyms: ['calibration', 'hiệu chỉnh', 'labels', 'nhãn', 'gold labels'],
    store: central('calibrationLabels'),
    fields: [
      ['id', 'Mã.'],
      ['sourceFileName', 'Tệp nguồn.'],
      ['importedAt', 'Thời điểm nhập.'],
      ['data.labels', 'Các nhãn của người chấm.'],
    ],
    schema: [`${S}calibration.ts`, 'CalibrationLabelSetSchema'],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Research design and AutoResearch
// ---------------------------------------------------------------------------------------------------------------

const DESIGN_CONCEPTS: Concept[] = [
  concept({
    id: 'research-design',
    name: 'Research design',
    labelVi: 'Thiết kế nghiên cứu',
    description:
      'Thiết kế nghiên cứu của một project: bản nháp (Research question, Hypothesis, Variable, Metric, Dataset, phân tích), các plan đã đóng băng và kiểm tra chủ đề.',
    synonyms: [
      'research design',
      'thiết kế nghiên cứu',
      'project',
      'dự án',
      'plan',
      'kế hoạch nghiên cứu',
      'srd',
    ],
    store: central('researchDesigns'),
    fields: [
      ['projectId', 'Mã project.'],
      ['version', 'Phiên bản.'],
      ['draft', 'Bản nháp đang sửa.'],
      ['frozenPlans', 'Các plan đã đóng băng.'],
      ['topicCheck', 'Kiểm tra chủ đề và Research gap.'],
      ['facts', 'Dữ kiện lấy từ các bài.'],
      ['bankRelease', 'Bản Bank đang dùng.'],
    ],
    relations: [
      ['has-many', 'research-question', 'draft.questions'],
      ['has-many', 'hypothesis', 'draft.hypotheses'],
      ['has-many', 'variable', 'draft.variables'],
      ['has-many', 'design-metric', 'draft.metrics'],
      ['has-many', 'dataset', 'draft.datasets'],
      ['has-many', 'condition', 'draft.conditions'],
      ['has-many', 'statistical-analysis', 'draft.analyses'],
      ['has-many', 'threat-to-validity', 'draft.threats'],
      ['has-many', 'frozen-plan', 'frozenPlans'],
    ],
    schema: [`${S}researchDesign.ts`, 'ResearchDesignSchema'],
  }),
  concept({
    id: 'research-question',
    name: 'Research question',
    labelVi: 'Câu hỏi nghiên cứu',
    description:
      'Một Research question trong bản nháp thiết kế, kèm Research gap mà nó lấp và các bài làm căn cứ cho gap đó.',
    synonyms: [
      'research question',
      'câu hỏi nghiên cứu',
      'rq',
      'research gap',
      'khoảng trống nghiên cứu',
      'gap',
    ],
    store: nested('research-design', 'draft.questions[]'),
    fields: [
      ['id', 'Mã.'],
      ['text', 'Câu hỏi.'],
      ['gap', 'Research gap mà câu hỏi lấp.'],
      ['papers', 'Các bài làm căn cứ cho gap.'],
    ],
    schema: [DRAFT, 'draftQuestionSchema'],
  }),
  concept({
    id: 'hypothesis',
    name: 'Hypothesis',
    labelVi: 'Giả thuyết',
    description: 'Một Hypothesis trả lời một Research question, nêu biến độc lập và biến phụ thuộc.',
    synonyms: ['hypothesis', 'giả thuyết', 'h1', 'giả định'],
    store: nested('research-design', 'draft.hypotheses[]'),
    fields: [
      ['id', 'Mã.'],
      ['statement', 'Phát biểu.'],
      ['kind', 'Loại Hypothesis.'],
      ['question', 'Research question.'],
      ['claim', 'Claim liên quan.'],
      ['independent', 'Biến độc lập.'],
      ['dependent', 'Biến phụ thuộc.'],
    ],
    relations: [
      ['refers-to', 'research-question', 'question'],
      ['refers-to', 'variable', 'independent'],
      ['refers-to', 'variable', 'dependent'],
    ],
    schema: [DRAFT, 'draftHypothesisSchema'],
  }),
  concept({
    id: 'design-type',
    name: 'Design type',
    labelVi: 'Kiểu thiết kế',
    description: 'Kiểu Research design của nghiên cứu (ví dụ thực nghiệm có đối chứng) và cách phân nhóm.',
    synonyms: ['design type', 'kiểu thiết kế', 'experimental design', 'assignment'],
    store: nested('research-design', 'draft.design'),
    fields: [
      ['name', 'Tên kiểu thiết kế.'],
      ['assignment', 'Cách phân nhóm.'],
      ['bank', 'Mục tương ứng trong Bank.'],
    ],
    schema: [DRAFT, 'draftDesignSchema'],
  }),
  concept({
    id: 'threat-to-validity',
    name: 'Threat to validity',
    labelVi: 'Mối đe doạ tính hợp lệ',
    description: 'Một Threats to validity của thiết kế và cách giảm thiểu.',
    synonyms: ['threats to validity', 'threat', 'đe doạ', 'validity', 'tính hợp lệ', 'bias', 'thiên lệch'],
    store: nested('research-design', 'draft.threats[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['mitigation', 'Cách giảm thiểu.'],
    ],
    schema: [DRAFT, 'draftThreatSchema'],
  }),
  concept({
    id: 'variable',
    name: 'Variable',
    labelVi: 'Biến',
    description:
      'Một Variable của thiết kế: vai trò (độc lập, phụ thuộc, kiểm soát), construct, metric và các mức.',
    synonyms: [
      'variable',
      'biến',
      'biến độc lập',
      'biến phụ thuộc',
      'independent variable',
      'dependent variable',
    ],
    store: nested('research-design', 'draft.variables[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['role', 'independent, dependent, control hoặc covariate.'],
      ['construct', 'Construct.'],
      ['metric', 'Metric đo biến.'],
      ['levels', 'Các mức.'],
    ],
    relations: [['refers-to', 'design-metric', 'metric']],
    schema: [DRAFT, 'draftVariableSchema'],
  }),
  concept({
    id: 'design-metric',
    name: 'Design metric',
    labelVi: 'Metric của thiết kế',
    description: 'Một Metric dự định dùng: đơn vị, chiều tốt hơn, cách gộp và Protocol đo.',
    synonyms: ['metric', 'chỉ số', 'thước đo', 'đo lường'],
    store: nested('research-design', 'draft.metrics[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['key', 'Khoá trong kết quả chạy.'],
      ['unit', 'Đơn vị.'],
      ['goal', 'Lớn hơn hay nhỏ hơn là tốt.'],
      ['aggregation', 'Cách gộp.'],
      ['protocol', 'Protocol đo.'],
    ],
    schema: [DRAFT, 'draftMetricSchema'],
  }),
  concept({
    id: 'dataset',
    name: 'Dataset',
    labelVi: 'Bộ dữ liệu',
    description: 'Một Dataset dùng trong thiết kế, với nguồn, phiên bản, split và mã băm.',
    synonyms: ['dataset', 'bộ dữ liệu', 'dữ liệu', 'benchmark', 'data'],
    store: nested('research-design', 'draft.datasets[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['source', 'Nguồn.'],
      ['version', 'Phiên bản.'],
      ['split', 'Split.'],
      ['sha256', 'Mã băm.'],
      ['benchmark', 'Benchmark tương ứng.'],
    ],
    schema: [DRAFT, 'draftDatasetSchema'],
  }),
  concept({
    id: 'condition',
    name: 'Condition',
    labelVi: 'Điều kiện thí nghiệm',
    description: 'Một điều kiện chạy (phương pháp đề xuất, Baseline, Ablation) với tham số.',
    synonyms: ['condition', 'điều kiện', 'baseline', 'ablation', 'arm', 'nhóm đối chứng'],
    store: nested('research-design', 'draft.conditions[]'),
    fields: [
      ['id', 'Mã.'],
      ['name', 'Tên.'],
      ['baseline', 'Có phải Baseline.'],
      ['params', 'Tham số.'],
    ],
    schema: [DRAFT, 'draftConditionSchema'],
  }),
  concept({
    id: 'statistical-analysis',
    name: 'Statistical analysis',
    labelVi: 'Phân tích thống kê',
    description:
      'Kế hoạch Statistical analysis cho một Hypothesis: phương pháp, biến, điều kiện, alpha và hiệu chỉnh.',
    synonyms: [
      'statistical analysis',
      'phân tích thống kê',
      'kiểm định',
      'statistical test',
      'alpha',
      'p-value',
    ],
    store: nested('research-design', 'draft.analyses[]'),
    fields: [
      ['id', 'Mã.'],
      ['hypothesis', 'Hypothesis được kiểm định.'],
      ['method', 'Phương pháp.'],
      ['variables', 'Các biến.'],
      ['conditions', 'Các điều kiện.'],
      ['alpha', 'Mức alpha.'],
      ['correction', 'Hiệu chỉnh so sánh bội.'],
      ['missingPolicy', 'Xử lý dữ liệu thiếu.'],
    ],
    relations: [
      ['refers-to', 'hypothesis', 'hypothesis'],
      ['refers-to', 'variable', 'variables'],
      ['refers-to', 'condition', 'conditions'],
    ],
    schema: [DRAFT, 'draftAnalysisSchema'],
  }),
  concept({
    id: 'run-matrix',
    name: 'Run matrix',
    labelVi: 'Ma trận lượt chạy',
    description: 'Các tổ hợp điều kiện × Dataset × seed sẽ chạy, cùng lý do chọn cỡ mẫu.',
    synonyms: ['run matrix', 'ma trận chạy', 'seeds', 'sample size', 'cỡ mẫu'],
    store: nested('research-design', 'draft.runMatrix'),
    fields: [
      ['mlflowExperiment', 'Experiment trong MLflow.'],
      ['conditions', 'Các điều kiện.'],
      ['datasets', 'Các Dataset.'],
      ['seeds', 'Các seed.'],
      ['sampleSizeJustification', 'Lý do chọn cỡ mẫu.'],
    ],
    schema: [DRAFT, 'draftRunMatrixSchema'],
  }),
  concept({
    id: 'frozen-plan',
    name: 'Frozen plan',
    labelVi: 'Plan đã đóng băng',
    description:
      'Một phiên bản plan đã đóng băng (preregistration) trước khi chạy; mọi thay đổi sau đó được ghi là deviation.',
    synonyms: ['frozen plan', 'preregistration', 'đăng ký trước', 'đóng băng', 'deviation'],
    store: nested('research-design', 'frozenPlans[]'),
    fields: [
      ['planId', 'Mã plan.'],
      ['planVersion', 'Phiên bản.'],
      ['title', 'Tên.'],
      ['frozenAt', 'Thời điểm đóng băng.'],
      ['frozenBy', 'Người đóng băng.'],
      ['deviation', 'Ghi chú deviation.'],
      ['hypotheses', 'Các Hypothesis.'],
    ],
    schema: ['src/core/researchDesign/plan/schema.ts', 'planSchema'],
  }),
  concept({
    id: 'topic-check',
    name: 'Topic and gap check',
    labelVi: 'Kiểm tra chủ đề và gap',
    description:
      'Kiểm tra một ý tưởng nghiên cứu trước khi làm: các bài lân cận, tranh luận còn sống hay không, PICO và quyết định có theo đuổi không.',
    synonyms: ['topic check', 'gap check', 'kiểm tra chủ đề', 'novelty check', 'pico', 'ý tưởng nghiên cứu'],
    store: nested('research-design', 'topicCheck'),
    fields: [
      ['track', 'Hướng kiểm tra.'],
      ['statement', 'Phát biểu ý tưởng.'],
      ['searchQuery', 'Truy vấn tìm.'],
      ['neighbours', 'Các bài lân cận và khác biệt.'],
      ['debate', 'Tranh luận trong lĩnh vực.'],
      ['convergence', 'Mức quan tâm, tính khả thi.'],
      ['pico', 'Population, Exposure, Comparison, Outcome.'],
      ['decision', 'Quyết định.'],
    ],
    schema: [`${S}topicCheck.ts`, 'TopicCheckSchema'],
  }),
  concept({
    id: 'research-design-bank',
    name: 'Research design bank',
    labelVi: 'Bank thiết kế nghiên cứu',
    description:
      'Bản Bank nhập cho một project: các mẫu design, threat, loại Claim, metric, Protocol và benchmark, kèm tệp zip gốc.',
    synonyms: ['bank', 'design bank', 'catalog', 'mẫu thiết kế'],
    store: central('researchDesignBanks'),
    fields: [
      ['projectId', 'Project.'],
      ['bank.release', 'Phiên bản Bank.'],
      ['bank.collections', 'Các bộ mẫu.'],
      ['bytes', 'Tệp zip gốc.'],
    ],
    relations: [['belongs-to', 'research-design', 'projectId']],
    schema: ['src/core/storage/collections.ts', 'ResearchDesignBankSchema'],
  }),
  concept({
    id: 'autoresearch-run',
    name: 'AutoResearch run',
    labelVi: 'Lượt AutoResearch',
    description:
      'Một lượt AutoResearch đi qua các stage S1–S12 với PI và Critic: Charter, artifact từng stage, obligation, quyết định và ngân sách.',
    synonyms: ['autoresearch', 'auto research', 'nghiên cứu tự động', 'agent run', 'pi', 'critic'],
    store: central('autoresearchRuns'),
    fields: [
      ['id', 'Mã.'],
      ['projectId', 'Project.'],
      ['status', 'Trạng thái.'],
      ['endReason', 'Lý do kết thúc.'],
      ['charter', 'Charter.'],
      ['pipeline', 'Tiến độ các stage.'],
      ['artifacts', 'Artifact từng stage.'],
      ['obligations', 'Các obligation.'],
      ['decisions', 'Quyết định của người.'],
      ['budget', 'Ngân sách lượt gọi.'],
      ['notebook', 'Sổ ghi chép.'],
    ],
    relations: [
      ['refers-to', 'research-design', 'projectId'],
      ['has-many', 'autoresearch-stage', 'pipeline'],
      ['has-many', 'stage-artifact', 'artifacts'],
      ['has-many', 'obligation', 'obligations'],
    ],
    schema: ['src/core/autoresearch/record.ts', 'runSchema'],
  }),
  concept({
    id: 'charter',
    name: 'Charter',
    labelVi: 'Charter của lượt',
    description:
      'Phạm vi một lượt AutoResearch: câu hỏi, mục tiêu, trong và ngoài phạm vi, tiêu chí thành công, tiêu chí dừng và thái độ rủi ro.',
    synonyms: ['charter', 'phạm vi', 'scope', 'mục tiêu', 'success criteria', 'kill criteria'],
    store: nested('autoresearch-run', 'charter'),
    fields: [
      ['question', 'Câu hỏi.'],
      ['objectives', 'Mục tiêu.'],
      ['scope_in', 'Trong phạm vi.'],
      ['scope_out', 'Ngoài phạm vi.'],
      ['success_criteria', 'Tiêu chí thành công.'],
      ['kill_criteria', 'Tiêu chí dừng.'],
      ['constraints', 'Ràng buộc.'],
      ['risk_posture', 'exploratory hoặc confirmatory.'],
    ],
    schema: ['src/core/autoresearch/contracts.ts', 'charterSchema'],
  }),
  concept({
    id: 'autoresearch-stage',
    name: 'Stage',
    labelVi: 'Stage của AutoResearch',
    description:
      'Trạng thái một stage (S1–S12) ở một lần thử: model đã dùng, đánh giá của Critic và quyết định của PI.',
    synonyms: ['stage', 'bước', 'giai đoạn', 'attempt'],
    store: nested('autoresearch-run', 'pipeline[]'),
    fields: [
      ['stage', 'S1–S12.'],
      ['attempt', 'Lần thử.'],
      ['state', 'Trạng thái.'],
      ['error', 'Lỗi.'],
      ['models', 'Model của lead và Critic.'],
      ['critic', 'Báo cáo của Critic.'],
      ['pi', 'Quyết định của PI.'],
    ],
  }),
  concept({
    id: 'stage-artifact',
    name: 'Stage artifact',
    labelVi: 'Artifact của stage',
    description: 'Đầu ra đã khoá của một stage, có mã băm và các đầu vào để kiểm tra lỗi thời.',
    synonyms: ['artifact', 'đầu ra', 'output'],
    store: nested('autoresearch-run', 'artifacts[]'),
    fields: [
      ['stage', 'Stage.'],
      ['attempt', 'Lần thử.'],
      ['hash', 'Mã băm nội dung.'],
      ['inputHashes', 'Mã băm các đầu vào.'],
      ['status', 'Trạng thái.'],
      ['author', 'Ai viết.'],
      ['model', 'Model.'],
    ],
    schema: ['src/core/autoresearch/record.ts', 'artifactSchema'],
  }),
  concept({
    id: 'obligation',
    name: 'Obligation',
    labelVi: 'Việc phải xử lý',
    description:
      'Một việc mà stage trước giao cho stage sau (ví dụ từ một finding của Critic), theo dõi đến khi xử lý xong.',
    synonyms: ['obligation', 'nghĩa vụ', 'việc cần làm', 'todo', 'follow-up'],
    store: nested('autoresearch-run', 'obligations[]'),
    fields: [
      ['id', 'Mã.'],
      ['sourceStage', 'Stage giao việc.'],
      ['findingId', 'Finding gốc.'],
      ['text', 'Nội dung.'],
      ['targetStage', 'Stage phải xử lý.'],
      ['status', 'open, controlled hoặc unresolved.'],
      ['locator', 'Vị trí xử lý.'],
    ],
    relations: [['refers-to', 'autoresearch-stage', 'targetStage']],
    schema: ['src/core/autoresearch/reviews.ts', 'obligationSchema'],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Lab knowledge graph (D1 tables)
// ---------------------------------------------------------------------------------------------------------------

const KG_CONCEPTS: Concept[] = [
  concept({
    id: 'kg-paper',
    name: 'KG paper',
    labelVi: 'Bài báo trong KG',
    description:
      'Một bài trong đồ thị tri thức của lab, lấy từ OpenAlex (id dạng W…): DOI, tiêu đề, Abstract, năm và số trích dẫn.',
    synonyms: ['kg paper', 'work', 'openalex work', 'bài trong đồ thị', 'publication', 'ấn phẩm'],
    store: kg('paper'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['doi', 'DOI.'],
      ['title', 'Tiêu đề.'],
      ['abstract', 'Abstract.'],
      ['publication_year', 'Năm xuất bản.'],
      ['cited_by_count', 'Số lần được trích.'],
      ['type', 'Loại ấn phẩm.'],
      ['source_id', 'Venue.'],
      ['subfield_id', 'Subfield chính.'],
    ],
    relations: [
      ['belongs-to', 'kg-source', 'source_id'],
      ['belongs-to', 'kg-subfield', 'subfield_id'],
      ['has-many', 'kg-author', 'authored'],
      ['has-many', 'kg-keyword', 'has_keyword'],
      ['has-many', 'kg-topic', 'has_topic'],
      ['refers-to', 'kg-paper', 'cites'],
      ['refers-to', 'kg-paper', 'related_to'],
    ],
  }),
  concept({
    id: 'kg-author',
    name: 'KG author',
    labelVi: 'Tác giả',
    description: 'Một tác giả trong KG, có ORCID khi biết.',
    synonyms: ['author', 'tác giả', 'researcher', 'nhà nghiên cứu', 'orcid'],
    store: kg('author'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['display_name', 'Tên.'],
      ['orcid', 'ORCID.'],
    ],
    relations: [
      ['has-many', 'kg-paper', 'authored'],
      ['refers-to', 'kg-author', 'coauthor'],
    ],
  }),
  concept({
    id: 'kg-keyword',
    name: 'KG keyword',
    labelVi: 'Keyword trong KG',
    description: 'Một keyword OpenAlex trong KG và số bài mang nó.',
    synonyms: ['keyword', 'từ khoá', 'keywords'],
    store: kg('keyword'),
    fields: [
      ['id', 'Mã keyword.'],
      ['text', 'Nội dung.'],
      ['text_normalized', 'Nội dung chuẩn hoá để tìm.'],
      ['frequency', 'Số bài mang keyword.'],
    ],
    relations: [
      ['has-many', 'kg-paper', 'has_keyword'],
      ['refers-to', 'kg-keyword', 'cooccur'],
    ],
  }),
  concept({
    id: 'kg-institution',
    name: 'KG institution',
    labelVi: 'Cơ quan',
    description: 'Một cơ quan (trường, viện) trong KG, có mã ROR và quốc gia.',
    synonyms: ['institution', 'cơ quan', 'trường', 'viện', 'affiliation', 'ror'],
    store: kg('institution'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['display_name', 'Tên.'],
      ['ror', 'Mã ROR.'],
      ['country_code', 'Mã quốc gia.'],
    ],
    relations: [['has-many', 'kg-author', 'affiliated']],
  }),
  concept({
    id: 'kg-source',
    name: 'KG source',
    labelVi: 'Venue (tạp chí, hội nghị)',
    description: 'Một venue trong KG: tạp chí, hội nghị hay kho lưu trữ nơi bài được đăng.',
    synonyms: ['source', 'venue', 'journal', 'tạp chí', 'hội nghị', 'conference'],
    store: kg('source'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['display_name', 'Tên.'],
    ],
  }),
  concept({
    id: 'kg-topic',
    name: 'KG topic',
    labelVi: 'Topic OpenAlex',
    description: 'Một topic của taxonomy OpenAlex, thuộc một subfield.',
    synonyms: ['topic', 'chủ đề', 'openalex topic'],
    store: kg('topic'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['display_name', 'Tên.'],
    ],
    relations: [
      ['belongs-to', 'kg-subfield', 'subfield_of'],
      ['has-many', 'kg-paper', 'has_topic'],
    ],
  }),
  concept({
    id: 'kg-subfield',
    name: 'KG subfield',
    labelVi: 'Subfield',
    description: 'Một subfield của taxonomy OpenAlex, thuộc một field.',
    synonyms: ['subfield', 'chuyên ngành hẹp', 'lĩnh vực con'],
    store: kg('subfield'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['display_name', 'Tên.'],
    ],
    relations: [['belongs-to', 'kg-field', 'field_of']],
  }),
  concept({
    id: 'kg-field',
    name: 'KG field',
    labelVi: 'Field',
    description: 'Một field của taxonomy OpenAlex, thuộc một domain.',
    synonyms: ['field', 'lĩnh vực', 'ngành'],
    store: kg('field'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['display_name', 'Tên.'],
    ],
    relations: [['belongs-to', 'kg-domain', 'domain_of']],
  }),
  concept({
    id: 'kg-domain',
    name: 'KG domain',
    labelVi: 'Domain',
    description: 'Một domain, cấp cao nhất của taxonomy OpenAlex.',
    synonyms: ['domain', 'khối ngành', 'miền'],
    store: kg('domain'),
    fields: [
      ['id', 'Mã OpenAlex.'],
      ['display_name', 'Tên.'],
    ],
  }),
  concept({
    id: 'kg-has-keyword',
    name: 'Paper keyword edge',
    labelVi: 'Cạnh bài – keyword',
    description: 'Cạnh nối một bài với một keyword, kèm điểm liên quan của OpenAlex.',
    synonyms: ['has keyword', 'gắn keyword'],
    store: kg('has_keyword'),
    fields: [
      ['paper_id', 'Bài.'],
      ['keyword_id', 'Keyword.'],
      ['relevance_score', 'Điểm liên quan.'],
    ],
    relations: [
      ['belongs-to', 'kg-paper', 'paper_id'],
      ['refers-to', 'kg-keyword', 'keyword_id'],
    ],
  }),
  concept({
    id: 'kg-cites',
    name: 'Citation edge',
    labelVi: 'Cạnh trích dẫn',
    description: 'Cạnh trích dẫn: bài nguồn trích bài đích. Bài đích có thể nằm ngoài KG đã nạp.',
    synonyms: ['cites', 'citation', 'trích dẫn', 'được trích', 'citation graph', 'đồ thị trích dẫn'],
    store: kg('cites'),
    fields: [
      ['paper_id', 'Bài trích.'],
      ['target_id', 'Bài được trích.'],
    ],
    relations: [
      ['belongs-to', 'kg-paper', 'paper_id'],
      ['refers-to', 'kg-paper', 'target_id'],
    ],
  }),
  concept({
    id: 'kg-related-to',
    name: 'Related work edge',
    labelVi: 'Cạnh bài liên quan',
    description: 'Cạnh nối bài với bài liên quan do OpenAlex gợi ý. Bài đích có thể nằm ngoài KG.',
    synonyms: ['related to', 'related works', 'bài liên quan'],
    store: kg('related_to'),
    fields: [
      ['paper_id', 'Bài.'],
      ['target_id', 'Bài liên quan.'],
    ],
    relations: [
      ['belongs-to', 'kg-paper', 'paper_id'],
      ['refers-to', 'kg-paper', 'target_id'],
    ],
  }),
  concept({
    id: 'kg-authored',
    name: 'Authorship edge',
    labelVi: 'Cạnh tác giả – bài',
    description: 'Cạnh nối tác giả với bài, kèm thứ tự tác giả.',
    synonyms: ['authored', 'authorship', 'đứng tên', 'thứ tự tác giả'],
    store: kg('authored'),
    fields: [
      ['paper_id', 'Bài.'],
      ['author_id', 'Tác giả.'],
      ['position', 'Thứ tự tác giả, từ 1.'],
    ],
    relations: [
      ['belongs-to', 'kg-paper', 'paper_id'],
      ['refers-to', 'kg-author', 'author_id'],
    ],
  }),
  concept({
    id: 'kg-affiliated',
    name: 'Affiliation edge',
    labelVi: 'Cạnh tác giả – cơ quan',
    description: 'Cơ quan của một tác giả trong một bài cụ thể; bài khác có thể ghi cơ quan khác.',
    synonyms: ['affiliated', 'affiliation', 'đơn vị công tác'],
    store: kg('affiliated'),
    fields: [
      ['paper_id', 'Bài.'],
      ['author_id', 'Tác giả.'],
      ['institution_id', 'Cơ quan.'],
    ],
    relations: [
      ['belongs-to', 'kg-paper', 'paper_id'],
      ['refers-to', 'kg-author', 'author_id'],
      ['refers-to', 'kg-institution', 'institution_id'],
    ],
  }),
  concept({
    id: 'kg-coauthor',
    name: 'Co-author edge',
    labelVi: 'Cạnh đồng tác giả',
    description: 'Số bài hai tác giả cùng đứng tên, cập nhật bằng trigger khi thêm hoặc xoá cạnh tác giả.',
    synonyms: ['coauthor', 'co-author', 'đồng tác giả', 'cộng tác'],
    store: kg('coauthor'),
    fields: [
      ['left_id', 'Tác giả thứ nhất.'],
      ['right_id', 'Tác giả thứ hai.'],
      ['count', 'Số bài chung.'],
    ],
    relations: [
      ['refers-to', 'kg-author', 'left_id'],
      ['refers-to', 'kg-author', 'right_id'],
    ],
  }),
  concept({
    id: 'kg-cooccur',
    name: 'Keyword co-occurrence edge',
    labelVi: 'Cạnh keyword đi cùng',
    description: 'Số bài mang cả hai keyword và hệ số Jaccard, cập nhật bằng trigger.',
    synonyms: ['cooccur', 'co-occurrence', 'đồng xuất hiện', 'jaccard'],
    store: kg('cooccur'),
    fields: [
      ['left_id', 'Keyword thứ nhất.'],
      ['right_id', 'Keyword thứ hai.'],
      ['count', 'Số bài chung.'],
      ['jaccard', 'Hệ số Jaccard.'],
    ],
    relations: [
      ['refers-to', 'kg-keyword', 'left_id'],
      ['refers-to', 'kg-keyword', 'right_id'],
    ],
  }),
  concept({
    id: 'kg-has-topic',
    name: 'Paper topic edge',
    labelVi: 'Cạnh bài – topic',
    description: 'Cạnh nối bài với topic OpenAlex, kèm điểm.',
    synonyms: ['has topic', 'gắn topic'],
    store: kg('has_topic'),
    fields: [
      ['paper_id', 'Bài.'],
      ['topic_id', 'Topic.'],
      ['score', 'Điểm.'],
    ],
    relations: [
      ['belongs-to', 'kg-paper', 'paper_id'],
      ['refers-to', 'kg-topic', 'topic_id'],
    ],
  }),
  concept({
    id: 'kg-subfield-of',
    name: 'Topic subfield edge',
    labelVi: 'Cạnh topic – subfield',
    description: 'Topic thuộc subfield nào.',
    synonyms: ['subfield of', 'taxonomy'],
    store: kg('subfield_of'),
    fields: [
      ['topic_id', 'Topic.'],
      ['subfield_id', 'Subfield.'],
    ],
    relations: [
      ['belongs-to', 'kg-topic', 'topic_id'],
      ['refers-to', 'kg-subfield', 'subfield_id'],
    ],
  }),
  concept({
    id: 'kg-field-of',
    name: 'Subfield field edge',
    labelVi: 'Cạnh subfield – field',
    description: 'Subfield thuộc field nào.',
    synonyms: ['field of', 'taxonomy'],
    store: kg('field_of'),
    fields: [
      ['subfield_id', 'Subfield.'],
      ['field_id', 'Field.'],
    ],
    relations: [
      ['belongs-to', 'kg-subfield', 'subfield_id'],
      ['refers-to', 'kg-field', 'field_id'],
    ],
  }),
  concept({
    id: 'kg-domain-of',
    name: 'Field domain edge',
    labelVi: 'Cạnh field – domain',
    description: 'Field thuộc domain nào.',
    synonyms: ['domain of', 'taxonomy'],
    store: kg('domain_of'),
    fields: [
      ['field_id', 'Field.'],
      ['domain_id', 'Domain.'],
    ],
    relations: [
      ['belongs-to', 'kg-field', 'field_id'],
      ['refers-to', 'kg-domain', 'domain_id'],
    ],
  }),
  concept({
    id: 'kg-contribution',
    name: 'Published contribution',
    labelVi: 'Contribution đã công bố vào KG',
    description: 'Một Contribution SCG đã đưa vào KG từ một bài, ở trạng thái candidate hoặc accepted.',
    synonyms: ['kg contribution', 'published contribution', 'đóng góp trong đồ thị'],
    store: kg('contribution'),
    fields: [
      ['id', 'Mã Contribution.'],
      ['published_paper_id', 'Bài đã công bố Contribution.'],
      ['paper_doi', 'DOI.'],
      ['name', 'Tên.'],
      ['description', 'Mô tả.'],
      ['review', 'candidate hoặc accepted.'],
      ['body', 'Toàn bộ Contribution dạng JSON.'],
    ],
    relations: [
      ['refers-to', 'kg-paper', 'paper_doi'],
      ['has-many', 'kg-builds-on', 'builds_on'],
    ],
  }),
  concept({
    id: 'kg-builds-on',
    name: 'Builds-on edge',
    labelVi: 'Cạnh dựa trên',
    description:
      'Contribution dựa trên một Prerequisite, Contribution khác, bài hay công cụ, theo quan hệ prerequisite, reference hoặc match.',
    synonyms: ['builds on', 'dựa trên', 'prerequisite edge'],
    store: kg('builds_on'),
    fields: [
      ['published_paper_id', 'Bài công bố.'],
      ['contribution_id', 'Contribution.'],
      ['prerequisite_id', 'Prerequisite.'],
      ['target_kind', 'prerequisite, contribution, paper hoặc tool.'],
      ['target_id', 'Đích.'],
      ['relation', 'prerequisite, reference hoặc match.'],
      ['review', 'candidate hoặc accepted.'],
    ],
    relations: [['belongs-to', 'kg-contribution', 'contribution_id']],
  }),
  concept({
    id: 'kg-ingest-queue',
    name: 'KG ingest queue item',
    labelVi: 'Hàng đợi nạp KG',
    description: 'Một bài chờ nạp vào KG từ OpenAlex: độ sâu mở rộng, nguồn, số lần thử và bài đã nạp.',
    synonyms: ['ingest', 'queue', 'hàng đợi', 'nạp dữ liệu'],
    store: kg('ingest_queue'),
    fields: [
      ['id', 'Mã yêu cầu.'],
      ['depth', 'Độ sâu mở rộng, 0–2.'],
      ['source', 'seed, expansion hoặc sciatlas_pointer.'],
      ['status', 'pending, processing, done hoặc failed.'],
      ['attempts', 'Số lần thử.'],
      ['next_at', 'Lần thử kế tiếp.'],
      ['resolved_paper_id', 'Bài đã nạp.'],
    ],
    relations: [['refers-to', 'kg-paper', 'resolved_paper_id']],
  }),
  concept({
    id: 'kg-ingest-log',
    name: 'KG ingest log entry',
    labelVi: 'Nhật ký nạp KG',
    description:
      'Một dòng nhật ký nạp KG: mã kết quả, số lần thử và thời điểm thử lại khi bị giới hạn tần suất.',
    synonyms: ['ingest log', 'nhật ký nạp', 'rate limit'],
    store: kg('ingest_log'),
    fields: [
      ['sequence', 'Số thứ tự.'],
      ['id', 'Mã yêu cầu.'],
      ['code', 'Mã kết quả.'],
      ['attempts', 'Số lần thử.'],
      ['at', 'Thời điểm.'],
      ['retry_at', 'Thời điểm thử lại.'],
    ],
    relations: [['refers-to', 'kg-ingest-queue', 'id']],
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// Passage index (docs/plans/PASSAGE_INDEX.md): derived from `papers`, in the central store's D1
// ---------------------------------------------------------------------------------------------------------------

const PASSAGE_CONCEPTS: Concept[] = [
  concept({
    id: 'passage',
    name: 'Passage',
    labelVi: 'Đoạn văn trong chỉ mục',
    description:
      'Một paragraph của full text đã được lập chỉ mục để tìm theo ngữ nghĩa và từ khoá trong một phạm vi dữ liệu: một project ResearchHub, hoặc kho lab (project_id là lab). Mã bài và mã paragraph là neo trích dẫn, mở đúng đoạn trong bài.',
    synonyms: ['passage', 'đoạn văn', 'tìm đoạn văn', 'passage index', 'full text search', 'trích đoạn'],
    store: dataTable('passage'),
    fields: [
      ['project_id', 'Project ResearchHub chứa bài.'],
      ['paper_id', 'Mã bài báo.'],
      ['paragraph_id', 'Mã paragraph trong bài.'],
      ['section_role', 'Vai trò section: Introduction, Methods, Results…'],
      ['ord', 'Thứ tự paragraph trong bài.'],
      ['text', 'Văn bản của paragraph.'],
      ['text_hash', 'Mã băm văn bản; không đổi thì không tính lại embedding.'],
      ['indexed_at', 'Thời điểm lập chỉ mục.'],
    ],
    relations: [
      ['belongs-to', 'paper', 'paper_id'],
      ['refers-to', 'paragraph', 'paragraph_id'],
    ],
  }),
  concept({
    id: 'passage-queue',
    name: 'Passage index queue item',
    labelVi: 'Hàng đợi lập chỉ mục đoạn văn',
    description:
      'Một bài chờ được lập chỉ mục đoạn văn: mỗi lần lưu bài hoặc bấm Lập chỉ mục lại thì bài vào hàng đợi, cron xử lý trong vài phút.',
    synonyms: ['passage queue', 'lập chỉ mục lại', 'reindex', 'hàng đợi chỉ mục'],
    store: dataTable('passage_queue'),
    fields: [
      ['project_id', 'Project ResearchHub.'],
      ['paper_id', 'Mã bài báo.'],
      ['status', 'pending, done hoặc failed.'],
      ['attempts', 'Số lần thử.'],
      ['next_at', 'Lần chạy hoặc thử lại kế tiếp.'],
      ['last_error', 'Mã lỗi gần nhất.'],
    ],
    relations: [['refers-to', 'paper', 'paper_id']],
  }),
];

export const CONCEPTS: readonly Concept[] = [
  ...PAPER_CONCEPTS,
  ...PASSAGE_CONCEPTS,
  ...PAPER_RECORD_CONCEPTS,
  ...MEASUREMENT_CONCEPTS,
  ...CORPUS_CONCEPTS,
  ...DESIGN_CONCEPTS,
  ...KG_CONCEPTS,
];
