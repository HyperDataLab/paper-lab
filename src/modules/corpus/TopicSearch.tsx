import { useState } from 'react';
import { candidateFromWork } from '@/core/extraction/deep';
import { recordTopicSearch } from '@/core/corpus/topic';
import type { Candidate, Corpus } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { TextField } from '@/shared/ui/TextField';
import { Select } from '@/shared/ui/Select';

export function TopicSearch({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'title-abstract' | 'full-text'>('title-abstract');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
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
      <h3>Sàng lọc</h3>
      <TextField label="Người quyết định" value={name} onChange={(event) => setName(event.target.value)} />
      <Select
        label="Giai đoạn"
        value={stage}
        onChange={(event) => setStage(event.target.value as 'title-abstract' | 'full-text')}
      >
        <option value="title-abstract">Tiêu đề và tóm tắt</option>
        <option value="full-text">Toàn văn</option>
      </Select>
      <TextField label="Lý do" value={reason} onChange={(event) => setReason(event.target.value)} />
      <ul>
        {corpus.members.map((member) => (
          <li key={member.memberId}>
            {member.title ?? member.identifiers.doi ?? member.exportId} —{' '}
            {member.decisions.filter((item) => item.stage === stage && item.decider.kind === 'person').at(-1)
              ?.decision ?? 'chưa quyết định'}{' '}
            {corpus.deep?.candidates
              .filter(
                (candidate) =>
                  (candidate.doi && candidate.doi === member.identifiers.doi) ||
                  (candidate.openalexId && candidate.openalexId === member.identifiers.openalexId),
              )
              .map(
                (candidate) =>
                  candidate.suggestion && (
                    <span key={candidate.key}>
                      AI gợi ý: {candidate.suggestion.decision} — {candidate.suggestion.reason}{' '}
                    </span>
                  ),
              )}
            {(['include', 'exclude', 'uncertain'] as const).map((decision) => (
              <Button
                key={decision}
                type="button"
                disabled={!name.trim()}
                onClick={() => {
                  const at = new Date().toISOString();
                  void save({
                    ...corpus,
                    updatedAt: at,
                    members: corpus.members.map((item) =>
                      item.memberId === member.memberId
                        ? {
                            ...item,
                            decisions: [
                              ...item.decisions,
                              {
                                stage,
                                decision,
                                reasonCode: 'other',
                                reasonText: reason,
                                decider: { kind: 'person', name },
                                at,
                              },
                            ],
                          }
                        : item,
                    ),
                  });
                }}
              >
                {{ include: 'Chọn', exclude: 'Loại', uncertain: 'Chưa rõ' }[decision]}
              </Button>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}
