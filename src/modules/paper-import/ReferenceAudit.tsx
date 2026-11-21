import { useState } from 'react';
import type { AuditItem } from '@/core/referenceAudit/schema';
import type { PaperContextRecord } from '@/core/schemas';
import type { ReferenceItem } from '@/core/scholarlyContext';
import { labResearchErrorMessage } from '@/shared/labResearch';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { useReferenceAudit } from './useReferenceAudit';

const labels: Record<AuditItem['verdict'], string> = {
  matched: 'Khớp hồ sơ',
  mismatch: 'Lệch thông tin',
  not_registered: 'DOI chưa đăng ký với Crossref',
  unresolved: 'Chưa tìm được bản ghi khớp',
  error: 'Lỗi tra cứu',
};
const fields: Record<AuditItem['mismatches'][number]['field'], string> = {
  year: 'Năm',
  title: 'Nhan đề',
  first_author: 'Tác giả đầu',
  journal: 'Tạp chí',
  volume: 'Tập',
  pages: 'Trang',
};
const filters = [
  { value: 'all', label: 'Tất cả' },
  { value: 'mismatch', label: 'Lệch thông tin' },
  { value: 'unresolved', label: 'Chưa xác định' },
  { value: 'not_registered', label: 'DOI chưa đăng ký' },
  { value: 'error', label: 'Lỗi' },
];
export function ReferenceAudit({
  paperId,
  references,
  record,
  onSave,
}: {
  paperId: string;
  references: ReferenceItem[];
  record: PaperContextRecord | undefined;
  onSave: (record: PaperContextRecord) => void;
}) {
  const [filter, setFilter] = useState('all');
  const audit = record?.referenceAudit;
  const tool = useReferenceAudit(paperId, references, record, onSave);
  return (
    <section aria-label="Đối chiếu tài liệu">
      <h3>Đối chiếu tài liệu với Crossref</h3>
      <p>
        Chỉ đối chiếu metadata. Mục chưa tìm được có thể là sách, báo cáo hoặc nguồn ngoài Crossref và cần
        kiểm tra thủ công. Kết quả không kết luận tài liệu được bịa ra.
      </p>
      <p>Nội dung từng references hoặc DOI sẽ được gửi tới máy chủ nghiên cứu của lab.</p>
      {references.length > 400 && <p>Chỉ đối chiếu 400 tài liệu đầu tiên.</p>}
      <Button disabled={tool.running || references.length === 0} onClick={() => void tool.run()}>
        Đối chiếu tài liệu với Crossref
      </Button>
      {tool.running && (
        <>
          <span role="status">
            Đã đối chiếu {tool.progress}/{Math.min(references.length, 400)}
          </span>{' '}
          <Button onClick={tool.stop}>Dừng</Button>
        </>
      )}
      {tool.error != null && (
        <div role="alert">
          <p>{labResearchErrorMessage(tool.error)}</p>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {tool.error instanceof Error ? tool.error.message : String(tool.error)}
          </details>
        </div>
      )}
      {audit && (
        <>
          <p>
            {(Object.keys(labels) as AuditItem['verdict'][])
              .map((key) => `${labels[key]}: ${audit.items.filter((item) => item.verdict === key).length}`)
              .join(' · ')}
          </p>
          <SegmentedControl
            label="Lọc kết quả đối chiếu"
            value={filter}
            options={filters}
            onChange={setFilter}
          />
          <ol>
            {audit.items
              .filter((item) => filter === 'all' || item.verdict === filter)
              .sort((a, b) => a.index - b.index)
              .map((item) => (
                <li key={`${item.index}-${item.textHash}`}>
                  <span>#{item.index + 1} </span>
                  <Badge>{labels[item.verdict]}</Badge>
                  {item.record?.title && (
                    <p>
                      <a href={`https://doi.org/${item.record.doi}`} target="_blank" rel="noreferrer">
                        {item.record.title}
                      </a>
                    </p>
                  )}
                  {item.mismatches.map((m) => (
                    <p key={m.field}>
                      {fields[m.field]}: {m.stated ? `ghi ${m.stated}, ` : ''}hồ sơ {m.record}
                    </p>
                  ))}
                  {item.notes.includes('online_first_year') && <p>Có thể là năm bản online khác năm in</p>}
                  {item.notes.includes('no_doi_in_text') && <p>Tra cứu theo nội dung vì mục không có DOI.</p>}
                  {item.notes.includes('no_title_match') && <p>Nhan đề chưa khớp với bản ghi tìm được.</p>}
                  {item.notes.includes('score_low') && <p>Chưa đủ evidence để chọn bản ghi.</p>}
                  <Checkbox
                    checked={audit.reviewed.includes(item.textHash)}
                    disabled={tool.running}
                    onChange={(e) => void tool.review(item.textHash, e.target.checked)}
                  >
                    Đã kiểm tra
                  </Checkbox>
                </li>
              ))}
          </ol>
        </>
      )}
    </section>
  );
}
