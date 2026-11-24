import { useRef, useState, type ChangeEvent } from 'react';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ArrowDownToLine, Check, FileJson2, ShieldCheck, Upload } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Card } from '@/shared/ui/Card';
import { useToast } from '@/shared/ui/toastContext';
import type { ImportPlan } from '@/core/transfer/planImport';
import styles from './page.module.css';
export default function Page() {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const repo = useRepositories();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [done, setDone] = useState(false);
  async function download() {
    try {
      setExportError('');
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
      setExportError(String(e));
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
      <PageHeader
        title="Xuất/Nhập dữ liệu"
        lead="Sao lưu hoặc khôi phục workspace PaperLab bằng tệp JSON. Bạn có thể xem trước dữ liệu trước khi nhập."
      >
        <span className={styles.headerBadge}>
          <ShieldCheck size={15} aria-hidden="true" /> Dữ liệu trong workspace
        </span>
      </PageHeader>
      <div className={styles.columns}>
        <Card className={styles.exportCard}>
          <div className={styles.section}>
            <div className={styles.cardHeading}>
              <span className={`${styles.iconTile} ${styles.exportIcon}`}>
                <ArrowDownToLine size={19} aria-hidden="true" />
              </span>
              <div>
                <span className={styles.eyebrow}>SAO LƯU</span>
                <h2>Xuất dữ liệu</h2>
              </div>
            </div>
            <p className={styles.cardDescription}>
              Tải dữ liệu workspace thành một tệp JSON để lưu trữ hoặc chuyển sang PaperLab khác.
            </p>
            <ul className={styles.benefits}>
              <li>
                <Check size={15} aria-hidden="true" /> Bao gồm dữ liệu đang lưu trong workspace
              </li>
              <li>
                <Check size={15} aria-hidden="true" /> Có thể xem trước khi nhập lại
              </li>
            </ul>
            {exportError && (
              <div className={styles.error} role="alert">
                Không thể tạo tệp sao lưu.{' '}
                <details>
                  <summary>Chi tiết kỹ thuật</summary>
                  <code>{exportError}</code>
                </details>
              </div>
            )}
            <div className={styles.cardFooter}>
              <Button variant="primary" onClick={() => void download()}>
                <ArrowDownToLine size={16} aria-hidden="true" /> Xuất toàn bộ dữ liệu
              </Button>
              <span className={styles.footerHint}>Định dạng JSON</span>
            </div>
          </div>
        </Card>
        <Card className={styles.importCard}>
          <div className={styles.section}>
            <div className={styles.cardHeading}>
              <span className={`${styles.iconTile} ${styles.importIcon}`}>
                <Upload size={19} aria-hidden="true" />
              </span>
              <div>
                <span className={styles.eyebrow}>KHÔI PHỤC</span>
                <h2>Nhập dữ liệu</h2>
              </div>
            </div>
            <p className={styles.cardDescription}>
              Chọn bản sao lưu PaperLab. Kiểm tra nội dung và các thay đổi trước khi áp dụng.
            </p>
            <input
              className={styles.hidden}
              ref={fileInput}
              aria-label="Nhập từ tệp JSON"
              type="file"
              accept=".json,application/json"
              onChange={(event) => void read(event)}
            />
            <div className={styles.filePicker}>
              <span className={styles.fileIcon}>
                <FileJson2 size={20} aria-hidden="true" />
              </span>
              <div className={styles.fileInfo}>
                <strong>{filename || 'Chưa chọn tệp sao lưu'}</strong>
                <span>
                  {filename ? 'Tệp JSON đã sẵn sàng để xem trước' : 'Chỉ hỗ trợ tệp .json xuất từ PaperLab'}
                </span>
              </div>
              <Button onClick={() => fileInput.current?.click()}>
                {filename ? 'Đổi tệp' : 'Chọn tệp JSON'}
              </Button>
            </div>
            {error && (
              <div className={styles.error} role="alert">
                Không thể xử lý tệp.{' '}
                <details>
                  <summary>Chi tiết kỹ thuật</summary>
                  <code>{error}</code>
                </details>
              </div>
            )}
            {plan && !plan.ok && <p role="alert">Tệp không hợp lệ: {plan.error}</p>}
            {plan?.ok && (
              <section className={styles.preview} aria-label="Xem trước dữ liệu nhập">
                <div className={styles.previewHeading}>
                  <div>
                    <span className={styles.eyebrow}>XEM TRƯỚC</span>
                    <h3>Dữ liệu sẽ thay đổi</h3>
                  </div>
                  <span className={styles.validBadge}>
                    <Check size={14} aria-hidden="true" /> Tệp hợp lệ
                  </span>
                </div>
                <dl className={styles.previewStats}>
                  <div>
                    <dt>Mới</dt>
                    <dd>{plan.toInsert.length}</dd>
                  </div>
                  <div>
                    <dt>Cập nhật</dt>
                    <dd>{plan.toUpdate.length}</dd>
                  </div>
                  <div>
                    <dt>Bản sửa</dt>
                    <dd>{plan.revisionsToInsert.length}</dd>
                  </div>
                  <div>
                    <dt>Bản nháp</dt>
                    <dd>{plan.generationsToInsert.length}</dd>
                  </div>
                  <div>
                    <dt>Bỏ qua</dt>
                    <dd>{plan.skipped.length}</dd>
                  </div>
                </dl>
                {(plan.skipped.length > 0 || plan.suppressed.length > 0 || plan.auditSkipped > 0) && (
                  <details className={styles.previewDetails}>
                    <summary>Chi tiết mục không được nhập</summary>
                    {plan.skipped.length > 0 && (
                      <ul>
                        {plan.skipped.map((item) => (
                          <li key={item.id}>
                            {item.id}: {item.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                    {plan.suppressed.length > 0 && (
                      <p>
                        {plan.suppressed.length} span bị loại:{' '}
                        {plan.suppressed.map((item) => item.path).join(', ')}
                      </p>
                    )}
                    {plan.auditSkipped > 0 && <p>{plan.auditSkipped} mục nhật ký bị bỏ qua.</p>}
                  </details>
                )}
                <div className={styles.previewFooter}>
                  <span>Kiểm tra số lượng phía trên trước khi áp dụng.</span>
                  <Button variant="primary" onClick={() => void apply()}>
                    <Upload size={16} aria-hidden="true" /> Nhập dữ liệu
                  </Button>
                </div>
              </section>
            )}
            {!plan && !error && !done && (
              <div className={styles.importHint}>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Chưa có dữ liệu nào được thay đổi. Chọn tệp để bắt đầu xem trước.</span>
              </div>
            )}
            {done && (
              <div className={styles.success} role="status">
                <Check size={16} aria-hidden="true" /> Đã nhập dữ liệu vào workspace.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
