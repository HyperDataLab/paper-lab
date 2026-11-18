import { useEffect, useId, useState } from 'react';
import type { CorpusKg } from '@/core/openkg';
import type { Corpus } from '@/core/schemas/corpus';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Card } from '@/shared/ui/Card';
import openKgStyles from '@/shared/ui/openkg/openkg.module.css';
import { CorpusOpenKgView } from './CorpusOpenKgView';
import styles from './corpus.module.css';

export function CorpusOpenKg({ corpus }: { corpus: Corpus }) {
  const { corpusOpenKg } = useRepositories();
  const heading = useId();
  const [result, setResult] = useState<{ corpus: Corpus; graph?: CorpusKg; error?: string }>();
  useEffect(() => {
    const subscription = corpusOpenKg.observe(corpus).subscribe({
      next: (graph) => setResult({ corpus, graph }),
      error: (cause: unknown) => setResult({ corpus, error: String(cause) }),
    });
    return () => subscription.unsubscribe();
  }, [corpus, corpusOpenKg]);

  const current = result?.corpus === corpus ? result : undefined;
  return (
    <Card>
      <section aria-labelledby={heading} aria-busy={!current} className={openKgStyles.workspace}>
        <div className={styles.cardHead}>
          <h2 id={heading}>Đồ thị tri thức (OpenKG)</h2>
        </div>
        {current?.graph ? (
          <CorpusOpenKgView kg={current.graph} corpusId={corpus.id} title={corpus.title} />
        ) : current?.error ? (
          <div>
            <p role="alert">Không đọc được dữ liệu của đồ thị tri thức.</p>
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {current.error}
            </details>
          </div>
        ) : (
          <p className={openKgStyles.muted}>Đang tải đồ thị tri thức…</p>
        )}
      </section>
    </Card>
  );
}
