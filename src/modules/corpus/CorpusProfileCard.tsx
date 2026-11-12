import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Corpus } from '@/core/schemas/corpus';
import type { CorpusProfile } from '@/core/schemas/corpusProfile';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataTable } from '@/shared/ui/DataTable';
import { Select } from '@/shared/ui/Select';
import { computeProfile, downloadProfile, featureLabel } from './profileRun';
import styles from './corpus.module.css';

const num = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? '—' : value.toFixed(digits);
const q = (value: number) => (value < 0.001 ? '<0.001' : value.toFixed(3));
const percent = (value: number) => `${Math.round(value * 100)}%`;
const statuses = {
  exploratory: { label: 'Thăm dò', tone: 'warning' },
  inconclusive: { label: 'Chưa kết luận', tone: 'neutral' },
  supported: { label: 'Được hỗ trợ', tone: 'success' },
} as const;

/** The journal's profile against a control corpus: pure computation over the members' papers, no AI. */
export function CorpusProfileCard({ corpus }: { corpus: Corpus }) {
  const repo = useRepositories();
  const [controls, setControls] = useState<Corpus[]>();
  const [controlId, setControlId] = useState('');
  const [profile, setProfile] = useState<CorpusProfile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void repo.corpora
      .list()
      .then((all) => {
        if (!active) return;
        const list = all.filter((c) => c.kind === 'control');
        setControls(list);
        // A control drawn for this journal names it in its sampling rule (`match:<id>`).
        const matched = list.find((c) => {
          const body = c.protocol.at(-1)?.body;
          return body && 'samplingRule' in body && body.samplingRule === `match:${corpus.id}`;
        });
        setControlId((current) => current || (matched ?? list[0])?.id || '');
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      active = false;
    };
  }, [repo, corpus.id]);
  async function run() {
    const control = controls?.find((c) => c.id === controlId);
    if (!control) return;
    setBusy(true);
    setError('');
    try {
      const latest = (await repo.corpora.get(control.id)) ?? control;
      setProfile(await computeProfile(corpus, latest, repo));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const distinctive = profile
    ? profile.features.filter((f) => profile.distinctiveFeatureIds.includes(f.featureId))
    : [];
  const status = profile ? statuses[profile.interpretationStatus] : null;
  return (
    <Card>
      <section aria-labelledby="corpus-profile" className={styles.members}>
        <div className={styles.cardHead}>
          <h2 id="corpus-profile">Profile</h2>
          <div className={styles.cardTools}>
            <Select
              label="Corpus đối chứng"
              hideLabel
              size="sm"
              inline
              value={controlId}
              disabled={!controls?.length || busy}
              onChange={(e) => {
                setControlId(e.target.value);
                setProfile(undefined);
              }}
            >
              {!controls?.length && <option value="">Chưa có corpus đối chứng</option>}
              {controls?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="primary" disabled={!controlId || busy} onClick={() => void run()}>
              {busy ? 'Đang tính…' : 'Tính profile'}
            </Button>
            {profile && (
              <Button
                size="sm"
                leadingIcon={<Download size={16} aria-hidden="true" />}
                onClick={() => downloadProfile(profile, corpus.title)}
              >
                Tải corpus-profile.json
              </Button>
            )}
          </div>
        </div>
        <p className={styles.muted}>
          So sánh từng bài của tạp chí với corpus đối chứng: chỉ đọc bài đã dựng model, không gọi AI. Bài giữ
          lại cho kiểm định (held-out) không được tính.
        </p>
        {error && <p role="alert">Có lỗi xảy ra. {error}</p>}
        {profile && status && (
          <>
            <div className={styles.notice}>
              <span>
                <Badge tone={status.tone}>{status.label}</Badge> {profile.interpretationReason}
              </span>
            </div>
            <p className={styles.muted}>
              {profile.target.profiled} bài tạp chí, {profile.control.profiled} bài đối chứng.{' '}
              {profile.warnings.join(' ')}
            </p>
            <h3>Đặc trưng khác biệt</h3>
            {distinctive.length === 0 ? (
              <p className={styles.muted}>
                Không có đặc trưng nào đạt q &lt; 0,05 và mức hiệu ứng tối thiểu.
              </p>
            ) : (
              <DataTable aria-label="Đặc trưng khác biệt">
                <thead>
                  <tr>
                    <th>Đặc trưng</th>
                    <th>TB tạp chí</th>
                    <th>TB đối chứng</th>
                    <th>Hiệu ứng [CI 95%]</th>
                    <th>q</th>
                  </tr>
                </thead>
                <tbody>
                  {distinctive.map((f) => (
                    <tr key={f.featureId}>
                      <td>{featureLabel(f.featureId)}</td>
                      <td>{num(f.target.mean, 3)}</td>
                      <td>{num(f.control.mean, 3)}</td>
                      <td>
                        {f.comparison
                          ? `${num(f.comparison.effectSize)} [${num(f.comparison.ci95Low)}, ${num(f.comparison.ci95High)}] ${f.comparison.effectMetric === 'cohens_d' ? 'd' : 'Δp'}`
                          : '—'}
                      </td>
                      <td>{f.comparison ? q(f.comparison.qValue) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            <h3>Cụm từ đặc trưng</h3>
            {profile.phrases.items.length === 0 ? (
              <p className={styles.muted}>Không có cụm từ nào đạt ngưỡng.</p>
            ) : (
              <DataTable aria-label="Cụm từ đặc trưng">
                <thead>
                  <tr>
                    <th>Cụm từ</th>
                    <th>Bài tạp chí</th>
                    <th>Bài đối chứng</th>
                    <th>G²</th>
                    <th>Log Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.phrases.items.slice(0, 20).map((p) => (
                    <tr key={p.phraseId}>
                      <td>{p.text}</td>
                      <td>{percent(p.targetPrevalence)}</td>
                      <td>{percent(p.controlPrevalence)}</td>
                      <td>{num(p.g2, 1)}</td>
                      <td>{num(p.logRatio)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
