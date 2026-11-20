import { Cloud } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Paper } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { loadPdf, paperSha, pdfRemote, PdfRemoteError, sha256Hex } from '@/shared/pdfStore';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import type { PdfMark } from './pdfMarks';
import type { PdfTarget } from './PdfViewer';
import styles from './pdf.module.css';

const PdfViewer = lazy(() => import('./PdfViewer').then((module) => ({ default: module.PdfViewer })));

type State = { kind: 'loading' } | { kind: 'missing'; reason: string } | { kind: 'ready'; blob: Blob };

/**
 * The paper's original PDF, read from the lab's storage (R2) and held in memory for this tab. A paper whose
 * PDF never reached the lab has none; the reader attaches the same file once and it is sent to the lab.
 */
export function PaperPdf({
  paper,
  target,
  marks,
  onMark,
  fallback,
  back,
  find,
}: {
  paper: Paper;
  target: PdfTarget | null;
  marks?: PdfMark[];
  onMark?: (id: string) => void;
  /** The parsed text, shown under the attach box while the lab has no PDF of the paper. */
  fallback?: ReactNode;
  /** A way back to where the reader came from, at the start of the toolbar. */
  back?: ReactNode;
  /** Search and section controls, on a row of the toolbar. */
  find?: ReactNode;
}) {
  const { user, getIdToken, signIn } = useAuth();
  const sha = paperSha(paper);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (!sha) return;
    void (async () => {
      const token = user ? await getIdToken() : null;
      if (token) {
        try {
          const blob = await loadPdf(sha, token);
          if (blob) {
            if (active) setState({ kind: 'ready', blob });
            return;
          }
        } catch (cause) {
          if (active) setMessage(String(cause instanceof Error ? cause.message : cause));
        }
      }
      if (active)
        setState({
          kind: 'missing',
          reason: user
            ? 'Kho của lab chưa có PDF của bài này.'
            : 'Đăng nhập lab để mở PDF của bài trong kho của lab.',
        });
    })();
    return () => {
      active = false;
    };
  }, [sha, user, getIdToken]);

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !sha) return;
    const data = await file.arrayBuffer();
    if ((await sha256Hex(data)) !== sha) {
      setMessage(
        `“${file.name}” không phải tệp đã dùng để nhập bài này. Hãy chọn đúng tệp PDF gốc (cùng nội dung, không phải bản khác).`,
      );
      return;
    }
    const blob = new Blob([data], { type: 'application/pdf' });
    try {
      const token = await getIdToken();
      if (!token) throw new PdfRemoteError(401);
      setMessage('Đang lưu PDF vào kho lab…');
      await pdfRemote.upload(sha, blob, token);
      setMessage('');
      setState({ kind: 'ready', blob });
    } catch (cause) {
      setMessage(`Chưa lưu được PDF lên kho lab: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  if (!sha) return <p className={styles.note}>Bài này không được nhập từ tệp PDF.</p>;
  if (state.kind === 'loading') return <Loading label="Đang tìm PDF…" />;
  if (state.kind === 'missing')
    return (
      <>
        <div className={styles.attach}>
          <p>{state.reason}</p>
          {sha && (
            <>
              <input
                ref={picker}
                type="file"
                accept="application/pdf,.pdf"
                className={styles.hidden}
                aria-label="Chọn PDF gốc"
                onChange={(event) => void attach(event)}
              />
              <Button variant="primary" onClick={() => picker.current?.click()}>
                Gắn PDF gốc
              </Button>
              <p className={styles.note}>
                Chọn đúng tệp đã dùng để nhập bài; app kiểm tra để không gắn nhầm bản khác.
              </p>
            </>
          )}
          {!user && (
            <Button variant="ghost" onClick={() => void signIn()}>
              Đăng nhập lab
            </Button>
          )}
          {message && <p role="alert">{message}</p>}
        </div>
        {fallback}
      </>
    );
  return (
    <>
      {message && <p role="alert">{message}</p>}
      <Suspense fallback={<Loading label="Đang mở PDF…" />}>
        <PdfViewer
          key={sha}
          blob={state.blob}
          target={target}
          marks={marks}
          onMark={onMark}
          toolbarStart={back}
          toolbarBelow={find}
          toolbarEnd={
            <Badge tone="success" icon={<Cloud size={14} aria-hidden="true" />}>
              Đã lưu trong kho lab
            </Badge>
          }
        />
      </Suspense>
    </>
  );
}
