import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { CompositeDocStore } from './compositeDocStore';
import { createDb } from './db';
import { DexieDocStore } from './dexieDocStore';
import { RemoteDocStore } from './remoteDocStore';
import { createRepositories, type Repositories } from './repositories';
const Context = createContext<Repositories | null>(null);
const StoreContext = createContext<CompositeDocStore | null>(null);
const noopSubscribe = () => () => {};
const idle = () => 'idle' as const;
const noFallback = () => false;

export function StorageProvider({
  children,
  repositories,
}: {
  children: ReactNode;
  repositories?: Repositories;
}) {
  const { user, getIdToken } = useAuth();
  const uid = user?.uid;
  const [local] = useState(() => {
    if (repositories) return null;
    const db = createDb();
    return { db, store: new DexieDocStore(db) };
  });
  const storage = useMemo(() => {
    if (!local) return null;
    const remote = uid ? new RemoteDocStore({ getToken: () => getIdToken(uid) }) : null;
    const store = new CompositeDocStore(local.store, remote);
    return {
      store,
      repositories: createRepositories(local.db, undefined, undefined, store, remote ?? undefined),
    };
  }, [getIdToken, local, uid]);
  return (
    <StoreContext.Provider value={storage?.store ?? null}>
      <Context.Provider value={repositories ?? storage?.repositories ?? null} key={uid ?? 'local'}>
        {children}
      </Context.Provider>
    </StoreContext.Provider>
  );
}

export function StorageStatus({ className }: { className?: string }) {
  const store = useContext(StoreContext);
  const repo = useContext(Context);
  const runs = useSyncExternalStore(
    repo?.paperRuns.subscribe ?? noopSubscribe,
    repo?.paperRuns.getSaveStatus ?? idle,
  );
  const measurements = useSyncExternalStore(
    repo?.measurements.checkpoints.subscribe ?? noopSubscribe,
    repo?.measurements.checkpoints.getSaveStatus ?? idle,
  );
  const spike = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSaveStatus ?? idle);
  const pending = [runs, measurements, spike];
  const status = pending.includes('error') ? 'error' : pending.includes('saving') ? 'saving' : 'idle';
  const fallback = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.isFallback ?? noFallback);
  if (status === 'idle' && !fallback) return null;
  return (
    <div className={className} role="status">
      {status !== 'idle' && <span>{status === 'saving' ? 'Đang lưu…' : 'Lỗi lưu'}</span>}
      {fallback && <span>Kho dữ liệu lab chưa được cấu hình. Dữ liệu đang lưu trên thiết bị này.</span>}
    </div>
  );
}
// The provider and its hook form one public storage entry point.
// eslint-disable-next-line react-refresh/only-export-components
export function useRepositories() {
  const value = useContext(Context);
  if (!value) throw new Error('StorageProvider is missing');
  return value;
}
