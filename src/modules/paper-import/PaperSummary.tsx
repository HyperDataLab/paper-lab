import type { FindingLocation } from '@/core/paperFindings';
import { summarizePaper, type SummaryQuote } from '@/core/paperSummary';
import type { Paper, PaperInsightsRecord, SnapshotField } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { placeLabel } from './paperLabels';
import { CriterionMark } from './SectionBlock';
import styles from './summary.module.css';

const FACTS: Record<SnapshotField, string> = {
  methods: 'Methods',
  outcome: 'Outcome',
  results: 'Results',
  population: 'Population',
  sample_size: 'Sample size',
  duration: 'Duration',
  location: 'Location',
};
const SHOWN_LIMITS = 3;

/**
 * The landing view: what the author is saying, in their own quoted words. It reads what the analyses
 * stored and runs nothing itself; a part whose analysis has not run offers to open it instead.
 */
export function PaperSummary({
  paper,
  insights,
  onLocation,
  onOpen,
}: {
  paper: Paper;
  insights: PaperInsightsRecord | undefined;
  onLocation: (location: FindingLocation) => void;
  onOpen: (view: 'moves' | 'snapshot' | 'toulmin' | 'reporting') => void;
}) {
  const summary = summarizePaper(insights);
  const place = (quote: SummaryQuote) => (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => onLocation({ paragraphId: quote.paragraphId, start: quote.start, end: quote.end })}
    >
      {placeLabel(paper, quote.paragraphId)}
    </Button>
  );
  const quotes = (items: SummaryQuote[], empty: string) =>
    items.length === 0 ? (
      <p className={styles.muted}>{empty}</p>
    ) : (
      <ul className={styles.quotes}>
        {items.map((item) => (
          <li key={item.id}>
            <span>“{item.excerpt}”</span> {place(item)}
          </li>
        ))}
      </ul>
    );
  const missing = (text: string, view: Parameters<typeof onOpen>[0]) => (
    <p className={styles.missing}>
      <span>{text}</span>
      <Button size="sm" onClick={() => onOpen(view)}>
        Mở để phân tích
      </Button>
    </p>
  );
  return (
    <Card padding="md">
      <div className={styles.summary}>
        <section aria-labelledby="summary-question">
          <h2 id="summary-question">
            <CriterionMark criterion="claim" /> Research gap & contribution
          </h2>
          {summary.has.rhetoric ? (
            <div className={styles.pair}>
              <div>
                <h3>Gap</h3>
                {quotes(summary.gap, 'Chưa thấy câu nêu khoảng trống trong các mục đã đọc.')}
              </div>
              <div>
                <h3>Contribution</h3>
                {quotes(summary.contribution, 'Chưa thấy câu nêu đóng góp trong các mục đã đọc.')}
              </div>
            </div>
          ) : (
            missing('Chưa phân tích cách tác giả dẫn dắt.', 'moves')
          )}
        </section>

        <section aria-labelledby="summary-facts">
          <h2 id="summary-facts">
            <CriterionMark criterion="evidence" /> Key facts
          </h2>
          {!summary.has.snapshot ? (
            missing('Chưa trích thông tin cốt lõi (1 lượt gọi AI).', 'snapshot')
          ) : summary.facts.length === 0 ? (
            <p className={styles.muted}>Không có thông tin nào kèm được câu trích trong bài.</p>
          ) : (
            <dl className={styles.facts}>
              {summary.facts.map((fact) => (
                <div key={fact.id} className={styles.fact}>
                  <dt>{FACTS[fact.field]}</dt>
                  <dd>
                    <strong>{fact.value}</strong>
                    {fact.source && place(fact.source)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section aria-labelledby="summary-claims">
          <h2 id="summary-claims">
            <CriterionMark criterion="claim" /> Main claims
          </h2>
          {!summary.has.arguments ? (
            missing('Chưa phân tích lập luận.', 'toulmin')
          ) : summary.claims.length === 0 ? (
            <p className={styles.muted}>Chưa xác định được luận điểm chính trong các mục đã đọc.</p>
          ) : (
            <ol className={styles.claims}>
              {summary.claims.map((item) => (
                <li key={item.id}>
                  <p className={styles.claim}>
                    <strong>“{item.claim.excerpt}”</strong> {place(item.claim)}
                  </p>
                  <dl className={styles.support}>
                    <dt>Grounds</dt>
                    <dd>
                      {item.data.length === 0 ? (
                        <span className={styles.muted}>Not identified</span>
                      ) : (
                        quotes(item.data, '')
                      )}
                    </dd>
                    {item.warrant && (
                      <>
                        <dt>Warrant</dt>
                        <dd>
                          {item.warrant.text}{' '}
                          <Badge tone={item.warrant.inferred ? 'warning' : 'neutral'}>
                            {item.warrant.inferred ? 'AI suy ra, không phải lời tác giả' : 'Tác giả nêu'}
                          </Badge>
                        </dd>
                      </>
                    )}
                    {item.limits.length > 0 && (
                      <>
                        <dt>Qualifiers & rebuttals</dt>
                        <dd>{quotes(item.limits, '')}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
            </ol>
          )}
          {summary.has.arguments && (
            <Button size="sm" variant="ghost" onClick={() => onOpen('toulmin')}>
              Xem toàn bộ lập luận
            </Button>
          )}
        </section>

        {summary.has.rhetoric && (
          <section aria-labelledby="summary-limits">
            <h2 id="summary-limits">
              <CriterionMark criterion="evidence" /> Stated limitations <Badge>{summary.limits.length}</Badge>
            </h2>
            {quotes(
              summary.limits.slice(0, SHOWN_LIMITS),
              'Chưa thấy tác giả nêu giới hạn trong các mục đã đọc.',
            )}
            {summary.limits.length > SHOWN_LIMITS && (
              <Button size="sm" variant="ghost" onClick={() => onOpen('reporting')}>
                Xem cả {summary.limits.length} giới hạn
              </Button>
            )}
          </section>
        )}
        <p className={styles.muted}>
          Mọi câu ở trên là câu trích từ bài, do AI chọn và code đối chiếu lại. Đây là mô tả điều tác giả
          viết, không phải kết luận bài đúng hay sai.
        </p>
      </div>
    </Card>
  );
}
