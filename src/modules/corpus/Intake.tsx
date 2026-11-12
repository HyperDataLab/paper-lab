import { useEffect, useState } from 'react';
import {
  addFromDois,
  addFromLibrary,
  addFromPapers,
  addMember,
  mergeMembers,
  type IntakeInput,
} from '@/core/corpus/intake';
import type { Corpus, LibraryItem, Paper } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { TextField } from '@/shared/ui/TextField';
import styles from './corpus.module.css';

type Pending = { candidate: string; input: IntakeInput; id: string };
export function Intake({ corpus, save }: { corpus: Corpus; save: (value: Corpus) => Promise<void> }) {
  const repo = useRepositories();
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [tab, setTab] = useState('library');
  const [selected, setSelected] = useState<string[]>([]);
  const [dois, setDois] = useState('');
  const pending = corpus.pendingConfirmations ?? [];
  const [counts, setCounts] = useState<{
    added: number;
    matched: number;
    needsConfirmation: number;
    invalid: number;
  }>();
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([repo.library.list(), repo.papers.list()])
      .then(([l, p]) => {
        setLibrary(l);
        setPapers(p);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [repo]);
  async function add() {
    try {
      let current = corpus;
      const waiting: Pending[] = [];
      let result = { added: 0, matched: 0, needsConfirmation: 0, invalid: 0 };
      if (tab === 'doi') {
        const next = addFromDois(current, dois);
        current = next.corpus;
        result = next.counts;
      } else {
        const chosen =
          tab === 'library'
            ? library.filter((item) => selected.includes(item.id))
            : papers.filter((item) => selected.includes(item.id));
        for (const item of chosen) {
          const isLibrary = 'doi' in item;
          const input: IntakeInput = isLibrary
            ? {
                doi: item.doi,
                openalexId: item.openalex_id,
                paperId: item.paper_id,
                libraryId: item.id,
                title: item.title,
                year: item.year,
              }
            : { paperId: item.id, sha256: item.source.sha256, title: item.title };
          const match = addMember(current, input, new Date().toISOString());
          if (match.matched === 'title-year')
            waiting.push({ candidate: match.candidate, input, id: crypto.randomUUID() });
          const next = isLibrary ? addFromLibrary(current, [item]) : addFromPapers(current, [item]);
          current = next.corpus;
          result = {
            added: result.added + next.counts.added,
            matched: result.matched + next.counts.matched,
            needsConfirmation: result.needsConfirmation + next.counts.needsConfirmation,
            invalid: result.invalid + next.counts.invalid,
          };
        }
      }
      await save({ ...current, pendingConfirmations: [...pending, ...waiting] });
      setCounts(result);
      setSelected([]);
    } catch (e) {
      setError(String(e));
    }
  }
  async function decide(item: Pending, merge: boolean) {
    try {
      const now = new Date().toISOString();
      const other = { ...corpus, members: corpus.members.filter((m) => m.memberId !== item.candidate) };
      const added = addMember(other, item.input, now);
      if (added.matched !== 'new') throw new Error('Không thể thêm bài này.');
      const member = added.corpus.members.find((m) => m.memberId === added.memberId);
      if (!member) throw new Error('Không tìm thấy bài mới.');
      const both = { ...corpus, updatedAt: now, members: [...corpus.members, member] };
      const resolved = merge
        ? mergeMembers(both, member.memberId, item.candidate, 'title-year confirmed', now)
        : both;
      await save({ ...resolved, pendingConfirmations: pending.filter((p) => p.id !== item.id) });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className={styles.form}>
      <h2>Thêm bài</h2>
      <SegmentedControl
        label="Nguồn bài"
        value={tab}
        onChange={(value) => {
          setTab(value);
          setSelected([]);
        }}
        options={[
          { value: 'library', label: 'Từ Library' },
          { value: 'papers', label: 'Bài đã nhập' },
          { value: 'doi', label: 'Danh sách DOI' },
        ]}
      />
      {tab === 'doi' ? (
        <TextField
          label="Danh sách DOI"
          multiline
          rows={4}
          value={dois}
          onChange={(e) => setDois(e.target.value)}
        />
      ) : (
        <div className={styles.checks}>
          {(tab === 'library' ? library : papers).map((item) => (
            <Checkbox
              key={item.id}
              checked={selected.includes(item.id)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id),
                )
              }
            >
              {item.title || ('doi' in item ? item.doi : item.id)}
            </Checkbox>
          ))}
          {(tab === 'library' ? library : papers).length === 0 && <p>Không có bài để chọn.</p>}
        </div>
      )}
      <div>
        <Button onClick={() => void add()}>Thêm bài</Button>
      </div>
      {counts && (
        <p role="status">
          Đã thêm: {counts.added} · Đã khớp: {counts.matched} · Cần xác nhận: {counts.needsConfirmation} ·
          Không hợp lệ: {counts.invalid}
        </p>
      )}
      {pending.length > 0 && <h3>Cần xác nhận</h3>}
      {pending.map((item) => {
        const existing = corpus.members.find((m) => m.memberId === item.candidate);
        return (
          <div key={item.id}>
            <p>
              Trong corpus: {existing?.title} ({existing?.stratum.year}) · {existing?.identifiers.doi}
            </p>
            <p>
              Bài mới: {item.input.title} ({item.input.year}) · {item.input.doi}
            </p>
            <div className={styles.row}>
              <Button onClick={() => void decide(item, true)}>Gộp</Button>
              <Button onClick={() => void decide(item, false)}>Giữ riêng</Button>
            </div>
          </div>
        );
      })}
      {error && <p role="alert">Không thể thêm bài. {error}</p>}
    </div>
  );
}
