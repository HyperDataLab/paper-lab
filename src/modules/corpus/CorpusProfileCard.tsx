import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canonicalDigest } from '@/core/corpus';
import type { Corpus } from '@/core/schemas/corpus';
import type { CorpusProfile } from '@/core/schemas/corpusProfile';
import type { StoredCorpusProfile } from '@/core/schemas/corpusProfile';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { DataTable } from '@/shared/ui/DataTable';
import { Select } from '@/shared/ui/Select';
import {
  computeHoldout,
  computeProfile,
  computeProfileV2,
  downloadProfile,
  downloadProfileV2,
  featureLabel,
} from './profileRun';
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

const inputsDigest = (corpus: Corpus) =>
  canonicalDigest({ members: corpus.members, protocol: corpus.protocol, releases: corpus.releases });

/** The journal's profile against a control corpus: pure computation over the members' papers, no AI. */
export function CorpusProfileCard({ corpus }: { corpus: Corpus }) {
  const repo = useRepositories();
  const [controls, setControls] = useState<Corpus[]>();
  const [controlId, setControlId] = useState('');
  const [profile, setProfile] = useState<CorpusProfile>();
  const [stored, setStored] = useState<StoredCorpusProfile>();
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([repo.corpora.list(), repo.corpusProfiles.get(corpus.id)])
      .then(async ([all, saved]) => {
        if (!active) return;
        const list = all.filter((c) => c.kind === 'control');
        setControls(list);
        // A control drawn for this journal names it in its sampling rule (`match:<id>`).
        const matched = list.find((c) => {
          const body = c.protocol.at(-1)?.body;
          return body && 'samplingRule' in body && body.samplingRule === `match:${corpus.id}`;
        });
        const savedControl = saved && list.find((c) => c.id === saved.profile.control.corpusId);
        setControlId(saved?.profile.control.corpusId ?? (matched ?? list[0])?.id ?? '');
        if (saved) {
          setStored(saved);
          setProfile(saved.profile);
          const changed =
            (await inputsDigest(corpus)) !== saved.targetDigest ||
            !savedControl ||
            (await inputsDigest(savedControl)) !== saved.controlDigest;
          if (active) setStale(changed);
        } else {
          setStored(undefined);
          setProfile(undefined);
          setStale(false);
        }
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      active = false;
    };
  }, [repo, corpus]);
  async function saveProfile(value: CorpusProfile, target: Corpus, control: Corpus) {
    const record = await repo.corpusProfiles.save({
      schemaVersion: 1,
      corpusId: target.id,
      savedAt: new Date().toISOString(),
      targetDigest: await inputsDigest(target),
      controlDigest: await inputsDigest(control),
      profile: value,
    });
    setStored(record);
    setProfile(value);
    setStale(false);
  }
  async function run() {
    const control = controls?.find((c) => c.id === controlId);
    if (!control) return;
    setBusy(true);
    setError('');
    try {
      const latest = (await repo.corpora.get(control.id)) ?? control;
      const target = (await repo.corpora.get(corpus.id)) ?? corpus;
      await saveProfile(await computeProfile(target, latest, repo), target, latest);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportV2() {
    const control = controls?.find((c) => c.id === controlId);
    if (!control) return;
    setBusy(true);
    setError('');
    try {
      const latest = (await repo.corpora.get(control.id)) ?? control;
      const target = (await repo.corpora.get(corpus.id)) ?? corpus;
      downloadProfileV2(await computeProfileV2(target, latest, repo), corpus.title);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function runHoldout() {
    const control = controls?.find((c) => c.id === controlId);
    if (!profile || !control || !stored || stale) return;
    setBusy(true);
    setError('');
    try {
      const target = (await repo.corpora.get(corpus.id)) ?? corpus;
      const latest = (await repo.corpora.get(control.id)) ?? control;
      if (
        (await inputsDigest(target)) !== stored.targetDigest ||
        (await inputsDigest(latest)) !== stored.controlDigest
      ) {
        setStale(true);
        return;
      }
      const result = await computeHoldout(profile, target, latest, repo);
      const record = await repo.corpusProfiles.save({
        ...stored,
        savedAt: new Date().toISOString(),
        profile: result,
      });
      setStored(record);
      setProfile(result);
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
                setStored(undefined);
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
              {busy ? 'Đang tính…' : profile ? 'Tính lại' : 'Tính profile'}
            </Button>
            {profile && (
              <Button size="sm" disabled={busy || stale} onClick={() => void runHoldout()}>
                Kiểm tra trên tập giữ riêng
              </Button>
            )}
            {profile && (
              <Button
                size="sm"
                leadingIcon={<Download size={16} aria-hidden="true" />}
                onClick={() => downloadProfile(profile, corpus.title)}
              >
                Tải corpus-profile.json
              </Button>
            )}
            <Button
              size="sm"
              disabled={!controlId || busy}
              leadingIcon={<Download size={16} aria-hidden="true" />}
              onClick={() => void exportV2()}
            >
              Tải profile v2 (nháp)
            </Button>
          </div>
        </div>
        <p className={styles.muted}>
          So sánh từng bài của tạp chí với corpus đối chứng: chỉ đọc bài đã dựng model, không gọi AI. Bài giữ
          lại cho kiểm định (held-out) không được tính. Profile v2 (nháp) thêm đặc trưng theo từng phần, tiêu
          đề, chuỗi phần, từ khoá và subfield; được tính lại mỗi lần tải và không lưu.
        </p>
        {error && <p role="alert">Có lỗi xảy ra. {error}</p>}
        {profile && status && (
          <>
            <p className={styles.muted}>Đã tính: {new Date(profile.generatedAt).toLocaleString('vi-VN')}</p>
            {stale && <p role="status">Corpus đã thay đổi kể từ lần tính</p>}
            <div className={styles.notice}>
              <span>
                <Badge tone={status.tone}>{status.label}</Badge> {profile.interpretationReason}
              </span>
            </div>
            <p className={styles.muted}>
              {profile.target.profiled} bài tạp chí, {profile.control.profiled} bài đối chứng.{' '}
              {profile.warnings.join(' ')}
            </p>
            {profile.holdout && (
              <>
                <h3>Kiểm tra trên tập giữ riêng</h3>
                <p>
                  AUC {num(profile.holdout.auc)} [{num(profile.holdout.ci95Low)},{' '}
                  {num(profile.holdout.ci95High)}] · {profile.holdout.passed ? 'Đạt' : 'Không đạt'} ·{' '}
                  {profile.holdout.rule}. Loại do trùng tác giả: {profile.holdout.droppedForAuthorOverlap}. Số
                  bài: {profile.holdout.nTarget} / {profile.holdout.nControl}.
                </p>
                <DataTable aria-label="Kiểm tra yếu tố gây nhiễu">
                  <thead>
                    <tr>
                      <th>Yếu tố</th>
                      <th>Tạp chí</th>
                      <th>Đối chứng</th>
                      <th>Khoảng cách TV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.confoundChecks?.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.target}</td>
                        <td>{c.control}</td>
                        <td>{num(c.distance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </>
            )}
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
