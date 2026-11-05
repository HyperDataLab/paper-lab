import { useState } from 'react';
import { analyzeText, toUtf16Span } from '@/core/text';
import type { TextAnalysis } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Skeleton } from '@/shared/ui/Skeleton';
import styles from './page.module.css';

export default function Page() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<TextAnalysis | null>(null);
  const [showTokens, setShowTokens] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setLoading(true);
    setError(null);
    try {
      setResult(await analyzeText(text));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className={styles.page}>
      <h1>Đánh giá</h1>
      <Card>
        <label htmlFor="paragraph">Dán một đoạn văn tiếng Anh</label>
        <textarea id="paragraph" value={text} onChange={(event) => setText(event.target.value)} rows={7} />
        <Button type="button" disabled={loading} onClick={() => void run()}>
          Tách câu
        </Button>
      </Card>
      {loading ? (
        <Skeleton />
      ) : error ? (
        <Card>
          <p role="alert">Không thể tách câu. Vui lòng thử lại.</p>
          <Button onClick={() => void run()}>Thử lại</Button>
          <details>
            <summary>Chi tiết kỹ thuật</summary>
            <code>{error}</code>
          </details>
        </Card>
      ) : result && result.sentences.length > 0 ? (
        <Card>
          <h2>Kết quả</h2>
          <p className={styles.meta}>
            source_hash: {result.sourceHash.slice(0, 19)}… · offset_unit: {result.offsetUnit} ·{' '}
            {result.tokenizerVersion} · {result.segmenterVersion}
          </p>
          <label>
            <input
              type="checkbox"
              checked={showTokens}
              onChange={(event) => setShowTokens(event.target.checked)}
            />{' '}
            Hiện token
          </label>
          <ol className={styles.list}>
            {result.sentences.map((sentence) => {
              const span = toUtf16Span(result.sourceText, sentence);
              const tokens = result.tokens.slice(sentence.tokenStart, sentence.tokenEnd);
              return (
                <li key={sentence.id}>
                  <div>
                    <Badge>{sentence.id}</Badge>{' '}
                    <span className={styles.meta}>
                      {sentence.start}–{sentence.end} · {tokens.length} token
                    </span>
                  </div>
                  <p className={styles.sentence}>{result.sourceText.slice(span.start, span.end)}</p>
                  {showTokens && (
                    <div className={styles.chips}>
                      {tokens.map((token) => (
                        <span className={styles.chip} key={token.index}>
                          {token.text} · {token.kind} · {token.start}–{token.end}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      ) : (
        <EmptyState
          title="Chưa có câu"
          description="Dán đoạn văn và chọn Tách câu để xem kết quả."
          detail="Văn bản được xử lý trên thiết bị của bạn."
        />
      )}
    </div>
  );
}
