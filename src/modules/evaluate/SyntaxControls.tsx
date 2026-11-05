import { Button } from '@/shared/ui/Button';
import type { SyntaxAnalysis } from './useSyntaxAnalysis';
import styles from './syntax.module.css';

/** AI sentence-analysis toolbar: run / cancel, error, context and marker legend. */
export function SyntaxControls({
  syntax,
  readOnly,
  onRun,
}: {
  syntax: SyntaxAnalysis;
  readOnly: boolean;
  onRun: () => void;
}) {
  return (
    <>
      {!readOnly && (
        <div className={styles.toolbar}>
          {syntax.running ? (
            <>
              <span role="status">Đang phân tích câu…</span>
              <Button onClick={syntax.cancel}>Huỷ</Button>
            </>
          ) : (
            <Button onClick={onRun}>
              {syntax.annotations ? 'Phân tích lại (AI)' : 'Phân tích câu (AI)'}
            </Button>
          )}
        </div>
      )}
      {syntax.error && <p role="alert">Không phân tích được câu: {syntax.error}</p>}
      {syntax.annotations && (
        <>
          <p className={styles.banner}>Thiếu ngữ cảnh: chỉ phân tích đoạn văn này (context_limited)</p>
          <p className={styles.legend}>
            Gạch liền: chủ ngữ · Gạch đôi: động từ chính · Gạch chấm: phần xen giữa chủ–vị · T/A/S:
            Topic/Action/Stress (ứng viên do AI đề xuất; offset do hệ thống tính)
            {syntax.versions?.model && ` · ${syntax.versions.model} · ${syntax.versions.prompt}`}
          </p>
        </>
      )}
    </>
  );
}
