import { useState } from 'react';
import { candidateFromWork } from '@/core/extraction/deep';
import { recordTopicSearch } from '@/core/corpus/topic';
import { currentRound, recordUpdateSearch, updateQueries } from '@/core/corpus/updateSearch';
import type { Candidate, Corpus } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { ScreeningList } from './ScreeningList';
import { SearchImport } from './SearchImport';
import { SnowballPanel } from './SnowballPanel';
import styles from './corpus.module.css';

const candidatesOf = (works: unknown[], query: string) =>
  works.map((work) => candidateFromWork(work, query)).filter((item): item is Candidate => item !== null);

export function TopicSearch({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const queries = updateQueries(corpus);
  const round = currentRound(corpus);
  async function search() {
    setBusy(true);
    setError('');
    try {
      const body = corpus.protocol.at(-1)?.body;
      const years = body?.years ?? [];
      const result = await createScholarClient({}).searchWorks(query, {
        fromYear: years.length ? Math.min(...years) : null,
        toYear: years.length ? Math.max(...years) : null,
        perPage: 50,
      });
      await save(
        recordTopicSearch(
          corpus,
          candidatesOf(result.results, query),
          result.url,
          result.total,
          result.results.length,
          new Date().toISOString(),
        ),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  /** Living review: every stored query again, only for works published after its last run. */
  async function update() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const client = createScholarClient({});
      const at = new Date().toISOString();
      let next = corpus;
      for (const item of queries) {
        const result = await client.fetchWorks(item.url);
        const candidates = candidatesOf(result.results, item.query);
        next = recordUpdateSearch(
          next,
          candidates,
          { url: result.url, total: result.total, retrieved: candidates.length },
          round + 1,
          at,
        );
      }
      await save(next);
      const added = next.searches.slice(corpus.searches.length).reduce((sum, s) => sum + (s.added ?? 0), 0);
      setMessage(
        `Lần cập nhật ${round + 1}: chạy lại ${queries.length} truy vấn, thêm ${added} bản ghi mới.`,
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2>Tìm bài</h2>
      <TextField label="Truy vấn OpenAlex" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className={styles.cardTools}>
        <Button onClick={() => void search()} disabled={busy || !query.trim()}>
          Tìm bài
        </Button>
        <Button variant="ghost" onClick={() => void update()} disabled={busy || queries.length === 0}>
          Cập nhật tìm kiếm
        </Button>
      </div>
      {error && <p role="alert">Không tìm được bài: {error}</p>}
      {message && <p className={styles.muted}>{message}</p>}
      <p>
        {corpus.searches.length} lượt tìm kiếm
        {round > 0 ? `, ${round} lần cập nhật` : ''}. Cập nhật chạy lại mỗi truy vấn OpenAlex từ ngày sau lần
        chạy gần nhất.
      </p>
      <SearchImport corpus={corpus} save={save} />
      <SnowballPanel corpus={corpus} save={save} />
      <ScreeningList corpus={corpus} save={save} />
    </Card>
  );
}
