import { createContext, useContext } from 'react';
import type { GrobidRecord } from '@/core/schemas';

export interface GrobidState {
  /** `idle` means nobody asked: a page rendered on its own, outside the paper workspace. */
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** Vietnamese reason when `status` is `failed`. */
  reason: string | null;
  record: GrobidRecord | null;
  /** Asks GROBID again, even after a stored failure; null outside the paper workspace. */
  refetch: ((replace?: boolean) => void) | null;
}

export const GROBID_IDLE: GrobidState = { status: 'idle', reason: null, record: null, refetch: null };
/** The paper workspace provides it; without a provider nothing is fetched and the parsed text is used alone. */
export const GrobidContext = createContext<GrobidState>(GROBID_IDLE);
export const useGrobidState = () => useContext(GrobidContext);
