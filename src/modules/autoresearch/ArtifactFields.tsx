import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { charterLabels } from './labels';
import styles from './autoresearch.module.css';

const labels: Record<string, string> = {
  ...charterLabels,
  goal: 'Mục tiêu nghiên cứu',
  problem: 'Vấn đề',
  objective: 'Mục tiêu',
  scope: 'Phạm vi',
  researchable: 'Có thể nghiên cứu',
  rejectionReason: 'Lý do',
  subQuestionIds: 'Câu hỏi liên quan',
  queryId: 'Truy vấn',
  queryIds: 'Truy vấn liên quan',
  paperId: 'Bài báo',
  paperIds: 'Bài báo đối chiếu',
  decisionId: 'Bài đã sàng lọc',
  cardId: 'Thẻ kiến thức',
  cardIds: 'Thẻ kiến thức liên quan',
  evidenceRefs: 'Evidence',
  gapId: 'Research gap',
  hypothesisIds: 'Hypotheses được xem xét',
  subQuestions: 'Câu hỏi thành phần',
  scores: 'Điểm theo đánh giá của AI',
  rationale: 'Lý do',
  overall: 'Điểm trung bình',
  strategies: 'Chiến lược',
  queries: 'Truy vấn',
  query: 'Truy vấn',
  name: 'Tên',
  yearFilter: 'Khoảng năm',
  inclusion: 'Tiêu chí đưa vào',
  exclusion: 'Tiêu chí loại trừ',
  candidates: 'Bài báo ứng viên',
  citationKey: 'Khoá trích dẫn',
  queryLink: 'Liên hệ với truy vấn',
  sources: 'Nguồn',
  existingDecision: 'Quyết định đã lưu',
  decisions: 'Quyết định sàng lọc',
  decision: 'Đề xuất',
  reason: 'Lý do',
  relevance: 'Relevance',
  quality: 'Quality',
  thresholds: 'Ngưỡng',
  cards: 'Thẻ kiến thức',
  method: 'Method',
  data: 'Dataset',
  metrics: 'Metrics',
  findings: 'Findings',
  limitations: 'Limitations',
  evidence_scope: 'Phạm vi Evidence',
  full_text_source: 'Trích dẫn từ Full text',
  sentences: 'Câu gốc',
  section: 'Section',
  page: 'Trang',
  clusters: 'Nhóm chủ đề',
  setAside: 'Thẻ đặt riêng',
  gaps: 'Research gaps',
  summary: 'Tóm tắt',
  text: 'Nội dung',
  hypotheses: 'Hypotheses',
  statement: 'Hypothesis',
  outcome: 'Outcome',
  estimand: 'Estimand',
  prediction: 'Dự đoán',
  falsification: 'Điều kiện bác bỏ',
  criterion: 'Tiêu chí',
  threshold: 'Ngưỡng',
  risk: 'Rủi ro',
  novelty: 'Novelty',
  assessment: 'Đánh giá',
  debateRounds: 'Vòng thảo luận',
  perspectives: 'Góc nhìn',
  views: 'Góc nhìn',
  noveltyMethod: 'Phương pháp đánh giá novelty',
  noveltySearches: 'Tra cứu đối chiếu',
  status: 'Trạng thái',
  retrievedPapers: 'Bài báo để đối chiếu',
  title: 'Title',
  source: 'Nguồn',
  abstract: 'Abstract',
  authors: 'Tác giả',
  venue: 'Nơi xuất bản',
  citations: 'Lượt trích dẫn',
  claims: 'Claims',
  evidence_links: 'Liên kết Evidence',
  rationales: 'Lập luận cho Hypothesis',
  claimId: 'Claim',
  hypothesisId: 'Hypothesis',
  polarity: 'Chiều lập luận',
  relation: 'Quan hệ',
  year: 'Năm',
};
const values: Record<string, string> = {
  included: 'Đưa vào',
  excluded: 'Loại trừ',
  uncertain: 'Chưa chắc',
  pool_context: 'Bài có sẵn trong tập bài',
  matched_harvest: 'Trùng truy vấn đã dùng khi tìm bài',
  heuristic: 'Heuristic',
  pool: 'Tập bài của project',
  openalex_abstract: 'Abstract từ OpenAlex',
  local_abstract: 'Abstract trên máy này',
  abstract: 'Abstract',
  full_text: 'Full text',
  unavailable: 'Không tra cứu được',
  retrieved: 'Đã tra cứu',
};
const technical = /(?:^(?:id|paper_id|cite_key|source_records|meta|quote_anchors|key)$|Ids?$|Refs?$)/u;

type References = Map<string, Map<string, string>>;
function render(value: unknown, path: string, references?: References): ReactNode {
  if (value == null) return 'Chưa xác định';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
  if (typeof value === 'string') return Object.hasOwn(values, value) ? values[value] : value;
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Không có mục nào';
    return (
      <ul className={styles.rows}>
        {value.map((item: unknown, index) => (
          <li key={`${path}-${index}`}>{render(item, `${path}-${index}`, references)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value !== 'object') return null;
  return (
    <dl className={styles.fields}>
      {Object.entries(value)
        .filter(([key]) => !technical.test(key) || references?.has(key))
        .filter(([key, item]) => key !== 'paperId' || references?.get(key)?.has(String(item)))
        .map(([key, item]) => {
          const lookup = references?.get(key);
          const display = lookup
            ? Array.isArray(item)
              ? item.map((id: unknown) => lookup.get(String(id)) ?? null)
              : (lookup.get(String(item)) ?? null)
            : item;
          return (
            <Fragment key={key}>
              <dt>{labels[key] ?? key.replace(/([a-z])([A-Z])/gu, '$1 $2').replaceAll('_', ' ')}</dt>
              <dd>{render(display, `${path}-${key}`, references)}</dd>
            </Fragment>
          );
        })}
    </dl>
  );
}

export function ArtifactFields({ value, references }: { value: unknown; references?: References }) {
  return render(value, 'ar', references);
}
