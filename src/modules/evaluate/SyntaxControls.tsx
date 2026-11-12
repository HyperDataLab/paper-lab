import { Button } from '@/shared/ui/Button';
import type { SyntaxAnalysis } from './useSyntaxAnalysis';
import { Link } from 'react-router-dom';

/** AI sentence analysis: run, re-run or cancel, and the error when it fails. */
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
      {!readOnly &&
        (syntax.running ? (
          <>
            <span role="status">Đang phân tích câu…</span>
            <Button size="sm" variant="danger" onClick={syntax.cancel}>
              Huỷ
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant={syntax.annotations ? 'secondary' : 'primary'}
            onClick={onRun}
            disabled={saved || busy}
          >
            {syntax.annotations ? 'Phân tích lại (AI)' : 'Phân tích câu (AI)'}
          </Button>
        ))}
      {syntax.error && (
        <p role="alert">
          Không phân tích được câu: {syntax.error}{' '}
          {syntax.error.includes('Chưa nhập khoá API') && <Link to="/settings">Cài đặt</Link>}
        </p>
      )}
    </>
  );
}
