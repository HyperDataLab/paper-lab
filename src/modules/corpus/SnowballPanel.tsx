import { useState } from 'react';
import { isIncluded } from '@/core/corpus/screening';
import {
  recordSnowball,
  seedCandidates,
  snowballState,
  type SnowballDirection,
} from '@/core/corpus/snowball';
import type { Corpus, CorpusMember } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { TextField } from '@/shared/ui/TextField';
import { runSnowball } from './snowballRun';
import styles from './corpus.module.css';

const DIRECTIONS: { id: SnowballDirection; label: string }[] = [
  { id: 'backward', label: 'Ngược: tài liệu bài hạt giống trích dẫn' },
  { id: 'forward', label: 'Xuôi: bài trích dẫn bài hạt giống' },
];

/** Citation searching from included studies; every iteration is a search entry that PRISMA counts apart. */
export function SnowballPanel({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const state = snowballState(corpus);
  const candidates = seedCandidates(corpus);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [directions, setDirections] = useState<SnowballDirection[]>(['backward', 'forward']);
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selected = chosen ?? state.nextSeeds.map((member) => member.memberId);
  const withoutId = corpus.members.filter((m) => isIncluded(m) && !m.identifiers.openalexId).length;
  const capValue = Number.parseInt(cap, 10);

  async function run(seeds: CorpusMember[]) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const client = createScholarClient({});
      const round = state.lastRound + 1;
      const at = new Date().toISOString();
      let next = corpus;
      for (const direction of directions) {
        const result = await runSnowball(client, seeds, direction, capValue > 0 ? capValue : null);
        next = recordSnowball(next, result, round, at);
      }
      await save(next);
      const entries = next.searches.slice(corpus.searches.length);
      const added = entries.reduce((sum, entry) => sum + (entry.added ?? 0), 0);
      const duplicates = entries.reduce((sum, entry) => sum + (entry.duplicates ?? 0), 0);
      setMessage(`Vòng ${round}: thêm ${added} bản ghi mới, ${duplicates} bản ghi trùng.`);
      setChosen(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const toggle = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...list, value] : list.filter((item) => item !== value);
  return (
    <section aria-labelledby="corpus-snowball">
      <h3 id="corpus-snowball">Tìm theo trích dẫn (snowballing)</h3>
      {candidates.length === 0 ? (
        <p className={styles.muted}>Chọn ít nhất một bài ở bước toàn văn để làm bài hạt giống.</p>
      ) : (
        <div className={styles.checks} role="group" aria-label="Bài hạt giống">
          {candidates.map((member) => (
            <Checkbox
              key={member.memberId}
              checked={selected.includes(member.memberId)}
              onChange={(event) => setChosen(toggle(selected, member.memberId, event.target.checked))}
            >
              {member.title ?? member.identifiers.doi ?? member.exportId}
            </Checkbox>
          ))}
        </div>
      )}
      {withoutId > 0 && (
        <p className={styles.muted}>
          {withoutId} bài được chọn chưa có mã OpenAlex nên không làm bài hạt giống được.
        </p>
      )}
      <div className={styles.row}>
        {DIRECTIONS.map((direction) => (
          <Checkbox
            key={direction.id}
            checked={directions.includes(direction.id)}
            onChange={(event) => setDirections(toggle(directions, direction.id, event.target.checked))}
          >
            {direction.label}
          </Checkbox>
        ))}
        <TextField
          label="Giới hạn mỗi bài hạt giống"
          hint="Để trống: không giới hạn"
          inputMode="numeric"
          value={cap}
          onChange={(event) => setCap(event.target.value)}
        />
      </div>
      <div className={styles.cardTools}>
        <Button
          onClick={() => void run(candidates.filter((member) => selected.includes(member.memberId)))}
          disabled={busy || selected.length === 0 || directions.length === 0}
        >
          Chạy snowballing
        </Button>
        {state.lastRound > 0 && (
          <Button
            variant="ghost"
            onClick={() => void run(state.nextSeeds)}
            disabled={busy || state.nextSeeds.length === 0 || directions.length === 0}
          >
            Vòng tiếp theo
          </Button>
        )}
      </div>
      {state.converged && (
        <p className={styles.notice}>
          Chưa có bài nào được chọn thêm kể từ vòng {state.lastRound}. Sàng lọc các bản ghi mới; nếu không bài
          nào được chọn, snowballing dừng ở vòng này.
        </p>
      )}
      {message && <p className={styles.muted}>{message}</p>}
      {error && <p role="alert">Không chạy được snowballing: {error}</p>}
    </section>
  );
}
