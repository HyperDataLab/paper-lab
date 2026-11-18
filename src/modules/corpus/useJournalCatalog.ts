import { useEffect, useState } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { getBankCatalog, type BankCatalogResult } from '@/shared/bank/catalog';
import { searchBankJournals, type BankJournalSearch } from '@/shared/bank/journals';

export function useJournalCatalog(enabled: boolean) {
  const { user, ready, getIdToken } = useAuth();
  const uid = user?.uid;
  const [loaded, setLoaded] = useState<{ uid: string; catalog: BankCatalogResult }>();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<{ uid: string; term: string; result: BankJournalSearch }>();
  const term = query.trim();
  useEffect(() => {
    if (!enabled || !ready || !uid) return;
    let cancelled = false;
    void getBankCatalog(getIdToken).then((catalog) => {
      if (!cancelled) setLoaded({ uid, catalog });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, ready, uid, getIdToken]);
  useEffect(() => {
    if (!enabled || !ready || !uid || term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchBankJournals(getIdToken, term, { signal: controller.signal }).then(
        (result) => {
          if (!controller.signal.aborted) setSearched({ uid, term, result });
        },
        () => {
          // A superseded search rejects on abort. Its replacement owns the results.
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, ready, uid, getIdToken, term]);
  return {
    catalog: enabled && ready && uid && loaded?.uid === uid ? loaded.catalog : undefined,
    signedOut: enabled && ready && !uid,
    canSearch: enabled && ready && Boolean(uid),
    query,
    changeQuery(value: string) {
      if (value.trim() !== term) setSearched(undefined);
      setQuery(value);
    },
    search:
      enabled && ready && uid && searched?.uid === uid && searched.term === term
        ? searched.result
        : undefined,
  };
}
