import { useEffect, useRef, useState } from 'react';
import { checkpoint, doiExport, isStale, startQueue } from '@/core/corpus/queue';
import type { Corpus } from '@/core/schemas/corpus';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { useGrobidQueue } from '@/shared/pdfStore/useGrobidQueue';
import { GrobidQueueStatus, GrobidQueueSummary } from '@/shared/pdfStore/GrobidQueueStatus';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { acquireMember } from './acquisition';
import { modelInputs } from './modelInputs';

export function CorpusBuild({
  corpus,
  save,
  getIdToken,
}: {
  corpus: Corpus;
  save: (value: Corpus) => Promise<void>;
  getIdToken: () => Promise<string | null>;
}) {
  const repo = useRepositories();
  const grobid = useGrobidQueue();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<StorageEstimate>();
  const [stale, setStale] = useState<string[]>([]);
  const control = useRef<'run' | 'pause' | 'cancel'>('run');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void navigator.storage?.estimate?.().then((value) => {
      if (active) setUsage(value);
    });
    void Promise.all(
      corpus.members
        .filter((m) => m.inputs)
        .map(async (m) => {
          try {
            return isStale(m, await modelInputs(m, repo)) ? m.memberId : null;
          } catch {
            return m.memberId;
          }
        }),
    ).then((ids) => {
      if (active) setStale(ids.filter((id): id is string => id !== null));
    });
    return () => {
      active = false;
    };
  }, [corpus, repo]);
  useEffect(
    () => () => {
      control.current = 'pause';
      abort.current?.abort();
    },
    [],
  );
  async function fetchPdfs() {
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      await navigator.storage?.persist?.().catch(() => false);
      let current = corpus;
      for (const member of current.members.filter((m) => m.retrieval !== 'retrieved')) {
        if (controller.signal.aborted) break;
        const updated = await acquireMember(
          member,
          repo,
          controller.signal,
          (paper) => grobid.enqueue(member.memberId, paper),
          getIdToken,
        );
        current = {
          ...current,
          updatedAt: new Date().toISOString(),
          members: current.members.map((m) => (m.memberId === member.memberId ? updated : m)),
        };
        await save(current);
      }
      setUsage(await navigator.storage?.estimate?.());
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }
  async function run(resume: boolean) {
    setBusy(true);
    setError('');
    control.current = 'run';
    let current =
      resume && corpus.buildQueue
        ? { ...corpus, buildQueue: { ...corpus.buildQueue, status: 'running' as const } }
        : startQueue(corpus);
    try {
      await save(current);
      while (current.buildQueue?.pending.length && control.current === 'run') {
        const memberId = current.buildQueue.pending[0];
        const member = current.members.find((m) => m.memberId === memberId);
        if (!member || !memberId) throw new Error('Không tìm thấy thành viên');
        try {
          current = checkpoint(current, memberId, await modelInputs(member, repo, true));
        } catch (cause) {
          current = checkpoint(current, memberId, null, String(cause));
        }
        current = { ...current, updatedAt: new Date().toISOString() };
        await save(current);
      }
      if (current.buildQueue && control.current !== 'run') {
        current = {
          ...current,
          buildQueue: { ...current.buildQueue, status: control.current === 'pause' ? 'paused' : 'cancelled' },
        };
        await save(current);
      } else if (current.buildQueue?.status === 'running')
        await save({ ...current, buildQueue: { ...current.buildQueue, status: 'complete' } });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([doiExport(corpus.members)], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paper-fetch-hub-dois.txt';
    link.click();
    URL.revokeObjectURL(url);
  }
  const retrieved = corpus.members.filter((m) => m.retrieval === 'retrieved').length;
  const built = corpus.members.filter((m) => m.retrieval === 'retrieved' && m.inputs).length;
  const queue = corpus.buildQueue;
  return (
    <Card>
      <h2>Thu thập và dựng paper model</h2>
      <p>Cần giữ tab mở trong khi chạy.</p>
      <GrobidQueueSummary statuses={grobid.statuses} />
      {corpus.members.map(
        (member) =>
          grobid.statuses[member.memberId] && (
            <p key={member.memberId}>
              {member.title ?? member.identifiers.doi ?? member.exportId}:{' '}
              <GrobidQueueStatus value={grobid.statuses[member.memberId]} />
            </p>
          ),
      )}
      <Button disabled={busy} onClick={() => void fetchPdfs()}>
        Lấy PDF
      </Button>{' '}
      <Button disabled={busy} onClick={download}>
        Gửi DOI sang Paper Fetch Hub
      </Button>{' '}
      <Button disabled={busy} onClick={() => void run(false)}>
        Dựng paper model
      </Button>{' '}
      {queue && queue.pending.length > 0 && queue.status !== 'cancelled' && !busy && (
        <Button onClick={() => void run(true)}>Tiếp tục</Button>
      )}
      {busy && (
        <>
          <Button
            onClick={() => {
              control.current = 'pause';
              abort.current?.abort();
            }}
          >
            Tạm dừng
          </Button>{' '}
          <Button
            onClick={() => {
              control.current = 'cancel';
              abort.current?.abort();
            }}
          >
            Hủy
          </Button>
        </>
      )}
      <p>
        Đã dựng: {built} · Thất bại: {queue?.failed.length ?? 0} · Còn lại: {queue?.pending.length ?? 0} · Tỷ
        lệ phân tích: {retrieved ? `${Math.round((built / retrieved) * 100)}%` : '—'}
      </p>
      <p>
        Bộ nhớ: {usage?.usage != null ? `${(usage.usage / 1024 / 1024).toFixed(1)} MB` : 'không có thông tin'}{' '}
        / {usage?.quota != null ? `${(usage.quota / 1024 / 1024).toFixed(1)} MB` : '—'}
      </p>
      {stale.length > 0 && (
        <p>
          Cần dựng lại:{' '}
          {stale.map((id) => corpus.members.find((m) => m.memberId === id)?.title ?? id).join(', ')}
        </p>
      )}
      {corpus.members
        .filter((m) => m.retrievalReason)
        .map((m) => (
          <p key={m.memberId}>
            {m.title ?? m.identifiers.doi ?? m.exportId}: {m.retrievalReason}
          </p>
        ))}
      {queue?.failed.map((failure) => (
        <p key={failure.memberId}>
          {failure.memberId}: {failure.reason}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}
