import { useMemo, useState } from 'react';
import { createOffsetIndex } from '@/core/text';
import type { TextAnalysis } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Card } from '@/shared/ui/Card';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SentenceView } from './SentenceView';
import type { SyntaxAnalysis } from './useSyntaxAnalysis';
import styles from './page.module.css';
import { roleLabels } from './roleLabels';
import type { useParagraphAnalysis } from './useParagraphAnalysis';
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
      <h2>Kết quả</h2>
      <p className={styles.meta}>
        source_hash: {result.sourceHash.slice(0, 19)}… · offset_unit: {result.offsetUnit} ·{' '}
        {result.tokenizerVersion} · {result.segmenterVersion}
      </p>
      <Checkbox checked={showTokens} onChange={(event) => setShowTokens(event.target.checked)}>
        Hiện token
      </Checkbox>
      <ol className={styles.list}>
        {result.sentences.map((sentence) => {
          const tokens = result.tokens.slice(sentence.tokenStart, sentence.tokenEnd);
          return (
            <li
              key={sentence.id}
              id={`sentence-${sentence.id}`}
              className={selectedSentence === sentence.id ? styles.selectedSentence : undefined}
              aria-current={selectedSentence === sentence.id ? 'true' : undefined}
            >
              <div>
                <Badge>{sentence.id}</Badge>{' '}
                {roles?.find((role) => role.sentenceId === sentence.id) && (
                  <Badge>
                    {roleLabels[roles.find((role) => role.sentenceId === sentence.id)?.role ?? 'unknown']}
                  </Badge>
                )}{' '}
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
