import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Paper } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { paperSha, pdfRemote, sha256Hex } from '@/shared/pdfStore';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Loading } from '@/shared/ui/StateNote';
import styles from './pdf.module.css';

const PdfViewer = lazy(() => import('./PdfViewer').then((module) => ({ default: module.PdfViewer })));

type State =
  | { kind: 'loading' }
  | { kind: 'missing'; reason: string }
  | { kind: 'ready'; blob: Blob; uploaded: boolean };

/**
 * The paper's original PDF: the copy kept in this browser, else the lab's copy when a lab account is signed
 * in. A paper imported before PDFs were kept has neither; the reader attaches the same file once.
 */
export function PaperPdf({
  paper,
  target,
}: {
  paper: Paper;
  target: { page: number; nonce: number } | null;
}) {
  const repo = useRepositories();
  const { user, getIdToken, signIn } = useAuth();
  const sha = paperSha(paper);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  /** Keeps the lab's copy in step: sends the local file when the lab does not have it yet. */
  const upload = useCallback(
    async (blob: Blob) => {
      if (!sha) return false;
      const token = await getIdToken();
      if (!token) return false;
      await pdfRemote.upload(sha, blob, token);
      await repo.pdfFiles.markUploaded(sha);
      return true;
    },
    [sha, getIdToken, repo],
  );

  useEffect(() => {
    let active = true;
    if (!sha) return;
    void (async () => {
      const local = await repo.pdfFiles.get(sha);
      if (local) {
        if (!active) return;
        setState({ kind: 'ready', blob: local.blob, uploaded: local.uploaded });
        if (!local.uploaded && user)
          void upload(local.blob)
            .then((sent) => sent && active && setState({ kind: 'ready', blob: local.blob, uploaded: true }))
            .catch((cause: unknown) => active && setMessage(`PDF chưa lên kho lab: ${String(cause)}`));
        return;
      }
      const token = user ? await getIdToken() : null;
      if (token) {
        try {
          const remote = await pdfRemote.download(sha, token);
          if (remote) {
            // A full browser store only costs the local copy; the lab's copy is still shown.
            await repo.pdfFiles.put(sha, remote, true).catch(() => undefined);
            if (active) setState({ kind: 'ready', blob: remote, uploaded: true });
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
            : 'Máy này chưa có PDF của bài. Đăng nhập lab để mở bản trong kho của lab, hoặc gắn lại tệp.',
        });
    })();
    return () => {
      active = false;
    };
  }, [sha, repo, user, getIdToken, upload]);

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
    await repo.pdfFiles.put(sha, blob);
    setMessage('');
    setState({ kind: 'ready', blob, uploaded: false });
    if (user)
      void upload(blob)
        .then((sent) => sent && setState({ kind: 'ready', blob, uploaded: true }))
        .catch((cause: unknown) => setMessage(`PDF chưa lên kho lab: ${String(cause)}`));
  }

  if (!sha) return <p className={styles.note}>Bài này không được nhập từ tệp PDF.</p>;
  if (state.kind === 'loading') return <Loading label="Đang tìm PDF…" />;
  if (state.kind === 'missing')
    return (
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
    );
  return (
    <>
      <p className={styles.note}>
        {state.uploaded ? (
          <Badge tone="success">Đã lưu trong kho lab</Badge>
        ) : (
          <Badge>{user ? 'Đang lưu lên kho lab…' : 'Chỉ trên máy này'}</Badge>
        )}{' '}
        {target && 'Đang mở trang chứa đoạn trích; bấm Text để xem đoạn được tô sáng.'}
      </p>
      {message && <p role="alert">{message}</p>}
      <Suspense fallback={<Loading label="Đang mở PDF…" />}>
        <PdfViewer key={sha} blob={state.blob} target={target} />
      </Suspense>
    </>
  );
}
