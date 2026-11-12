import { useState } from 'react';
import { candidateFromWork } from '@/core/extraction/deep';
import { recordTopicSearch } from '@/core/corpus/topic';
import type { Candidate, Corpus } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { ScreeningList } from './ScreeningList';
import { SearchImport } from './SearchImport';

export function TopicSearch({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
      const candidates = result.results
        .map((work) => candidateFromWork(work, query))
        .filter((item): item is Candidate => item !== null);
      await save(
        recordTopicSearch(
          corpus,
          candidates,
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
  return (
    <Card>
      <h2>Tìm bài</h2>
      <TextField label="Truy vấn OpenAlex" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Button onClick={() => void search()} disabled={busy || !query.trim()}>
        Tìm bài
      </Button>
      {error && <p role="alert">Không tìm được bài: {error}</p>}
      <p>{corpus.searches.length} lượt tìm kiếm</p>
      <SearchImport corpus={corpus} save={save} />
      <ScreeningList corpus={corpus} save={save} />
    </Card>
  );
}
