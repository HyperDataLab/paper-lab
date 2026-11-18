import { useEffect, useId, useMemo, useState } from 'react';
import { addFromDois } from '@/core/corpus/intake';
import {
  corpusSciAtlasAnchors,
  normalizeSciAtlasDoi,
  normalizeSciAtlasOpenAlexId,
  type CorpusKg,
  type SciAtlasPaper,
} from '@/core/openkg';
import type { Corpus } from '@/core/schemas/corpus';
import { SciAtlasPanel } from '@/shared/openkg/SciAtlasPanel';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Card } from '@/shared/ui/Card';
import openKgStyles from '@/shared/ui/openkg/openkg.module.css';
import { CorpusOpenKgView } from './CorpusOpenKgView';
import styles from './corpus.module.css';

function heldIds(corpus: Corpus) {
  return new Set(
    corpus.members.flatMap(({ identifiers }) =>
      [
        identifiers.doi,
        ...(identifiers.doiAliases ?? []),
        identifiers.openalexId,
        ...(identifiers.openalexIdAliases ?? []),
      ].flatMap((value) => {
        const id = normalizeSciAtlasDoi(value) ?? normalizeSciAtlasOpenAlexId(value);
        return id ? [id] : [];
      }),
    ),
  );
}

export function CorpusOpenKg({
  corpus,
  save,
}: {
  corpus: Corpus;
  /** Saves the corpus; with it, SciAtlas results can be added to the corpus by DOI. */
  save?: (value: Corpus) => Promise<void>;
}) {
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
  // The last graph keeps the SciAtlas panel (and its results) on screen while the graph rebuilds after an add.
  const lastGraph = result?.graph;
  const anchors = useMemo(() => (lastGraph ? corpusSciAtlasAnchors(lastGraph) : undefined), [lastGraph]);
  const held = useMemo(() => heldIds(corpus), [corpus]);
  const known = (paper: SciAtlasPaper) =>
    (paper.doi && held.has(paper.doi)) || (paper.openalexId && held.has(paper.openalexId))
      ? 'Đã có trong corpus'
      : undefined;
  const add = save
    ? async (paper: SciAtlasPaper) => {
        if (!paper.doi) return;
        await save(addFromDois(corpus, paper.doi).corpus);
      }
    : undefined;
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
        {anchors && <SciAtlasPanel anchors={anchors} known={known} onAdd={add} />}
      </section>
    </Card>
  );
}
