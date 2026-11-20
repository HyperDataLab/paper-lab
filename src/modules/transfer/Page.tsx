import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { getStorageStatus, requestPersistentStorage } from '@/shared/storage/persistence';
import { Download, HardDrive, Upload } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Card } from '@/shared/ui/Card';
import { useToast } from '@/shared/ui/toastContext';
import type { ImportPlan } from '@/core/transfer/planImport';
import styles from './page.module.css';
function formatSize(value: number | null | undefined) {
  if (value == null) return 'không rõ';
  const units = ['KB', 'MB', 'GB'];
  let amount = value / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat('vi', { maximumFractionDigits: 1 }).format(amount)} ${units[unit]}`;
}
export default function Page() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const repo = useRepositories();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof requestPersistentStorage>> | null>(null);
  useEffect(() => {
    void getStorageStatus().then(setStorage);
  }, []);
  async function download() {
    try {
      const date = new Date();
      const data = await repo.transfer.exportAll('0.1.0');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `paperlab-export-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}.json`;
      a.click();
      toast('Đã xuất dữ liệu');
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setError(String(e));
    }
  }
  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    try {
      setError('');
      setDone(false);
      setPlan(await repo.transfer.previewImport(JSON.parse(await file.text()) as unknown));
    } catch (e) {
      setPlan(null);
      setError(String(e));
    }
  }
  async function apply() {
    if (!plan?.ok) return;
    try {
      await repo.transfer.applyImport(plan);
      setDone(true);
      toast('Đã nhập dữ liệu');
      setPlan(null);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className={styles.page}>
      <PageHeader title="Xuất/Nhập" lead="Xuất một tệp JSON để sao lưu hoặc chuyển dữ liệu PaperLab." />
      <div className={styles.columns}>
        <Card>
          <div className={styles.section}>
            <h2>
              <Download size={18} aria-hidden="true" /> Xuất
            </h2>
            <p>Tải dữ liệu có thể xuất từ phiên làm việc này.</p>
            <Button variant="primary" onClick={() => void download()}>
              Xuất toàn bộ (JSON)
            </Button>
          </div>
        </Card>
        <Card>
          <div className={styles.section}>
            <h2>
              <Upload size={18} aria-hidden="true" /> Nhập
            </h2>
            <p>Chọn tệp đã xuất từ PaperLab. Bạn xem trước những gì sẽ thay đổi rồi mới nhập.</p>
            <div className={styles.file}>
              <input
                className={styles.hidden}
                ref={fileInput}
                aria-label="Nhập từ tệp"
                type="file"
                accept=".json,application/json"
                onChange={(event) => void read(event)}
              />
              <Button onClick={() => fileInput.current?.click()}>Chọn tệp JSON</Button>
              <span>{filename || 'Chưa chọn tệp'}</span>
            </div>
            {error && (
              <div role="alert">
                Không thể xử lý tệp.{' '}
                <details>
                  <summary>Chi tiết kỹ thuật</summary>
                  {error}
                </details>
              </div>
            )}
            {plan && !plan.ok && <p role="alert">Tệp không hợp lệ: {plan.error}</p>}
            {plan?.ok && (
              <>
                <table>
                  <tbody>
                    <tr>
                      <th scope="row">Mới</th>
                      <td>{plan.toInsert.length}</td>
                    </tr>
                    <tr>
                      <th scope="row">Cập nhật</th>
                      <td>{plan.toUpdate.length}</td>
                    </tr>
                    <tr>
                      <th scope="row">Bản sửa mới</th>
                      <td>{plan.revisionsToInsert.length}</td>
                    </tr>
                    <tr>
                      <th scope="row">Đoạn soạn mới</th>
                      <td>{plan.generationsToInsert.length}</td>
                    </tr>
                    <tr>
                      <th scope="row">Bỏ qua</th>
                      <td>
                        {plan.skipped.length} {plan.skipped.map((x) => `${x.id}: ${x.reason}`).join('; ')}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Span bị loại</th>
                      <td>
                        {plan.suppressed.length} {plan.suppressed.map((x) => x.path).join('; ')}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Nhật ký bị bỏ qua</th>
                      <td>{plan.auditSkipped}</td>
                    </tr>
                  </tbody>
                </table>
                <Button variant="primary" onClick={() => void apply()}>
                  Nhập
                </Button>
              </>
            )}
            {done && <p role="status">Đã nhập dữ liệu.</p>}
          </div>
        </Card>
      </div>
      <Card>
        <div className={styles.section}>
          <h2>
            <HardDrive size={18} aria-hidden="true" /> Lưu trữ
          </h2>
          {storage?.usage != null && storage.quota ? (
            <progress
              className={styles.meter}
              value={storage.usage}
              max={storage.quota}
              aria-label="Dung lượng đã dùng"
            />
          ) : null}
          <div className={styles.statusRow}>
            <span>
              Đã dùng: {formatSize(storage?.usage)} / {formatSize(storage?.quota)}
            </span>
            <Badge tone={storage?.persisted ? 'success' : 'neutral'}>
              Lưu trữ bền vững:{' '}
              {storage?.persisted == null ? 'không rõ' : storage.persisted ? 'đã cấp' : 'chưa cấp'}
            </Badge>
          </div>
          <p>
            Khi chưa được cấp lưu trữ bền vững, trình duyệt có thể tự xoá dữ liệu lúc máy thiếu dung lượng.
          </p>
          <Button
            disabled={storage?.persisted === true}
            onClick={() => void requestPersistentStorage().then(setStorage)}
          >
            Yêu cầu lưu trữ bền vững
          </Button>
        </div>
      </Card>
    </div>
  );
}
