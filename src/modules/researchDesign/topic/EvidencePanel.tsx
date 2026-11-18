import { labResearchErrorMessage } from '@/shared/labResearch';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DebateList } from './DebateList';
import { PaperRow } from './PaperRow';
import { YearBars } from './YearBars';
import { BlurField } from './BlurField';
import { topicSearchText, useTopicTools } from './useTopicTools';
import type { Props } from './types';

export function EvidencePanel(props: Props) {
  const { check, change } = props;
  const { run, running, error } = useTopicTools(props);
  const sorted = [...check.evidence].sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  const duplication = sorted.find((e) => e.kind === 'duplication');
  const saturation = sorted.find((e) => e.kind === 'saturation');
  const debate = sorted.find((e) => e.kind === 'debate');
  const impact = sorted.find((e) => e.kind === 'impact');
  const info = (e: NonNullable<typeof duplication | typeof saturation | typeof debate | typeof impact>) => (
    <p>
      {new Date(e.ranAt).toLocaleString('vi-VN')} · Truy vấn: {e.queryUsed}
      {e.broadenedFrom && ` · đã nới truy vấn từ ${e.broadenedFrom}`}
    </p>
  );
  return (
    <Card>
      <h3>Evidence từ công cụ</h3>
      <BlurField
        label="Từ khoá tìm kiếm (tiếng Anh)"
        placeholder="Ví dụ: large language models title abstract screening systematic reviews"
        value={check.searchQuery ?? ''}
        save={(value) => change((c) => ({ ...c, searchQuery: value }))}
      />
      <p>
        Cơ sở dữ liệu học thuật chủ yếu bằng tiếng Anh. Để trống thì công cụ dùng phát biểu đề tài. Kết quả là
        đầu mối để mở và đọc, không phải kết luận.
      </p>
      <Button disabled={running || !topicSearchText(check)} onClick={() => void run('duplication')}>
        Tìm bài gần nhất
      </Button>{' '}
      <Button disabled={running || !topicSearchText(check)} onClick={() => void run('saturation')}>
        Đếm nghiên cứu theo năm
      </Button>{' '}
      <Button disabled={running || !topicSearchText(check)} onClick={() => void run('debate')}>
        Bản đồ tranh luận
      </Button>{' '}
      <Button
        disabled={running || !check.neighbours.some((n) => n.ref.trim())}
        onClick={() => void run('impact')}
      >
        Quỹ đạo trích dẫn bài gần nhất
      </Button>
      {error != null && (
        <div role="alert">
          <p>{labResearchErrorMessage(error)}</p>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            {error instanceof Error ? error.message : String(error)}
          </details>
        </div>
      )}
      {duplication && (
        <section>
          <h4>Bài gần nhất</h4>
          {info(duplication)}
          <ul>
            {duplication.result.neighbours.map((paper) => (
              <PaperRow key={paper.id} paper={paper} {...props} />
            ))}
          </ul>
          {duplication.result.existing_reviews && (
            <>
              <h4>Tổng quan hiện có</h4>
              <ul>
                {duplication.result.existing_reviews.map((paper) => (
                  <PaperRow key={paper.id} paper={paper} review {...props} />
                ))}
              </ul>
              <p>Hãy mở các bài tổng quan và đánh giá phương pháp của chúng.</p>
            </>
          )}
          {duplication.result.existing_protocols && (
            <>
              <h4>Đề cương hiện có</h4>
              <ul>
                {duplication.result.existing_protocols.map((paper) => (
                  <PaperRow key={paper.id} paper={paper} {...props} />
                ))}
              </ul>
            </>
          )}
          <p>Các bài là đầu mối, không phải kết luận.</p>
          {check.track === 'review' && <p>PROSPERO không được bao phủ.</p>}
        </section>
      )}
      {saturation && (
        <section>
          <h4>Số nghiên cứu theo năm</h4>
          {info(saturation)}
          <p>
            {saturation.result.window} · Ước tính {saturation.result.total_estimate} bài
          </p>
          <YearBars counts={saturation.result.counts_by_year} />
          <ul>
            {saturation.result.closest_recent.map((paper) => (
              <PaperRow key={paper.id} paper={paper} {...props} />
            ))}
          </ul>
          <p>
            Số lượng là ước tính và phụ thuộc vào cách diễn đạt truy vấn; đây là đầu mối, không phải kết luận.
          </p>
        </section>
      )}
      {debate && (
        <section>
          <h4>Bản đồ tranh luận</h4>
          {info(debate)}
          <DebateList result={debate.result} {...props} />
          <p>Đây là các đầu mối, không phải kết luận; số lượng là ước tính và phụ thuộc vào cách diễn đạt.</p>
        </section>
      )}
      {impact && (
        <section>
          <h4>Quỹ đạo trích dẫn</h4>
          {info(impact)}
          {impact.result.papers.map((item) => (
            <div key={item.ref}>
              {item.paper ? (
                <>
                  <ul>
                    <PaperRow paper={item.paper} {...props} />
                  </ul>
                  <YearBars counts={item.paper.counts_by_year} />
                </>
              ) : (
                <div>
                  <p>{item.ref}: Không tải được bài.</p>
                  {item.error && (
                    <details>
                      <summary>Chi tiết kỹ thuật</summary>
                      {item.error}
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
          <p>Các số liệu là đầu mối, không phải kết luận.</p>
        </section>
      )}
    </Card>
  );
}
