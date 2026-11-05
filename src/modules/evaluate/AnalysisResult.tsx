import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toUtf16Span } from '@/core/text';
import type { TextAnalysis } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import styles from './page.module.css';
export function AnalysisResult({
  result,
  readOnly,
  saved,
  saving,
  onSave,
}: {
  result: TextAnalysis;
  readOnly: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const [showTokens, setShowTokens] = useState(false);
  return (
    <Card>
      <h2>Kết quả</h2>
      {!readOnly && (
        <Button disabled={saved || saving} onClick={onSave}>
          {saved ? 'Đã lưu' : 'Lưu vào lịch sử'}
        </Button>
      )}
      {saved && (
        <p role="status">
          Đã lưu. <Link to="/history">Xem trong Lịch sử</Link>
        </p>
      )}
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
  );
}
