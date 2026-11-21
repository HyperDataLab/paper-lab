import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { doiKey } from '@/core/corpus/doiKey';
import type { Paper } from '@/core/schemas';
import type { Corpus } from '@/core/schemas/corpus';
import type { HubPaperStatus } from '@/core/schemas/fetchHub';
import { importStoredPdf } from '@/modules/paper-import';
import { useAuth } from '@/shared/auth/authContext';
import { createFetchHubClient, FETCH_HUB_URL } from '@/shared/fetchHub/client';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
import { doiPdfName, retrievedMember } from './acquisition';

const POLL_INTERVAL = 10 * 60_000;
type Status = HubPaperStatus['status'];
type MemberStatus = { doi: string; status: Status; reason?: string; importError?: string };
export type SaveAcquisition = (corpus: Corpus, options?: { expectedVersion?: number }) => Promise<void>;

const failed = (status: Status) => status === 'failed' || status === 'cancelled';
const pending = (status: Status) => !failed(status) && status !== 'done' && status !== 'unknown';

export function useCorpusHub({
  corpus,
  save,
  disabled,
  onImported,
}: {
  corpus: Corpus;
  save: SaveAcquisition;
  disabled: boolean;
  onImported: (memberId: string, paper: Paper) => void;
}) {
  const repo = useRepositories();
  const projectId = useHubProjectId() ?? '';
  const { getIdToken } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, MemberStatus>>({});
  const [counts, setCounts] = useState<{ created: number; joined: number; invalid: number }>();
  const [error, setError] = useState<Error>();
  const [working, setWorking] = useState(false);
  const [pollAfter, setPollAfter] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const configured = Boolean(FETCH_HUB_URL);
  const getToken = () => getIdToken();
  const eligible = corpus.members.flatMap(({ memberId, title, identifiers: { doi }, retrieval }) =>
    doi && retrieval !== 'retrieved' ? [{ memberId, title, doi }] : [],
  );
  const isPending = ({ memberId, doi }: (typeof eligible)[number]) => {
    const last = statuses[memberId];
    return last?.doi === doi && pending(last.status);
  };
  const shouldPoll = configured && eligible.some(isPending);

  async function run(
    action: (client: ReturnType<typeof createFetchHubClient>, signal: AbortSignal) => Promise<void>,
  ) {
    if (!configured || disabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setWorking(true);
    setError(undefined);
    try {
      await action(createFetchHubClient({ baseUrl: FETCH_HUB_URL, getToken }), controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      active.current = null;
      setWorking(false);
    }
  }

  function send() {
    return run(async (client, signal) => {
      setCounts(undefined);
      const results = await client.requestDois(
        eligible.map(({ doi, memberId }) => ({
          doi,
          tag: `paperlab:corpus:${corpus.id}/member:${memberId}`,
        })),
        signal,
      );
      const nextCounts = { created: 0, joined: 0, invalid: 0 };
      const byKey = new Map<string, Status>();
      for (const result of results) {
        nextCounts[result.outcome] += 1;
        if (result.outcome !== 'invalid') byKey.set(result.doiKey, result.status);
      }
      const updates: Record<string, MemberStatus> = {};
      for (const { doi, memberId } of eligible) {
        const status = byKey.get((await doiKey(doi)) ?? '');
        if (status) updates[memberId] = { doi, status };
      }
      signal.throwIfAborted();
      setStatuses((previous) => ({ ...previous, ...updates }));
      setCounts(nextCounts);
      setPollAfter(Date.now() + POLL_INTERVAL);
    });
  }

  function refresh(automatic: boolean) {
    return run(async (client, signal) => {
      const membersByKey = new Map<string, typeof eligible>();
      for (const member of automatic ? eligible.filter(isPending) : eligible) {
        const key = await doiKey(member.doi);
        if (!key) continue;
        const group = membersByKey.get(key);
        if (group) group.push(member);
        else membersByKey.set(key, [member]);
      }
      // The page may have become hidden while the keys were being computed.
      if (automatic && document.visibilityState !== 'visible') return;
      setPollAfter(Date.now() + POLL_INTERVAL);
      const papers = await client.status([...membersByKey.keys()], signal);
      const updates: Record<string, MemberStatus> = {};
      const acquisitions = new Map<string, { doi: string; paper: Paper | null }>();
      for (const { doiKey: key, status, needsHumanReason, message } of papers) {
        const members = membersByKey.get(key);
        const first = members?.[0];
        if (!members || !first) continue;
        membersByKey.delete(key);
        let paper: Paper | null = null;
        let importError: string | undefined;
        if (status === 'done') {
          try {
            const pdf = await client.pdf(key, signal);
            paper = await importStoredPdf(
              pdf,
              doiPdfName(first.doi),
              repo,
              {
                projectId,
                getIdToken: getToken,
                title: first.title,
                reuseExisting: true,
              },
              signal,
            );
          } catch (cause) {
            signal.throwIfAborted();
            importError = cause instanceof Error ? cause.message : String(cause);
          }
        }
        for (const { memberId, doi } of members) {
          updates[memberId] = { doi, status, reason: needsHumanReason || message, importError };
          if (paper || failed(status)) acquisitions.set(memberId, { doi, paper });
        }
      }
      signal.throwIfAborted();
      setStatuses((previous) => ({ ...previous, ...updates }));
      if (!acquisitions.size) return;

      // Merge onto the latest version so a background refresh preserves intervening corpus edits.
      const latest = await repo.corpora.getVersioned(corpus.id);
      signal.throwIfAborted();
      if (!latest) throw new Error('Không tìm thấy corpus để lưu kết quả từ Hub.');
      const imported: [string, Paper][] = [];
      const members = latest.doc.members.map((member) => {
        const acquisition = acquisitions.get(member.memberId);
        if (!acquisition || member.identifiers.doi !== acquisition.doi || member.retrieval === 'retrieved')
          return member;
        if (!acquisition.paper)
          return member.retrieval === 'not_retrieved'
            ? member
            : { ...member, retrieval: 'not_retrieved' as const };
        imported.push([member.memberId, acquisition.paper]);
        return retrievedMember(member, acquisition.paper);
      });
      if (members.some((member, index) => member !== latest.doc.members[index])) {
        await save(
          { ...latest.doc, members, updatedAt: new Date().toISOString() },
          { expectedVersion: latest.version },
        );
        if (!signal.aborted) for (const [memberId, paper] of imported) onImported(memberId, paper);
      }
    });
  }

  const poll = useEffectEvent(() => void refresh(true));
  useEffect(() => {
    if (!shouldPoll || disabled || working) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible')
        timer = setTimeout(() => poll(), Math.max(0, pollAfter - Date.now()));
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [shouldPoll, disabled, working, pollAfter]);

  return { configured, hasEligible: eligible.length > 0, working, statuses, counts, error, send, refresh };
}
