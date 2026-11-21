import { useEffect, useRef, useState } from 'react';
import type { KgGraphNodeKind, KgIngestResult } from '@/core/schemas/labKg';
import { useAuth } from '@/shared/auth/authContext';
import { asLabKgError, enqueueLabKg, getLabKgPaper, getLabKgStatus, LabKgError } from '@/shared/labKg/client';
import { Button } from '@/shared/ui/Button';
import { Empty } from '@/shared/ui/StateNote';
import { ErrorNote } from './ErrorNote';
import { KIND_LABELS } from './labels';

export const INGEST_POLL_MS = 4_000;
export const INGEST_WAIT_MS = 120_000;

const CODE_TEXT: Record<string, string> = {
  openalex_not_found: 'OpenAlex không có bài này. Hãy kiểm tra lại DOI hoặc OpenAlex ID.',
  openalex_rate_limited: 'OpenAlex đang giới hạn số yêu cầu; máy chủ lab sẽ tự thử lại.',
  openalex_unavailable: 'Chưa lấy được bài từ OpenAlex; máy chủ lab sẽ tự thử lại.',
};
/** Codes after which the queue does not try again. */
const FINAL_CODES = new Set(['openalex_not_found']);
const codeText = (code: string) => CODE_TEXT[code] ?? 'Chưa đưa được bài vào KG; máy chủ lab sẽ tự thử lại.';

type Phase =
  | { step: 'idle' }
  | { step: 'sending' }
  | { step: 'waiting'; result: KgIngestResult; note?: string }
  | { step: 'failed'; error: LabKgError }
  | { step: 'timeout'; note?: string };

/** A paper that is not in the lab KG yet: offers to fetch it from OpenAlex, then waits until it is there. */
function IngestPaper({
  id,
  onPresent,
  pollMs,
  waitMs,
}: {
  id: string;
  onPresent: () => void;
  pollMs: number;
  waitMs: number;
}) {
  const { getIdToken } = useAuth();
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const stopped = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    stopped.current = controller;
    return () => controller.abort();
  }, []);

  async function present(token: string | null, signal: AbortSignal) {
    try {
      await getLabKgPaper(id, token, signal);
      return true;
    } catch (cause) {
      if (cause instanceof LabKgError && cause.status === 404) return false;
      throw cause;
    }
  }

  async function ingest() {
    const signal = stopped.current.signal;
    setPhase({ step: 'sending' });
    try {
      const token = await getIdToken();
      const result = await enqueueLabKg([id], token);
      if (signal.aborted) return;
      const failure = result.errors.find((error) => error.id === id);
      if (failure && FINAL_CODES.has(failure.code))
        return setPhase({
          step: 'failed',
          error: new LabKgError(codeText(failure.code), failure.code, undefined, failure.code),
        });
      setPhase({ step: 'waiting', result, note: failure && codeText(failure.code) });
      const deadline = Date.now() + waitMs;
      for (;;) {
        if (await present(await getIdToken(), signal)) return onPresent();
        if (signal.aborted) return;
        if (Date.now() >= deadline) {
          setPhase((previous) => ({
            step: 'timeout',
            note: previous.step === 'waiting' ? previous.note : undefined,
          }));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        if (signal.aborted) return;
        const { logs } = await getLabKgStatus(await getIdToken(), signal);
        const latest = logs.find((log) => log.id === id);
        if (latest && FINAL_CODES.has(latest.code))
          return setPhase({
            step: 'failed',
            error: new LabKgError(codeText(latest.code), latest.code, undefined, latest.code),
          });
        if (latest && latest.code !== 'ingested')
          setPhase((previous) =>
            previous.step === 'waiting' ? { ...previous, note: codeText(latest.code) } : previous,
          );
      }
    } catch (cause) {
      if (signal.aborted) return;
      setPhase({ step: 'failed', error: asLabKgError(cause, 'Không đưa được bài vào KG của lab.') });
    }
  }

  const busy = phase.step === 'sending' || phase.step === 'waiting';
  return (
    <Empty
      title="Bài này chưa có trong KG của lab"
      hint="Máy chủ lab lấy bài từ OpenAlex cùng các bài nó dẫn và các bài dẫn nó, rồi vẽ đồ thị quanh bài."
    >
      <Button variant="primary" disabled={busy} onClick={() => void ingest()}>
        {busy ? 'Đang đưa vào KG…' : 'Đưa bài này vào KG'}
      </Button>
      {phase.step === 'sending' && <p role="status">Đang gửi yêu cầu…</p>}
      {phase.step === 'waiting' && (
        <p role="status">
          Đã gửi (xếp {phase.result.queued} · xử lý ngay {phase.result.processed}). Đang chờ bài xuất hiện
          trong KG…{phase.note ? ` ${phase.note}` : ''}
        </p>
      )}
      {phase.step === 'timeout' && (
        <p role="status">
          Bài vẫn đang trong hàng chờ; máy chủ lab xử lý hàng chờ vài phút một lần.
          {phase.note ? ` ${phase.note}` : ''} Hãy thử lại sau.
        </p>
      )}
      {phase.step === 'failed' && <ErrorNote error={phase.error} />}
    </Empty>
  );
}

/** `keywords/graph-neural-networks` → `graph neural networks`; a bare ID (A…, I…) stays as typed. */
const searchText = (id: string) =>
  id
    .replace(/^[a-z]+\//u, '')
    .replace(/[-_]+/gu, ' ')
    .trim();

export function NotInKg({
  centre,
  onPresent,
  onSearch,
  pollMs = INGEST_POLL_MS,
  waitMs = INGEST_WAIT_MS,
}: {
  centre: { id: string; kind: KgGraphNodeKind };
  onPresent: () => void;
  onSearch: (text: string) => void;
  pollMs?: number;
  waitMs?: number;
}) {
  if (centre.kind === 'paper')
    return (
      <IngestPaper key={centre.id} id={centre.id} onPresent={onPresent} pollMs={pollMs} waitMs={waitMs} />
    );
  const text = searchText(centre.id);
  return (
    <Empty
      title={`${KIND_LABELS[centre.kind]} này chưa có trong KG của lab`}
      hint="KG chỉ có những gì đến từ các bài đã đưa vào. Hãy tìm bằng chữ để thấy các bài gần nhất."
    >
      {text && (
        <Button variant="primary" onClick={() => onSearch(text)}>
          Tìm “{text}”
        </Button>
      )}
    </Empty>
  );
}
