import { useMemo, useState } from 'react';
import { createOffsetIndex } from '@/core/text';
import type { TextAnalysis } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SentenceView } from './SentenceView';
import type { SyntaxAnalysis } from './useSyntaxAnalysis';
import styles from './sentences.module.css';
import { roleLabels } from './roleLabels';
import type { useParagraphAnalysis } from './useParagraphAnalysis';

/** Every sentence with its offsets, its parse (once run) and, on request, its tokens. */
export function AnalysisResult({
  result,
  syntax,
  roles,
  selectedSentence,
}: {
  result: TextAnalysis;
  syntax: SyntaxAnalysis;
  roles?: NonNullable<ReturnType<typeof useParagraphAnalysis>['result']>['roles'];
  selectedSentence?: string | null;
}) {
  const [showTokens, setShowTokens] = useState(false);
  const index = useMemo(() => createOffsetIndex(result.sourceText), [result.sourceText]);
  const byId = useMemo(
    () => new Map((syntax.annotations ?? []).map((annotation) => [annotation.sentenceId, annotation])),
    [syntax.annotations],
  );
  return (
    <Card>
      <div className={styles.head}>
        <div>
          <h2>Câu và số liệu</h2>
          <p className={styles.tech} title={`source_hash: ${result.sourceHash}`}>
            {result.sentences.length} câu · {result.tokens.length} token · offset {result.offsetUnit} ·{' '}
            {result.tokenizerVersion} · {result.segmenterVersion}
          </p>
        </div>
        <Checkbox checked={showTokens} onChange={(event) => setShowTokens(event.target.checked)}>
          Hiện token
        </Checkbox>
      </div>
      {syntax.annotations ? (
        <ul className={styles.legend} aria-label="Cách đọc gạch chân">
          <li>
            <span className={styles.keySubject}>Chủ ngữ</span>
          </li>
          <li>
            <span className={styles.keyVerb}>Động từ chính</span>
          </li>
          <li>
            <span className={styles.keyGap}>Phần xen giữa chủ–vị</span>
          </li>
        </ul>
      ) : (
        <p className={styles.hint}>
          Chạy Phân tích câu (AI) để thấy chủ ngữ, động từ chính và Topic, Action, Stress của từng câu.
        </p>
      )}
      <ol className={styles.sentences}>
        {result.sentences.map((sentence) => {
          const tokens = result.tokens.slice(sentence.tokenStart, sentence.tokenEnd);
          const role = roles?.find((item) => item.sentenceId === sentence.id);
          return (
            <li
              key={sentence.id}
              id={`sentence-${sentence.id}`}
              className={`${styles.row} ${selectedSentence === sentence.id ? styles.selected : ''}`}
              aria-current={selectedSentence === sentence.id ? 'true' : undefined}
            >
              <span className={styles.index}>{sentence.id}</span>
              <div className={styles.content}>
                <div className={styles.rowMeta}>
                  {role && (
                    <Badge tone={role.role === 'off_topic' ? 'warning' : 'accent'}>
                      {roleLabels[role.role]}
                    </Badge>
                  )}
                  <span>
                    Ký tự {sentence.start}–{sentence.end} · {tokens.length} token
                  </span>
                </div>
                <SentenceView index={index} sentence={sentence} annotation={byId.get(sentence.id)} />
                {showTokens && (
                  <div className={styles.tokens}>
                    {tokens.map((token) => (
                      <span
                        className={styles.token}
                        key={token.index}
                        title={`${token.kind} · ${token.start}–${token.end}`}
                      >
                        <small>{token.index}</small>
                        {token.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
