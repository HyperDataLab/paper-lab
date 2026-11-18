import { useEffect, useState } from 'react';
import type { KgIngestResult, KgIngestStatus } from '@/core/schemas/labKg';
import { useAuth } from '@/shared/auth/authContext';
import { Button } from '@/shared/ui/Button';
import { enqueueLabKg, getLabKgStatus, LabKgError } from './client';

export function LabKgActions({ ids }: { ids: string[] }) {
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const [status, setStatus] = useState<KgIngestStatus['counts']>();
  const [statusError, setStatusError] = useState<LabKgError>();
  const [actionError, setActionError] = useState<LabKgError>();
  const [result, setResult] = useState<KgIngestResult>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!uid) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const token = await getIdToken();
        if (controller.signal.aborted) return;
        const { counts } = await getLabKgStatus(token, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(counts);
        setStatusError(undefined);
        if (counts.pending || counts.processing) timer = setTimeout(() => void load(), 30_000);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setStatusError(
          cause instanceof LabKgError ? cause : new LabKgError('Không tải được trạng thái KG của lab.'),
        );
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [uid, getIdToken, refresh]);

  async function queue() {
    setBusy(true);
    setActionError(undefined);
    setResult(undefined);
    try {
      setResult(await enqueueLabKg(ids, await getIdToken()));
    } catch (cause) {
      setActionError(
        cause instanceof LabKgError ? cause : new LabKgError('Không đưa được bài vào KG của lab.'),
      );
    } finally {
      setBusy(false);
      setRefresh((value) => value + 1);
    }
  }

  const error = actionError ?? statusError;
  return (
    <div>
      <Button size="sm" disabled={!uid || !ids.length || busy} onClick={() => void queue()}>
        Đưa vào KG của lab
      </Button>
      <small role={uid ? 'status' : undefined}>
        {' '}
        KG của lab ·{' '}
        {busy
          ? 'Đang gửi…'
          : !uid
            ? 'Cần đăng nhập'
            : statusError
              ? 'Không tải được trạng thái'
              : status
                ? `Chờ ${status.pending} · Đang xử lý ${status.processing} · Đã xử lý ${status.done} · Lỗi ${status.failed}`
                : 'Đang tải…'}
      </small>
      {result && (
        <small role="status">
          {' '}
          Đã xếp {result.queued} · Xử lý ngay {result.processed} · Bỏ qua {result.skipped} · Lỗi{' '}
          {result.errors.length}
        </small>
      )}
      {error && (
        <div role="alert">
          {error.message}
          {error.detail && (
            <details>
              <summary>Chi tiết kỹ thuật</summary>
              {error.detail}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
