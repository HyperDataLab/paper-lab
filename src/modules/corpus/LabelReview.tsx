import { useMemo, useRef, useState } from 'react';
import { labelPrecision, sampleLabels } from '@/core/corpus/labelChecks';
import type { Corpus } from '@/core/schemas/corpus';
import { useAuth } from '@/shared/auth/authContext';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { TextField } from '@/shared/ui/TextField';
import { machineLabels, type MachineLabel } from './machineLabels';
import type { LabelPaper, LabelScheme } from './labelPlan';
import { schemeNames } from './labels';
import styles from './corpus.module.css';

const SCHEMES: LabelScheme[] = ['rhetoric', 'stance', 'arguments'];
const VERDICTS = [
  { value: 'correct', label: 'Đúng' },
  { value: 'incorrect', label: 'Sai' },
  { value: 'unsure', label: 'Không chắc' },
] as const;
type Verdict = (typeof VERDICTS)[number]['value'];
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const sameItem = (
  a: { scheme: string; memberId: string; sentenceKey: string; label: string },
  b: MachineLabel,
) =>
  a.scheme === b.scheme &&
  a.memberId === b.memberId &&
  a.sentenceKey === b.sentenceKey &&
  a.label === b.label;

export function LabelReview({
  corpus,
  items,
  save,
}: {
  corpus: Corpus;
  items: LabelPaper[] | undefined;
  save: (value: Corpus) => Promise<void>;
}) {
  const repo = useRepositories();
  const { user } = useAuth();
  const [size, setSize] = useState('50');
  // The sample is recomputed from the seed, not stored: the corpus keeps only the decisions.
  const [seed, setSeed] = useState(corpus.id);
  const [drawn, setDrawn] = useState(false);
  const [error, setError] = useState('');
  const labels = useMemo(() => (items ?? []).flatMap((item) => machineLabels(item, SCHEMES)), [items]);
  const samples = useMemo(() => {
    const n = Math.max(1, Math.floor(Number(size)) || 50);
    return SCHEMES.map((scheme) => ({
      scheme,
      items: sampleLabels(
        labels.filter((l) => l.scheme === scheme),
        n,
        `${seed}:${scheme}`,
      ),
    }));
  }, [labels, size, seed]);
  const checks = corpus.labelChecks ?? [];
  // Precision is of the labels as they stand: a check on a label a later run removed no longer counts.
  const current = useMemo(
    () => new Set(labels.map((l) => JSON.stringify([l.scheme, l.memberId, l.sentenceKey, l.label]))),
    [labels],
  );
  const live = checks.filter((c) =>
    current.has(JSON.stringify([c.scheme, c.memberId, c.sentenceKey, c.label])),
  );
  // Decisions are written one after another, so a quick second click reads the first one's save.
  const writes = useRef<Promise<void>>(Promise.resolve());
  function decide(item: MachineLabel, verdict: Verdict) {
    writes.current = writes.current.then(() => write(item, verdict));
  }
  async function write(item: MachineLabel, verdict: Verdict) {
    setError('');
    try {
      const latest = (await repo.corpora.get(corpus.id)) ?? corpus;
      const at = new Date().toISOString();
      // A second decision on the same label replaces the first, so precision counts each label once.
      const kept = (latest.labelChecks ?? []).filter((check) => !sameItem(check, item));
      await save({
        ...latest,
        updatedAt: at,
        labelChecks: [
          ...kept,
          {
            scheme: item.scheme,
            memberId: item.memberId,
            sentenceKey: item.sentenceKey,
            label: item.label,
            verdict,
            checker: user?.email ?? 'local',
            at,
          },
        ],
      });
    } catch (cause) {
      setError(String(cause));
    }
  }
  return (
    <Card>
      <section aria-labelledby="label-review" className={styles.members}>
        <div className={styles.cardHead}>
          <h2 id="label-review">Kiểm tra nhãn máy</h2>
        </div>
        <p className={styles.muted}>
          Một người trong lab kiểm tra mẫu này bằng tay. Nhãn AI chỉ là ứng viên; độ chính xác dưới đây là của
          mẫu đã kiểm tra, khoảng tin cậy 95 % theo Wilson, không tính các nhãn “Không chắc”.
        </p>
        <dl className={styles.facts} aria-label="Độ chính xác">
          {SCHEMES.map((scheme) => {
            const p = labelPrecision(live.filter((c) => c.scheme === scheme).map((c) => c.verdict));
            return (
              <div key={scheme}>
                <dt>{schemeNames[scheme]}</dt>
                <dd>
                  {p.precision === null
                    ? 'Chưa kiểm tra'
                    : `${pct(p.precision)} (${p.correct}/${p.total}; KTC 95 %: ${pct(p.lower)}–${pct(p.upper)})`}
                </dd>
              </div>
            );
          })}
        </dl>
        <div className={styles.row}>
          <TextField
            label="Số nhãn mỗi loại"
            type="number"
            min={1}
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
          <TextField label="Seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
          <Button disabled={!labels.length} onClick={() => setDrawn(true)}>
            Lấy mẫu kiểm tra
          </Button>
        </div>
        {!labels.length && <p className={styles.muted}>Chưa có nhãn máy nào của prompt hiện tại.</p>}
        {drawn &&
          samples.map(({ scheme, items: sample }) =>
            sample.length === 0 ? null : (
              <section key={scheme} aria-label={`Mẫu ${schemeNames[scheme]}`} className={styles.checks}>
                <h3>
                  {schemeNames[scheme]}: {sample.length} nhãn, seed {seed}:{scheme}
                </h3>
                <ol className={styles.list}>
                  {sample.map((item) => {
                    const check = checks.find((c) => sameItem(c, item));
                    return (
                      <li
                        key={`${item.memberId}-${item.sentenceKey}-${item.label}`}
                        className={styles.sample}
                      >
                        <strong>{item.label}</strong>
                        <span>{item.text}</span>
                        <SegmentedControl
                          label={`Kiểm tra nhãn ${item.label}`}
                          value={check?.verdict ?? ''}
                          options={[...VERDICTS]}
                          onChange={(value) => decide(item, value as Verdict)}
                        />
                      </li>
                    );
                  })}
                </ol>
              </section>
            ),
          )}
        {error && <p role="alert">{error}</p>}
      </section>
    </Card>
  );
}
