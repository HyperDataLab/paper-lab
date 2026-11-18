import { snapshotRelease } from '@/core/researchDesign/bank/release';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import { bankRefs } from '@/core/researchDesign/draft/bankRefs';
import { useAuth } from '@/shared/auth/authContext';
import { BankApiError, type BankClient } from '@/shared/bank/bankApi';
import { ResearchDesignConflictError } from '@/shared/storage/researchDesigns';
import { useRepositories } from '@/shared/storage/StorageProvider';

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

/** The provider's bank import: it reads the stored version itself and retries once after a version conflict. */
export type ImportBank = (bytes: ArrayBuffer, who: string) => Promise<unknown>;

/**
 * Pins a Writing Bank snapshot to the project through the provider's bank import. The checks run here first so
 * the person sees why a file is refused; the repository checks the hash again and refuses a stale version.
 */
export function useBankImport(projectId: string, bank: BankDoc | null, importBank: ImportBank) {
  const repo = useRepositories();
  const { user } = useAuth();

  /** True when replacing the current snapshot would leave draft references behind, or when that is unknown. */
  const referenced = async () => {
    try {
      const record = await repo.researchDesigns.get(projectId);
      return record ? bankRefs(record.draft).length > 0 : false;
    } catch {
      return true;
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
    if (bank && (await referenced()) && !(await confirm())) return { ok: false, error: 'cancelled' };
    try {
      await importBank(bytes, user?.email ?? 'local');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof ResearchDesignConflictError ? 'conflict' : 'network' };
    }
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

  return { importFile, fetchLatest };
}
