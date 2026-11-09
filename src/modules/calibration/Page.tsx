import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { interRaterAgreement, matchLabels, scoreCalibration } from '@/core/calibration';
import { CalibrationLabelsSchema, type CalibrationLabel } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { CalibrationBadge } from '@/shared/calibration/CalibrationBadge';
import { loadCalibration, type CalibrationData } from '@/shared/calibration/data';
import { downloadJson } from '@/shared/calibration/download';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { labels as issueLabels } from '@/modules/evaluate/issueLabels';
import { LENSES } from '@/core/prompts';
import { DIMENSIONS } from '@/core/scoring/rubric';
import { MeasurementGoldCard } from './MeasurementGold';
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
  if (!data) return <p>{error ? `Không thể tải hiệu chuẩn: ${error}` : 'Đang tải hiệu chuẩn…'}</p>;
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
  return (
    <div>
      <h1>Hiệu chuẩn</h1>
      <p>n nhỏ không phải là bằng chứng về độ tin cậy. Các ngưỡng là mặc định cần hiệu chuẩn.</p>
      <p>Mâu thuẫn giữa các nhãn cùng người đánh giá và mục: {data.conflicts} (giữ nhãn mới nhất).</p>
      <Card>
        <h2>Nhãn đánh giá</h2>
        <p>
          Mẫu chứa các mục hiện có. Điền tên người đánh giá và label (correct/incorrect hoặc 0–4 cho điểm)
          trước khi nhập.
        </p>
        <Button onClick={() => downloadJson('paragraph-lab-labels-template.json', template)}>
          Tải mẫu nhãn
        </Button>{' '}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Tệp nhãn"
          onChange={(event) => void read(event)}
        />
        <Button onClick={() => input.current?.click()}>Chọn tệp nhãn</Button>
        {error && (
          <div role="alert">
            Không thể xử lý nhãn.
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error}
            </details>
          </div>
        )}
        {preview && matched && (
          <div>
            <h3>Xem trước: {preview.name}</h3>
            <p>
              Khớp: {matched.matched.length} · Không khớp: {matched.unmatched.length} · Tổng n=
              {preview.labels.labels.length}
            </p>
            <ul>
              {[...new Set(preview.labels.labels.map((v) => v.rater))].map((rater) => (
                <li key={rater}>
                  {rater}: n={preview.labels.labels.filter((v) => v.rater === rater).length}
                </li>
              ))}
            </ul>
            {matched.unmatched.length > 0 && (
              <details>
                <summary>Nhãn không khớp</summary>
                <pre>{JSON.stringify(matched.unmatched, null, 2)}</pre>
              </details>
            )}
            <Button onClick={() => void save()}>Xác nhận nhập nhãn</Button>
          </div>
        )}
        <ul>
          {data.data.calibrationLabels.map((set) => (
            <li key={set.id}>
              {set.sourceFileName} · {set.importedAt} · n={set.data.labels.length}{' '}
              <Button
                onClick={() =>
                  void repo.calibrationLabels
                    .delete(set.id)
                    .then(refresh)
                    .catch((cause: unknown) => setError(String(cause)))
                }
              >
                Xóa bộ nhãn
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2>Độ chính xác theo loại</h2>
        <table>
          <thead>
            <tr>
              <th>Loại</th>
              <th>Đúng</th>
              <th>Sai</th>
              <th>n</th>
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
                <td>{row.correct}</td>
                <td>{row.incorrect}</td>
                <td>{row.n}</td>
                <td>
                  {fmt(row.precision)} ({fmt(row.wilsonLow)}–{fmt(row.wilsonHigh)})
                </td>
                <td>
                  <CalibrationBadge stats={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h2>Đồng thuận giữa người đánh giá</h2>
        <table>
          <thead>
            <tr>
              <th>Người đánh giá</th>
              <th>Loại</th>
              <th>n</th>
              <th>Kappa</th>
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
                <td>{row.n}</td>
                <td>{fmt(row.kappa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <MeasurementGoldCard />
      <Card>
        <h2>Hiệu chuẩn điểm</h2>
        <table>
          <thead>
            <tr>
              <th>Chiều</th>
              <th>n</th>
              <th>MAE</th>
              <th>Độ lệch có dấu</th>
              <th>Kappa có trọng số</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((row) => (
              <tr key={row.dimension}>
                <td title={row.dimension}>{labelFor('score', row.dimension).label}</td>
                <td>{row.n}</td>
                <td>{fmt(row.mae)}</td>
                <td>
                  {row.bias > 0 ? '+' : ''}
                  {fmt(row.bias)}
                </td>
                <td>{fmt(row.weightedKappa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
