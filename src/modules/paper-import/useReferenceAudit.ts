import { useMemo, useRef, useState } from 'react';
import { compareReference } from '@/core/referenceAudit/compare';
import type { ReferenceAudit } from '@/core/referenceAudit/schema';
import type { PaperContextRecord } from '@/core/schemas';
import type { ReferenceItem } from '@/core/scholarlyContext';
import { sourceHash } from '@/core/text/hash';
import { useAuth } from '@/shared/auth/authContext';
import { createLabResearchClient, LAB_RESEARCH_URL } from '@/shared/labResearch';
import { useRepositories } from '@/shared/storage/StorageProvider';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function useReferenceAudit(
  paperId: string,
  references: ReferenceItem[],
  record: PaperContextRecord | undefined,
  onSave: (record: PaperContextRecord) => void,
  options?: {
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    call?: (input: unknown) => Promise<unknown>;
  },
) {
  const repo = useRepositories();
  const { getIdToken } = useAuth();
  const client = useMemo(
    () => createLabResearchClient({ baseUrl: LAB_RESEARCH_URL, getToken: getIdToken }),
    [getIdToken],
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const stopped = useRef(false);
  const lastStart = useRef<number | null>(null);
  async function save(audit: ReferenceAudit) {
    const current = await repo.paperContext.get(paperId);
    const saved = await repo.paperContext.save({
      schemaVersion: 1,
      paperId,
      checkedAt: new Date().toISOString(),
      paperDoi: null,
      checked: 0,
      found: 0,
      retracted: [],
      retractionChecked: false,
      metadata: null,
      ...current,
      referenceAudit: audit,
    });
    onSave(saved);
  }
  async function run() {
    setRunning(true);
    setProgress(0);
    setError(null);
    stopped.current = false;
    const now = options?.now ?? Date.now;
    try {
      const refs = references.slice(0, 400);
      const hashes = await Promise.all(refs.map(async (ref) => (await sourceHash(ref.text)).slice(0, 23)));
      const previous = (await repo.paperContext.get(paperId))?.referenceAudit ?? record?.referenceAudit;
      const results: ReferenceAudit['items'] = [];
      const audit: ReferenceAudit = {
        schemaVersion: 1,
        auditedAt: new Date(now()).toISOString(),
        items: results,
        reviewed: previous?.reviewed ?? [],
      };
      let pending = 0;
      for (const [index, ref] of refs.entries()) {
        const textHash = hashes[index];
        if (!textHash || stopped.current) break;
        const existing = previous?.items.find((item) => item.textHash === textHash);
        if (existing) {
          results.push({ ...existing, index });
          setProgress(results.length);
          continue;
        }
        if (lastStart.current !== null)
          await (options?.sleep ?? sleep)(Math.max(0, 1100 - (now() - lastStart.current)));
        if (stopped.current) break;
        lastStart.current = now();
        try {
          const input = { citation: ref.doi ? `doi:${ref.doi}` : ref.text };
          const output = await (options?.call
            ? options.call(input)
            : client.callTool('verify_reference', input));
          results.push({ index, textHash, ...compareReference(ref.text, ref.year, output) });
        } catch (e) {
          setError(e);
          results.push({
            index,
            textHash,
            verdict: 'error',
            lookup: ref.doi ? 'doi' : 'bibliographic',
            mismatches: [],
            notes: [],
          });
        }
        setProgress(results.length);
        if (++pending === 10) {
          await save({ ...audit, items: [...results] });
          pending = 0;
        }
      }
      // Keep unvisited saved results on stop so a subsequent run can resume.
      const visited = new Set(results.map((item) => item.textHash));
      const remaining = (previous?.items ?? []).filter(
        (item) => hashes.includes(item.textHash) && !visited.has(item.textHash),
      );
      await save({ ...audit, items: [...results, ...remaining].slice(0, 400) });
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  }
  async function review(hash: string, checked: boolean) {
    const audit = (await repo.paperContext.get(paperId))?.referenceAudit;
    if (!audit) return;
    await save({
      ...audit,
      reviewed: checked ? [...new Set([...audit.reviewed, hash])] : audit.reviewed.filter((h) => h !== hash),
    });
  }
  return {
    run,
    stop: () => {
      stopped.current = true;
    },
    review,
    running,
    progress,
    error,
  };
}
