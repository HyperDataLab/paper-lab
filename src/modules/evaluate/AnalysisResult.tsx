import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createOffsetIndex } from '@/core/text';
import type { TextAnalysis } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { SentenceView } from './SentenceView';
import { SyntaxControls } from './SyntaxControls';
import type { SyntaxAnalysis } from './useSyntaxAnalysis';
import styles from './page.module.css';
export function AnalysisResult({
  result,
  readOnly,
  saved,
  saving,
  onSave,
  syntax,
  onAnalyze,
}: {
  result: TextAnalysis;
  readOnly: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  syntax: SyntaxAnalysis;
  onAnalyze: () => void;
}) {
  const [showTokens, setShowTokens] = useState(false);
  const index = useMemo(() => createOffsetIndex(result.sourceText), [result.sourceText]);
  const byId = useMemo(
    () => new Map((syntax.annotations ?? []).map((annotation) => [annotation.sentenceId, annotation])),
    [syntax.annotations],
  );
  return (
    <Card>
      <h2>Kết quả</h2>
      {!readOnly && (
        <Button disabled={saved || saving || syntax.running} onClick={onSave}>
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
      <SyntaxControls syntax={syntax} readOnly={readOnly} onRun={onAnalyze} />
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
          const tokens = result.tokens.slice(sentence.tokenStart, sentence.tokenEnd);
          return (
            <li key={sentence.id}>
              <div>
                <Badge>{sentence.id}</Badge>{' '}
                <span className={styles.meta}>
                  {sentence.start}–{sentence.end} · {tokens.length} token
                </span>
              </div>
              <SentenceView index={index} sentence={sentence} annotation={byId.get(sentence.id)} />
              {showTokens && (
                <div className={styles.chips}>
                  {tokens.map((token) => (
                    <span className={styles.chip} key={token.index}>
                      [{token.index}] {token.text} · {token.kind} · {token.start}–{token.end}
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
