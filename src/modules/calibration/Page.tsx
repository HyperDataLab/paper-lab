import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { interRaterAgreement, matchLabels, scoreCalibration } from '@/core/calibration';
import { CalibrationLabelsSchema, type CalibrationLabel } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { CalibrationBadge } from '@/shared/calibration/CalibrationBadge';
import { loadCalibration, type CalibrationData } from '@/shared/calibration/data';
import { downloadJson } from '@/shared/calibration/download';
import {
  AlertCircle,
  AlertTriangle,
  Download,
  FileJson,
  Gauge,
  ListChecks,
  Tags,
  Target,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { IconButton } from '@/shared/ui/IconButton';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { Card } from '@/shared/ui/Card';
import { PageHeader } from '@/shared/ui/PageHeader';
import { labels as issueLabels } from '@/modules/evaluate/issueLabels';
import { LENSES } from '@/core/prompts';
import { DIMENSIONS } from '@/core/scoring/rubric';
import { MeasurementGoldCard } from './MeasurementGold';
import styles from './page.module.css';
const fmt = (value: number | null) => (value === null ? '—' : value.toFixed(2));
export default function Page() {
  const repo = useRepositories();
  const input = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<CalibrationData>();
  const [preview, setPreview] = useState<{
    name: string;
    labels: ReturnType<typeof CalibrationLabelsSchema.parse>;
  }>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => setData(await loadCalibration(repo)), [repo]);
  useEffect(() => {
    let active = true;
    void loadCalibration(repo)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [repo]);
  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError('');
      setPreview({
        name: file.name,
        labels: CalibrationLabelsSchema.parse(JSON.parse(await file.text()) as unknown),
      });
    } catch (cause) {
      setPreview(undefined);
      setError(String(cause));
    }
    event.target.value = '';
  }
  async function save() {
    if (!preview) return;
    try {
      await repo.calibrationLabels.import(preview.name, preview.labels);
      setPreview(undefined);
      await refresh();
    } catch (cause) {
      setError(String(cause));
    }
  }
  if (!data)
    return error ? (
      <p role="alert">Không thể tải hiệu chuẩn: {error}</p>
    ) : (
      <Loading label="Đang tải hiệu chuẩn…" />
    );
  const matched = preview ? matchLabels(preview.labels.labels, data.store) : null;
  const raters = [...new Set(data.labels.map((label) => label.rater))].sort();
  const agreement = raters.flatMap((a, index) =>
    raters
      .slice(index + 1)
      .flatMap((b) => interRaterAgreement(data.labels, a, b).map((row) => ({ ...row, a, b }))),
  );
  const scores = scoreCalibration(
    data.labels.filter(
      (label): label is Extract<CalibrationLabel, { label: number }> => typeof label.label === 'number',
    ),
    data.store.analyses,
  );
  const labelFor = (kind: string, id: string) => {
    if (kind === 'issue')
      return { group: 'Vấn đề', label: issueLabels[id as keyof typeof issueLabels] ?? id };
    if (kind === 'check')
      return {
        group: 'Kiểm tra',
        label:
          data.store.checks.flatMap((record) => record.report.checks).find((check) => check.id === id)
            ?.label ?? id,
      };
    if (kind === 'point') return { group: 'Góc nhìn', label: LENSES[id as keyof typeof LENSES]?.label ?? id };
    return { group: 'Điểm', label: DIMENSIONS.find((dimension) => dimension.id === id)?.label ?? id };
  };
  const template = {
    format: 'paragraph-lab-labels',
    version: 1,
    labels: [
      ...new Map(
        data.targets.map((target) => [JSON.stringify(target), { rater: '', target, label: null }]),
      ).values(),
    ],
  };
  const sets = data.data.calibrationLabels;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Hiệu chuẩn"
        lead="Đo xem gợi ý và điểm của AI khớp với nhãn của người đến đâu. Cỡ mẫu nhỏ chưa đủ để kết luận; các ngưỡng hiện là mặc định."
      >
        <Button onClick={() => downloadJson('paperlab-labels-template.json', template)}>
          <Download size={16} aria-hidden="true" />
          Tải mẫu nhãn
        </Button>
        <Button variant="primary" onClick={() => input.current?.click()}>
          <Upload size={16} aria-hidden="true" />
          Nhập tệp nhãn
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Tệp nhãn"
          onChange={(event) => void read(event)}
        />
      </PageHeader>

      <dl className={styles.stats} aria-label="Dữ liệu hiệu chuẩn">
        <div>
          <dt>
            <FileJson size={16} aria-hidden="true" /> Bộ nhãn
          </dt>
          <dd>{sets.length}</dd>
        </div>
        <div>
          <dt>
            <Tags size={16} aria-hidden="true" /> Nhãn
          </dt>
          <dd>{data.labels.length}</dd>
        </div>
        <div>
          <dt>
            <Users size={16} aria-hidden="true" /> Người đánh giá
          </dt>
          <dd>{raters.length}</dd>
        </div>
        <div>
          <dt>
            <ListChecks size={16} aria-hidden="true" /> Loại đã có nhãn
          </dt>
          <dd>{data.stats.length}</dd>
        </div>
      </dl>

      {error && (
        <div role="alert" className={styles.alert}>
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            Không thể xử lý nhãn.
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error}
            </details>
          </div>
        </div>
      )}

      <Card>
        <div className={styles.cardHead}>
          <div>
            <h2>Bộ nhãn đã nhập</h2>
            <p>
              Mẫu chứa các mục hiện có. Điền tên người đánh giá và nhãn (correct/incorrect, hoặc 0–4 cho điểm)
              rồi nhập lại.
            </p>
          </div>
        </div>
        {data.conflicts > 0 && (
          <p className={styles.notice}>
            <AlertTriangle size={16} aria-hidden="true" />
            Mâu thuẫn giữa các nhãn cùng người đánh giá và mục: {data.conflicts} (giữ nhãn mới nhất).
          </p>
        )}
        {sets.length === 0 ? (
          <Empty
            icon={<FileJson size={20} />}
            title="Chưa nhập bộ nhãn nào"
            hint="Tải mẫu nhãn ở góc trên, điền nhãn, rồi chọn Nhập tệp nhãn."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Tệp</th>
                  <th>Nhập lúc</th>
                  <th className={styles.num}>Số nhãn</th>
                  <th>Người đánh giá</th>
                  <th className={styles.actionCell}>
                    <span className={styles.srOnly}>Thao tác</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sets.map((set) => (
                  <tr key={set.id}>
                    <td>
                      <span className={styles.file}>
                        <FileJson size={16} aria-hidden="true" />
                        {set.sourceFileName}
                      </span>
                    </td>
                    <td>{new Date(set.importedAt).toLocaleString('vi-VN')}</td>
                    <td className={styles.num}>{set.data.labels.length}</td>
                    <td>{[...new Set(set.data.labels.map((label) => label.rater))].join(', ') || '—'}</td>
                    <td className={styles.actionCell}>
                      <IconButton
                        label="Xoá bộ nhãn"
                        tone="danger"
                        onClick={() =>
                          void repo.calibrationLabels
                            .delete(set.id)
                            .then(refresh)
                            .catch((cause: unknown) => setError(String(cause)))
                        }
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className={styles.cardHead}>
          <div>
            <h2>Độ chính xác theo loại</h2>
            <p>Tỉ lệ gợi ý được người đánh giá xác nhận là đúng, kèm khoảng tin cậy Wilson 95 %.</p>
          </div>
        </div>
        {data.stats.length === 0 ? (
          <Empty
            icon={<Target size={20} />}
            title="Chưa có nhãn nào"
            hint="Nhập tệp nhãn để thấy độ chính xác của từng loại gợi ý."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Loại</th>
                  <th className={styles.num}>Đúng</th>
                  <th className={styles.num}>Sai</th>
                  <th className={styles.num}>n</th>
                  <th>Precision (KTC 95%)</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {data.stats.map((row) => (
                  <tr key={`${row.kind}:${row.type}`}>
                    <td title={row.type}>
                      {labelFor(row.kind, row.type).group}: {labelFor(row.kind, row.type).label}
                    </td>
                    <td className={styles.num}>{row.correct}</td>
                    <td className={styles.num}>{row.incorrect}</td>
                    <td className={styles.num}>{row.n}</td>
                    <td className={styles.precision}>
                      <span className={styles.meter} aria-hidden="true">
                        <span style={{ width: `${(row.precision ?? 0) * 100}%` }} />
                      </span>
                      {fmt(row.precision)} ({fmt(row.wilsonLow)}–{fmt(row.wilsonHigh)})
                    </td>
                    <td>
                      <CalibrationBadge stats={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className={styles.split}>
        <Card>
          <div className={styles.cardHead}>
            <div>
              <h2>Đồng thuận giữa người đánh giá</h2>
              <p>Cohen&apos;s kappa trên các mục mà hai người cùng gán nhãn.</p>
            </div>
          </div>
          {agreement.length === 0 ? (
            <Empty
              icon={<Users size={20} />}
              title="Chưa đủ người đánh giá"
              hint="Cần ít nhất hai người đánh giá cùng gán nhãn một mục."
            />
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Người đánh giá</th>
                    <th>Loại</th>
                    <th className={styles.num}>n</th>
                    <th className={styles.num}>Kappa</th>
                  </tr>
                </thead>
                <tbody>
                  {agreement.map((row) => (
                    <tr key={`${row.a}:${row.b}:${row.kind}:${row.type}`}>
                      <td>
                        {row.a} / {row.b}
                      </td>
                      <td title={row.type}>
                        {labelFor(row.kind, row.type).group}: {labelFor(row.kind, row.type).label}
                      </td>
                      <td className={styles.num}>{row.n}</td>
                      <td className={styles.num}>{fmt(row.kappa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <div className={styles.cardHead}>
            <div>
              <h2>Hiệu chuẩn điểm</h2>
              <p>Sai số giữa điểm AI và điểm người chấm theo từng tiêu chí (thang 0–4).</p>
            </div>
          </div>
          {scores.length === 0 ? (
            <Empty
              icon={<Gauge size={20} />}
              title="Chưa có nhãn điểm nào"
              hint="Điền nhãn 0–4 cho các mục Điểm trong tệp mẫu để so với điểm của AI."
            />
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Chiều</th>
                    <th className={styles.num}>n</th>
                    <th className={styles.num}>MAE</th>
                    <th className={styles.num}>Độ lệch có dấu</th>
                    <th className={styles.num}>Kappa có trọng số</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((row) => (
                    <tr key={row.dimension}>
                      <td title={row.dimension}>{labelFor('score', row.dimension).label}</td>
                      <td className={styles.num}>{row.n}</td>
                      <td className={styles.num}>{fmt(row.mae)}</td>
                      <td className={styles.num}>
                        {row.bias > 0 ? '+' : ''}
                        {fmt(row.bias)}
                      </td>
                      <td className={styles.num}>{fmt(row.weightedKappa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <MeasurementGoldCard />

      {preview && matched && (
        <Dialog
          kind="form"
          title="Xem trước tệp nhãn"
          description={`Kiểm tra ${preview.name} trước khi nhập. Nhãn không khớp với mục nào sẽ bị bỏ qua.`}
          onClose={() => setPreview(undefined)}
        >
          <dl className={styles.previewStats}>
            <div>
              <dt>Khớp</dt>
              <dd>{matched.matched.length}</dd>
            </div>
            <div>
              <dt>Không khớp</dt>
              <dd>{matched.unmatched.length}</dd>
            </div>
            <div>
              <dt>Tổng</dt>
              <dd>{preview.labels.labels.length}</dd>
            </div>
          </dl>
          <p className={styles.srOnly}>
            Khớp: {matched.matched.length} · Không khớp: {matched.unmatched.length} · Tổng n=
            {preview.labels.labels.length}
          </p>
          <h3 className={styles.previewTitle}>Theo người đánh giá</h3>
          <ul className={styles.raters}>
            {[...new Set(preview.labels.labels.map((v) => v.rater))].map((rater) => (
              <li key={rater}>
                {rater}: n={preview.labels.labels.filter((v) => v.rater === rater).length}
              </li>
            ))}
          </ul>
          {matched.unmatched.length > 0 && (
            <details className={styles.unmatched}>
              <summary>Nhãn không khớp ({matched.unmatched.length})</summary>
              <pre>{JSON.stringify(matched.unmatched, null, 2)}</pre>
            </details>
          )}
          <DialogActions>
            <Button onClick={() => setPreview(undefined)}>Huỷ</Button>
            <Button variant="primary" onClick={() => void save()}>
              Xác nhận nhập nhãn
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
