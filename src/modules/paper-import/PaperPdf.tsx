import { Cloud, CloudOff, HardDrive } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Paper } from '@/core/schemas';
import { useAuth } from '@/shared/auth/authContext';
import { paperSha, pdfRemote, sha256Hex } from '@/shared/pdfStore';
import { useHubProjectId } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import type { PdfMark } from './pdfMarks';
import { PdfViewer, type PdfTarget } from './PdfViewer';
import styles from './pdf.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'missing'; reason: string }
  | { kind: 'ready'; blob: Blob; uploaded: boolean };

/**
 * The paper's original PDF: the copy kept in this browser, else the ResearchHub copy when an account is signed
 * in. A paper imported before PDFs were kept has neither; the reader attaches the same file once.
 */
export function PaperPdf({
  paper,
  target,
  marks,
  onMark,
  fallback,
  back,
  find,
  toolbarStart,
  toolbarActions,
}: {
  paper: Paper;
  target: PdfTarget | null;
  marks?: PdfMark[];
  onMark?: (id: string) => void;
  /** The parsed text remains available below the inline notice when the original PDF is unavailable. */
  fallback?: ReactNode;
  /** A way back to where the reader came from, at the start of the toolbar. */
  back?: ReactNode;
  /** Search and section controls, on a row of the toolbar. */
  find?: ReactNode;
  /** Reader navigation placed before the page controls. */
  toolbarStart?: ReactNode;
  /** Analysis and run actions placed at the right of the compact PDF toolbar. */
  toolbarActions?: ReactNode;
}) {
  const projectId = useHubProjectId();
  const { user, getIdToken, signIn } = useAuth();
  const sha = paperSha(paper);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // A failed upload is a state of the stored copy, not an error with the paper: it shows in the toolbar badge.
  const [uploadError, setUploadError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  /** Keeps ResearchHub in step: sends the local file when this project does not have it yet. */
  const upload = useCallback(
    async (blob: Blob) => {
      if (!sha || !projectId) return false;
      const token = await getIdToken();
      if (!token) return false;
      await pdfRemote.upload(sha, projectId, paper.source.fileName || `${sha}.pdf`, blob, token);
      return true;
    },
    [sha, projectId, paper.source.fileName, getIdToken],
  );

  useEffect(() => {
    let active = true;
    if (!sha) return;
    void (async () => {
      try {
        const token = user && projectId ? await getIdToken() : null;
        const remote = token && projectId ? await pdfRemote.download(sha, projectId, token) : null;
        if (remote) {
          if (active) setState({ kind: 'ready', blob: remote, uploaded: true });
          return;
        }
        if (active)
          setState({
            kind: 'missing',
            reason: user
              ? 'Không tìm thấy PDF trong ResearchHub hoặc trên thiết bị này.'
              : 'Không tìm thấy PDF trên thiết bị này.',
          });
      } catch (cause) {
        if (active) {
          setLoadError(String(cause instanceof Error ? cause.message : cause));
          setState({ kind: 'missing', reason: 'Không tải được tài liệu PDF.' });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [sha, projectId, user, getIdToken, attempt]);

  const retry = () => {
    setLoadError('');
    setMessage('');
    setState({ kind: 'loading' });
    setAttempt((current) => current + 1);
  };

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
    setMessage('');
    setState({ kind: 'ready', blob, uploaded: false });
    if (user)
      void upload(blob)
        .then((sent) => sent && setState({ kind: 'ready', blob, uploaded: true }))
        .catch((cause: unknown) => setUploadError(String(cause)));
  }

  if (!sha) return <p className={styles.note}>Bài này không được nhập từ tệp PDF.</p>;
  const loadState = state.kind === 'loading' ? 'searching' : state.kind === 'missing' ? 'missing' : 'loading';
  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="application/pdf,.pdf"
        className={styles.hidden}
        aria-label="Chọn PDF gốc"
        onChange={(event) => void attach(event)}
      />
      <PdfViewer
        key={`${sha}-${attempt}`}
        blob={state.kind === 'ready' ? state.blob : null}
        loadState={loadState}
        loadMessage={state.kind === 'missing' ? message || state.reason : ''}
        loadDetail={loadError}
        onRetry={retry}
        onUpload={() => picker.current?.click()}
        onSignIn={!user ? () => void signIn() : undefined}
        fallback={state.kind === 'missing' ? fallback : undefined}
        target={target}
        marks={marks}
        onMark={onMark}
        toolbarStart={
          <>
            {toolbarStart}
            {back}
          </>
        }
        toolbarEnd={
          <>
            {find}
            {toolbarActions}
            {state.kind === 'ready' && state.uploaded ? (
              <Badge tone="success" icon={<Cloud size={14} aria-hidden="true" />}>
                <span className={styles.pdfSyncLabel}>Đã lưu trong ResearchHub</span>
              </Badge>
            ) : state.kind === 'ready' && uploadError ? (
              <span title={uploadError} aria-label={`Lỗi lưu PDF lên ResearchHub: ${uploadError}`}>
                <Badge tone="warning" icon={<CloudOff size={14} aria-hidden="true" />}>
                  <span className={styles.pdfSyncLabel}>Chưa lưu được lên ResearchHub</span>
                </Badge>
              </span>
            ) : state.kind === 'ready' ? (
              <Badge icon={<HardDrive size={14} aria-hidden="true" />}>
                <span className={styles.pdfSyncLabel}>
                  {user ? 'Đang lưu lên ResearchHub…' : 'Chỉ trên máy này'}
                </span>
              </Badge>
            ) : null}
          </>
        }
      />
    </>
  );
}
