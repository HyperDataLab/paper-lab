import { useState } from 'react';
import { snapshotRelease } from '@/core/researchDesign/bank/release';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import { bankRefs } from '@/core/researchDesign/draft/bankRefs';
import { useAuth } from '@/shared/auth/authContext';
import { ResearchDesignConflictError } from '@/shared/storage/researchDesigns';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { BankApiError, type BankClient } from './bankApi';

export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export type BankFailure =
  | 'too_large'
  | 'not_json'
  | 'not_a_snapshot'
  | 'unsupported_version'
  | 'invalid'
  | 'hash_mismatch'
  | 'conflict'
  | 'network'
  | 'signed_out'
  | 'bank_auth'
  | 'rate_limit'
  | 'cancelled';
export type BankResult =
  { ok: true; current?: boolean } | { ok: false; error: BankFailure; issues?: string[] };
/** Asks the person whether to replace the pinned snapshot; resolves false when they cancel. */
export type ConfirmReplace = () => Promise<boolean>;

export function bankFailure(error: unknown): BankFailure {
  if (!(error instanceof BankApiError)) return 'network';
  if (error.code === 'signed_out') return 'signed_out';
  if (error.status === 401 || error.status === 403) return 'bank_auth';
  if (error.status === 429) return 'rate_limit';
  return 'network';
}

/**
 * Pins a Writing Bank snapshot to the project through the repository's bank import. The checks run here first so
 * the person sees why a file is refused; the repository checks the hash again and refuses a stale version.
 */
export function useBankImport(projectId: string, initial: BankDoc | null) {
  const repo = useRepositories();
  const { user } = useAuth();
  const [bank, setBank] = useState(initial);

  /** True when replacing the current snapshot would leave draft references behind, or when that is unknown. */
  const read = async () => {
    try {
      const record = await repo.researchDesigns.get(projectId);
      return {
        version: record?.version ?? 0,
        referenced: record ? bankRefs(record.draft).length > 0 : false,
      };
    } catch {
      return { version: 0, referenced: true };
    }
  };

  const store = async (
    bytes: ArrayBuffer,
    requireRelease: boolean,
    confirm: ConfirmReplace,
  ): Promise<BankResult> => {
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return { ok: false, error: 'not_json' };
    }
    const parsed = await snapshotRelease(data, bytes);
    if (!parsed.ok) return { ok: false, error: parsed.reason, issues: parsed.issues };
    if (requireRelease && !parsed.file.release)
      return { ok: false, error: 'invalid', issues: ['release: Required'] };
    let confirmed = false;
    // A version conflict means someone saved in between: read again and apply the import once more.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await read();
      if (bank && current.referenced && !confirmed) {
        if (!(await confirm())) return { ok: false, error: 'cancelled' };
        confirmed = true;
      }
      try {
        await repo.researchDesigns.importBank(projectId, current.version, bytes, user?.email ?? 'local');
        setBank(await repo.researchDesigns.getBank(projectId));
        return { ok: true };
      } catch (error) {
        if (!(error instanceof ResearchDesignConflictError)) return { ok: false, error: 'network' };
      }
    }
    return { ok: false, error: 'conflict' };
  };

  const importFile = async (file: File, confirm: ConfirmReplace): Promise<BankResult> => {
    if (file.size > MAX_SNAPSHOT_BYTES) return { ok: false, error: 'too_large' };
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      return { ok: false, error: 'not_json' };
    }
    return store(bytes, false, confirm);
  };

  const fetchLatest = async (client: BankClient, confirm: ConfirmReplace): Promise<BankResult> => {
    let answer: Awaited<ReturnType<BankClient['getSnapshot']>>;
    try {
      answer = await client.getSnapshot(bank?.release ?? null);
    } catch (error) {
      return { ok: false, error: bankFailure(error) };
    }
    if (answer.status === 'current') return { ok: true, current: true };
    return store(answer.bytes, true, confirm);
  };

  return { bank, importFile, fetchLatest };
}
