import { useState } from 'react';
import type { SciAtlasPaper } from '@/core/openkg';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import styles from './sciatlas.module.css';

const linkOf = (paper: SciAtlasPaper) =>
  paper.doi
    ? { href: `https://doi.org/${paper.doi}`, label: `DOI ${paper.doi}` }
    : paper.openalexId
      ? { href: `https://openalex.org/${paper.openalexId}`, label: `OpenAlex ${paper.openalexId}` }
      : null;

export function SciAtlasResults({
  papers,
  known,
  onAdd,
}: {
  papers: SciAtlasPaper[];
  /** A label such as "Đã có trong corpus" when the paper is already held, else undefined. */
  known?: (paper: SciAtlasPaper) => string | undefined;
  /** Adds a paper with a DOI to the corpus; absent where there is nothing to add to. */
  onAdd?: (paper: SciAtlasPaper) => Promise<void>;
}) {
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string>();
  if (!papers.length)
    return <p className={styles.muted}>SciAtlas không trả về bài nào cho các anchor này.</p>;
  return (
    <>
      <ol className={styles.results} aria-label="Bài liên quan theo SciAtlas">
        {papers.map((paper) => {
          const link = linkOf(paper);
          const held =
            known?.(paper) ?? (paper.doi && added.has(paper.doi) ? 'Đã thêm vào corpus' : undefined);
          const meta = [
            paper.year ?? 'chưa rõ năm',
            paper.venue,
            paper.citations !== null ? `${paper.citations} trích dẫn` : null,
            paper.score !== null ? `score ${Number(paper.score.toFixed(3))}` : null,
          ].filter((value) => value !== null && value !== undefined && value !== '');
          return (
            <li key={`${paper.rank}-${paper.title}`}>
              <div className={styles.resultHead}>
                <strong>{paper.title}</strong>
                {held ? (
                  <Badge tone="success">{held}</Badge>
                ) : (
                  onAdd &&
                  paper.doi && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setFailed(undefined);
                        void onAdd(paper)
                          .then(() => setAdded((previous) => new Set(previous).add(paper.doi as string)))
                          .catch((cause: unknown) => setFailed(String(cause)));
                      }}
                    >
                      Thêm vào corpus
                    </Button>
                  )
                )}
              </div>
              <p className={styles.muted}>
                {meta.join(' · ')}
                {link && (
                  <>
                    {' · '}
                    <a href={link.href} target="_blank" rel="noreferrer">
                      {link.label}
                    </a>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ol>
      {failed && <p role="alert">Không thêm được bài vào corpus. {failed}</p>}
    </>
  );
}
