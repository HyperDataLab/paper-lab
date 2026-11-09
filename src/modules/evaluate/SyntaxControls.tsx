import { Button } from '@/shared/ui/Button';
import type { SyntaxAnalysis } from './useSyntaxAnalysis';
import styles from './syntax.module.css';
import { Link } from 'react-router-dom';

/** AI sentence-analysis toolbar: run / cancel, error, context and marker legend. */
export function SyntaxControls({
  syntax,
  readOnly,
  saved,
  busy = false,
  onRun,
}: {
  syntax: SyntaxAnalysis;
  readOnly: boolean;
  saved: boolean;
  busy?: boolean;
  onRun: () => void;
}) {
  return (
    <>
      {!readOnly && (
        <div className={styles.toolbar}>
          {syntax.running ? (
            <>
              <span role="status">Đang phân tích câu…</span>
              <Button variant="danger" onClick={syntax.cancel}>
                Huỷ
              </Button>
            </>
          ) : (
            <Button
              variant={syntax.annotations ? 'secondary' : 'primary'}
              onClick={onRun}
              disabled={saved || busy}
            >
              {syntax.annotations ? 'Phân tích lại (AI)' : 'Phân tích câu (AI)'}
            </Button>
          )}
          {saved && <small>Đã lưu — chọn Chỉnh sửa văn bản để phân tích lại</small>}
        </div>
      )}
      {syntax.error && (
        <p role="alert">
          Không phân tích được câu: {syntax.error}{' '}
          {syntax.error.includes('Chưa nhập khoá API') && <Link to="/settings">Cài đặt</Link>}
        </p>
      )}
    </>
  );
}
